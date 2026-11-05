import type { InvoiceIssueResult } from '@na-regua/contracts'
import {
  cancelSaleInvoiceInputSchema,
  ErroDeIntegracao,
  updateFiscalCredentialsInputSchema,
} from '@na-regua/contracts'
import {
  cancelSaleInvoice,
  type CancelInvoiceDeps,
  reconcileContingency,
  type ReconcileContingencyDeps,
  requestInvoice,
  type RequestInvoiceDeps,
} from '@na-regua/core'
import type { CadastroDeEmpresasFocus, DadosDaEmpresaFocus, EmpresaNaFocus } from '@na-regua/fiscal'
import type { FastifyInstance, FastifyBaseLogger } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'

/**
 * Configuracao da emissao fiscal — NR-042, RF-004, RNF-022.
 *
 * Estas duas rotas sao a unica porta de entrada dos segredos de emissao. O que
 * entra e cifrado antes de tocar o banco (`secret-box`), e o que sai NUNCA
 * inclui segredo — so se ele existe e ate quando o certificado vale.
 */

export type EmissaoDeps = RequestInvoiceDeps &
  ReconcileContingencyDeps &
  Pick<CancelInvoiceDeps, 'audit'> & {
    /** A nota ja emitida desta venda, para a tela mostrar o estado — RF-054. */
    readonly store: {
      findBySale(
        companyId: string,
        saleId: string,
      ): Promise<{ resultado: InvoiceIssueResult } | undefined>
    }
  }

export type CredenciaisFiscaisDeps = {
  readonly fiscalCredentials: {
    salvar(entrada: {
      readonly companyId: string
      readonly focusToken?: string
      readonly certificadoBase64?: string
      readonly senhaDoCertificado?: string
      readonly certificadoVenceEm?: string
      readonly cscProducao?: { readonly id: string; readonly codigo: string }
      readonly cscHomologacao?: { readonly id: string; readonly codigo: string }
      readonly atualizadoPor: string
    }): Promise<void>
    situacao(companyId: string): Promise<{
      readonly temToken: boolean
      readonly temCertificado: boolean
      readonly certificadoVenceEm: string | null
      readonly temCscProducao: boolean
      readonly temCscHomologacao: boolean
      readonly focusSincronizadaEm: string | null
      readonly focusErro: string | null
    }>
    dadosParaFocus(
      companyId: string,
    ): Promise<
      (Omit<DadosDaEmpresaFocus, 'regimeTributario'> & { readonly regime: string }) | undefined
    >
    registrarFocus(
      companyId: string,
      resultado:
        | { readonly ok: true; readonly empresa: EmpresaNaFocus }
        | { readonly ok: false; readonly mensagem: string },
    ): Promise<void>
  }
  /**
   * A conta de REVENDA da EiBuddy na Focus — NR-183. Ausente quando o servidor
   * nao tem `FOCUS_REVENDA_TOKEN`: as credenciais continuam sendo gravadas, e
   * a tela diz que o cadastro na Focus ainda nao esta disponivel.
   */
  readonly cadastroFocus?: CadastroDeEmpresasFocus
}

/**
 * Leva a empresa para a Focus depois de salvar — NR-183.
 *
 * O desfecho fica GRAVADO (tokens ou a mensagem), e nao so na resposta: a tela
 * de Empresa mostra "cadastrada na Focus em ..." ou o motivo da recusa em
 * qualquer visita, nao so no momento de salvar.
 *
 * Falta de dado na loja (endereco, certificado) vira mensagem antes de chamar a
 * Focus: a recusa dela diria "campo logradouro obrigatorio", e a nossa diz o
 * que preencher e onde. Falha de infraestrutura (Focus fora do ar, token da
 * revenda recusado) tambem vira mensagem — o certificado ja foi guardado, e
 * salvar de novo tenta de novo.
 */
async function sincronizarComFocus(
  deps: CredenciaisFiscaisDeps,
  companyId: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const cadastro = deps.cadastroFocus
  if (cadastro === undefined) return

  const dados = await deps.fiscalCredentials.dadosParaFocus(companyId)
  if (dados === undefined) return

  const falta: string[] = []
  const e = dados.endereco
  if ([e.cep, e.logradouro, e.numero, e.bairro, e.municipio, e.uf].some((v) => v.trim() === '')) {
    falta.push('o endereco completo da empresa (CEP, rua, numero, bairro, cidade e UF)')
  }
  if (dados.focusId === undefined && dados.certificado === undefined) {
    falta.push('o certificado digital A1 e a senha')
  }
  if (
    dados.focusId === undefined &&
    dados.cscProducao === undefined &&
    dados.cscHomologacao === undefined
  ) {
    falta.push('o CSC da NFC-e (ID e codigo, gerados no site da SEFAZ)')
  }
  if (falta.length > 0) {
    await deps.fiscalCredentials.registrarFocus(companyId, {
      ok: false,
      mensagem: `Para cadastrar na Focus NFe, falta ${falta.join(' e ')}.`,
    })
    return
  }

  const { regime, ...resto } = dados
  try {
    const r = await cadastro.salvar({
      ...resto,
      /* Simples Nacional e 1; os regimes normais (presumido, real) sao 3. */
      regimeTributario: regime === 'simples_nacional' ? 1 : 3,
    })
    await deps.fiscalCredentials.registrarFocus(companyId, r)
  } catch (erro) {
    if (!(erro instanceof ErroDeIntegracao)) throw erro
    log.error({ err: erro, companyId }, 'cadastro na Focus NFe falhou por infraestrutura')
    await deps.fiscalCredentials.registrarFocus(companyId, {
      ok: false,
      mensagem:
        'Nao deu para falar com a Focus NFe agora. Os dados foram guardados; salve de novo em alguns minutos.',
    })
  }
}

/** A situacao como a tela le — sem segredo nenhum. */
function paraTela(
  s: Awaited<ReturnType<CredenciaisFiscaisDeps['fiscalCredentials']['situacao']>>,
  focusDisponivel: boolean,
) {
  return {
    hasToken: s.temToken,
    hasCertificate: s.temCertificado,
    certificateExpiresAt: s.certificadoVenceEm,
    hasCscProduction: s.temCscProducao,
    hasCscHomologation: s.temCscHomologacao,
    focus: {
      available: focusDisponivel,
      syncedAt: s.focusSincronizadaEm,
      error: s.focusErro,
    },
  }
}

/** Teto do corpo: um certificado A1 tem poucos KB, e base64 infla um terco. */
const TETO_DO_CERTIFICADO = 512 * 1024

/**
 * `deps` nulo quando `SECRETS_KEY` nao esta definida.
 *
 * As rotas continuam EXISTINDO e respondem 503 com a explicacao. Nao
 * registra-las daria 404, e 404 diz "esta tela nao existe" para quem so
 * precisa saber que o servidor esta sem a chave de cifragem — a acao de quem
 * le e diferente nos dois casos.
 */
/**
 * Emissao da nota de uma venda — NR-042, RF-045, RF-046, RF-054.
 *
 * Duas rotas: pedir e consultar. Sao separadas porque respondem perguntas
 * diferentes em momentos diferentes — pedir e uma escrita que enfileira, e
 * consultar e o que a tela faz enquanto espera.
 */
export function registerEmissaoRoutes(app: FastifyInstance, deps: EmissaoDeps): void {
  /**
   * Pede a nota — RF-045.
   *
   * `202` e nao `201`: nada foi criado ainda. A SEFAZ nem viu o pedido, e
   * responder 201 diria a quem integra que existe um documento fiscal.
   */
  app.post(
    '/vendas/:id/nota',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }

      const r = await requestInvoice(deps, ctx, { saleId: id })

      return reply.code(202).send(r)
    },
  )

  /**
   * O estado fiscal da venda — RF-054.
   *
   * `queued` quando ainda nao ha nota: a tela precisa distinguir "esperando" de
   * "nunca pedida", e as duas nao sao a mesma coisa para quem esta olhando.
   */
  /**
   * Reconcilia as notas em contingencia — RF-053.
   *
   * Pergunta ao provedor, em ordem, quais ja foram aceitas pela SEFAZ. NAO
   * transmite: a documentacao do provedor nao define como uma nota emitida
   * offline chega la depois, e inventar a chamada produziria nota duplicada ou
   * nota que nunca chega.
   *
   * Rota e nao varredura automatica porque a varredura precisaria perguntar
   * "quais empresas tem contingencia", e a politica de isolamento recusa ler
   * tabela de negocio sem tenant. Aqui a empresa vem do contexto. E a mesma
   * lacuna do `listOverdue`.
   */
  app.post(
    '/vendas/notas/reconciliar',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)

      const r = await reconcileContingency(deps, ctx)

      return reply.code(200).send(r)
    },
  )

  /**
   * Cancela a nota da venda — RF-050, RF-051.
   *
   * O passo antes do estorno e da devolucao, que recusam venda com nota
   * valida. Fora do prazo legal, recusa sem transmitir e orienta a devolucao.
   */
  app.post(
    '/vendas/:id/nota/cancelamento',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }
      const input = validate(cancelSaleInvoiceInputSchema, request.body)

      const r = await cancelSaleInvoice(deps, ctx, { saleId: id, reason: input.reason })

      return reply.code(200).send(r)
    },
  )

  app.get('/vendas/:id/nota', async (request, reply) => {
    const ctx = requireContext(request)
    const { id } = request.params as { id: string }

    const nota = await deps.store.findBySale(ctx.companyId, id)

    return reply.code(200).send(nota === undefined ? { status: 'pending' } : nota.resultado)
  })
}

export function registerFiscalRoutes(
  app: FastifyInstance,
  deps: CredenciaisFiscaisDeps | null,
): void {
  if (deps === null) {
    const indisponivel = async (
      _r: unknown,
      reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    ) =>
      reply.code(503).send({
        error: {
          code: 'UNAVAILABLE',
          message:
            'Configuracao de emissao fiscal indisponivel: o servidor esta sem a chave de ' +
            'cifragem de segredos. Fale com o suporte.',
        },
      })

    app.get('/empresa/credenciais-fiscais', indisponivel)
    app.put('/empresa/credenciais-fiscais', indisponivel)
    return
  }

  /**
   * O que esta configurado — sem os segredos.
   *
   * A tela precisa distinguir "nunca configurou" de "configurado e vencendo",
   * e as duas respostas cabem em tres campos. Devolver o token para a tela
   * "conferir" seria desfazer a cifragem na saida.
   */
  app.get('/empresa/credenciais-fiscais', async (request, reply) => {
    const ctx = requireContext(request)

    const s = await deps.fiscalCredentials.situacao(ctx.companyId)

    return reply.code(200).send(paraTela(s, deps.cadastroFocus !== undefined))
  })

  /**
   * Grava token e certificado — RF-004.
   *
   * `PUT` e parcial de proposito: quem troca so o certificado nao perde o
   * token. O repositorio preserva o que nao veio, e um formulario que envia
   * apenas o campo alterado nao apaga o resto.
   *
   * Responde a SITUACAO, e nao "ok": depois de gravar, a tela precisa do novo
   * vencimento para mostrar, e uma segunda chamada para descobrir isso seria
   * uma ida a mais por nada.
   */
  app.put(
    '/empresa/credenciais-fiscais',
    { bodyLimit: TETO_DO_CERTIFICADO, config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const input = validate(updateFiscalCredentialsInputSchema, request.body)

      /*
       * O `refine` do contrato ja garante que certificado, senha e vencimento
       * chegam juntos — mas o TypeScript nao le `refine`. A checagem explicita
       * e o que faz os tres entrarem como um bloco, em vez de `!` em cada um.
       */
      const temCertificado =
        input.certificateBase64 !== undefined &&
        input.certificatePassword !== undefined &&
        input.certificateExpiresAt !== undefined

      await deps.fiscalCredentials.salvar({
        companyId: ctx.companyId,
        ...(input.focusToken === undefined ? {} : { focusToken: input.focusToken }),
        ...(temCertificado
          ? {
              certificadoBase64: input.certificateBase64!,
              senhaDoCertificado: input.certificatePassword!,
              certificadoVenceEm: input.certificateExpiresAt!,
            }
          : {}),
        ...(input.cscProduction === undefined
          ? {}
          : { cscProducao: { id: input.cscProduction.id, codigo: input.cscProduction.code } }),
        ...(input.cscHomologation === undefined
          ? {}
          : {
              cscHomologacao: {
                id: input.cscHomologation.id,
                codigo: input.cscHomologation.code,
              },
            }),
        atualizadoPor: ctx.userId,
      })

      await sincronizarComFocus(deps, ctx.companyId, request.log)

      const s = await deps.fiscalCredentials.situacao(ctx.companyId)

      return reply.code(200).send(paraTela(s, deps.cadastroFocus !== undefined))
    },
  )
}
