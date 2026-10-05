import type { InvoiceIssueResult } from '@na-regua/contracts'
import {
  cancelSaleInvoiceInputSchema,
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
import type { FastifyInstance } from 'fastify'
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
      readonly atualizadoPor: string
    }): Promise<void>
    situacao(companyId: string): Promise<{
      readonly temToken: boolean
      readonly temCertificado: boolean
      readonly certificadoVenceEm: string | null
    }>
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

    return reply.code(200).send({
      hasToken: s.temToken,
      hasCertificate: s.temCertificado,
      certificateExpiresAt: s.certificadoVenceEm,
    })
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
        atualizadoPor: ctx.userId,
      })

      const s = await deps.fiscalCredentials.situacao(ctx.companyId)

      return reply.code(200).send({
        hasToken: s.temToken,
        hasCertificate: s.temCertificado,
        certificateExpiresAt: s.certificadoVenceEm,
      })
    },
  )
}
