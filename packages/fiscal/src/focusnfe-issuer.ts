import {
  ErroDeIntegracao,
  type CancelInvoiceRequest,
  type InvoiceCancellation,
  type InvoiceIssueResult,
  cancelInvoiceRequestSchema,
  issueInvoiceRequestSchema,
  type IssueInvoiceRequest,
  LOCAL_REJECTION_CODES,
} from '@na-regua/contracts'
import type { InvoiceStore, NotaGuardada } from './invoice-store.js'

/**
 * Emissor real — Focus NFe, NFC-e. NR-042, DEC-004.
 *
 * ## O que este adapter NAO faz
 *
 * Nao decide prazo de cancelamento (RF-051), nao escolhe emitir em
 * contingencia, nao traduz codigo da SEFAZ em conselho. Tudo isso e regra e
 * mora em `core`. Aqui se fala HTTP com um provedor e se traduz o vocabulario
 * dele para o do contrato — nada mais.
 *
 * ## Tres coisas do provedor que moldam o codigo
 *
 * 1. **NFC-e e SINCRONA.** Autoriza ou rejeita na mesma requisicao, diferente
 *    da NFe. Nao ha fila nem consulta obrigatoria depois — por isso `issue`
 *    devolve o desfecho de verdade, e nao "processando".
 *
 * 2. **Autenticacao e Basic com senha VAZIA.** O token da empresa vai como
 *    usuario e a senha e string vazia — `Base64("token:")`. Nao e um cabecalho
 *    de API key.
 *
 * 3. **A referencia (`ref`) e nossa, e e o `saleId`.** Ela e unica por token e,
 *    depois que a nota autoriza, NAO pode ser reusada. Isso da metade da
 *    idempotencia de graca; a outra metade e a guarda (`InvoiceStore`), que
 *    responde sem ida a rede e resolve o cancelamento por chave.
 */

/** Ambientes do provedor. Homologacao nao tem validade fiscal. */
export const FOCUS_NFE_URLS = {
  homologacao: 'https://homologacao.focusnfe.com.br',
  producao: 'https://api.focusnfe.com.br',
} as const

export type AmbienteFocusNfe = keyof typeof FOCUS_NFE_URLS

/**
 * Credenciais por empresa.
 *
 * Uma conta Focus NFe por lojista, cada uma com seu token — mesma forma da
 * porta de dados: quem sabe o segredo e a raiz de composicao, nunca o adapter.
 */
export type CredenciaisFocusNfe = {
  /** Token da empresa, ou `undefined` se ela ainda nao tem emissao habilitada. */
  tokenDe(companyId: string): Promise<string | undefined>
  /** CNPJ do emitente, obrigatorio no corpo da NFC-e. */
  cnpjDe(companyId: string): Promise<string | undefined>
}

export type FocusNfeOptions = {
  readonly ambiente: AmbienteFocusNfe
  readonly credenciais: CredenciaisFocusNfe
  readonly store: InvoiceStore
  /** Injetavel para teste. Sem isto, o teste falaria com a SEFAZ de verdade. */
  readonly fetch?: typeof globalThis.fetch
  /** Teto de espera por requisicao. Emissao trava o balcao; nao pode pendurar. */
  readonly timeoutMs?: number
}

const TIMEOUT_PADRAO_MS = 20_000

/** O que a API devolve na emissao e na consulta. Campos verbatim do provedor. */
type RespostaDeNota = {
  status?: string
  status_sefaz?: string
  mensagem_sefaz?: string
  chave_nfe?: string
  numero?: number | string
  serie?: number | string
  caminho_xml_nota_fiscal?: string
  caminho_danfe?: string
  qrcode_url?: string
  contingencia_offline?: boolean
  erros?: { codigo?: string; mensagem?: string }[]
  codigo?: string
  mensagem?: string
}

type RespostaDeCancelamento = {
  status?: string
  status_sefaz?: string
  mensagem_sefaz?: string
  caminho_xml_cancelamento?: string
  numero_protocolo?: string
  codigo?: string
  mensagem?: string
}

/**
 * Centavos para o decimal em STRING que a API espera.
 *
 * String e nao numero: `1990 / 100` em ponto flutuante pode virar
 * `19.900000000000002`, e um centavo a mais numa nota fiscal e divergencia com
 * a SEFAZ. Divisao inteira com o resto formatado a parte nunca erra.
 */
export function reaisDeCentavos(centavos: number): string {
  const sinal = centavos < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(centavos))
  return `${sinal}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * A forma de pagamento do contrato para o codigo da SEFAZ.
 *
 * Traducao explicita: os codigos sao tabela fiscal e nao vocabulario nosso.
 * `01` dinheiro, `03` credito, `04` debito, `17` Pix, `99` outros.
 */
const FORMA_DE_PAGAMENTO: Record<string, string> = {
  cash: '01',
  credit: '03',
  debit: '04',
  pix: '17',
  /* Fiado nao e forma de pagamento na SEFAZ: a nota sai como "outros", e o
     recebimento acontece depois, fora do documento fiscal. */
  wallet: '99',
}

/** A unidade do cadastro para a sigla da nota. */
const UNIDADE: Record<string, string> = {
  un: 'UN',
  kg: 'KG',
  g: 'G',
  l: 'L',
  ml: 'ML',
  m: 'M',
  cm: 'CM',
  cx: 'CX',
  pct: 'PCT',
}

export function criarEmissorFocusNfe(opcoes: FocusNfeOptions): {
  issue(request: IssueInvoiceRequest): Promise<InvoiceIssueResult>
  cancel(request: CancelInvoiceRequest): Promise<InvoiceCancellation>
  consult(request: { companyId: string; saleId: string }): Promise<InvoiceIssueResult | undefined>
} {
  const buscar = opcoes.fetch ?? globalThis.fetch
  const base = FOCUS_NFE_URLS[opcoes.ambiente]
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS

  /**
   * Basic com senha vazia — `Base64("token:")`.
   *
   * Os dois pontos sem nada depois sao intencionais e estao na documentacao.
   * Omiti-los muda o token e a autenticacao falha com uma mensagem que nao
   * explica nada.
   */
  const autorizacao = (token: string): string =>
    `Basic ${Buffer.from(`${token}:`, 'utf8').toString('base64')}`

  async function chamar(
    caminho: string,
    init: { method: string; token: string; body?: unknown },
  ): Promise<{ status: number; corpo: Record<string, unknown> }> {
    const controle = new AbortController()
    const relogio = setTimeout(() => controle.abort(), timeoutMs)

    try {
      const resposta = await buscar(`${base}/v2${caminho}`, {
        method: init.method,
        headers: {
          authorization: autorizacao(init.token),
          'content-type': 'application/json',
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: controle.signal,
      })

      const texto = await resposta.text()

      /*
       * Corpo ilegivel e falha de INFRAESTRUTURA, e por isso lanca: a porta diz
       * que so infraestrutura lanca, e "o provedor respondeu HTML de erro" e
       * exatamente isso. Traduzir para rejeicao faria o job desistir de uma nota
       * que talvez tenha sido autorizada do outro lado.
       */
      let corpo: Record<string, unknown>
      try {
        corpo = texto === '' ? {} : (JSON.parse(texto) as Record<string, unknown>)
      } catch {
        throw new ErroDeIntegracao(
          `Focus NFe respondeu ${resposta.status} com corpo ilegivel em ${caminho}.`,
          {
            provedor: 'focusnfe',
            operacao: `${init.method} ${caminho}`,
            status: resposta.status,
            resposta: texto,
          },
        )
      }

      return { status: resposta.status, corpo }
    } finally {
      clearTimeout(relogio)
    }
  }

  /** Credencial ausente e configuracao, nao rejeicao fiscal: lanca. */
  async function credenciais(companyId: string): Promise<{ token: string; cnpj: string }> {
    const [token, cnpj] = await Promise.all([
      opcoes.credenciais.tokenDe(companyId),
      opcoes.credenciais.cnpjDe(companyId),
    ])

    if (token === undefined || cnpj === undefined) {
      throw new Error(
        `Empresa ${companyId} nao tem emissao fiscal habilitada (token ou CNPJ ausente).`,
      )
    }

    return { token, cnpj }
  }

  function corpoDaNota(
    request: IssueInvoiceRequest,
    cnpjEmitente: string,
  ): Record<string, unknown> {
    return {
      cnpj_emitente: cnpjEmitente,
      data_emissao: request.requestedAt,
      /* 1 = presencial. O balcao e presencial por definicao; entrega em
         domicilio (4) viria de outro fluxo, que ainda nao existe. */
      presenca_comprador: 1,
      /* 9 = sem frete. Venda de balcao nao transporta. */
      modalidade_frete: 9,
      /* 1 = operacao interna. NFC-e e sempre dentro do estado — venda
         interestadual exige NF-e, que e outro documento. */
      local_destino: 1,
      natureza_operacao: 'Venda ao consumidor',
      serie: request.series,

      ...(request.recipient?.name === undefined
        ? {}
        : { nome_destinatario: request.recipient.name }),
      ...(request.recipient?.document === undefined
        ? {}
        : request.recipient.document.length === 11
          ? { cpf_destinatario: request.recipient.document }
          : { cnpj_destinatario: request.recipient.document }),

      items: request.items.map((item, i) => ({
        numero_item: i + 1,
        codigo_produto: item.productId,
        descricao: item.description,
        codigo_ncm: item.ncm,
        cfop: item.cfop,
        unidade_comercial: UNIDADE[item.unitOfMeasure] ?? 'UN',
        unidade_tributavel: UNIDADE[item.unitOfMeasure] ?? 'UN',
        quantidade_comercial: item.quantity,
        quantidade_tributavel: item.quantity,
        valor_unitario_comercial: reaisDeCentavos(item.unitPriceCents),
        valor_unitario_tributavel: reaisDeCentavos(item.unitPriceCents),
        valor_bruto: reaisDeCentavos(item.unitPriceCents * item.quantity),
        /* 0 = nacional. Origem por item existe no XML e nao no nosso cadastro;
           assumir importado seria pior que assumir nacional. */
        icms_origem: 0,
        icms_situacao_tributaria: item.taxSituationCode,
      })),

      formas_pagamento: request.payments.map((p) => ({
        forma_pagamento: FORMA_DE_PAGAMENTO[p.method] ?? '99',
        valor_pagamento: reaisDeCentavos(p.amountCents),
      })),
    }
  }

  /** A resposta do provedor para o resultado do contrato. */
  function paraResultado(corpo: RespostaDeNota, request: IssueInvoiceRequest): InvoiceIssueResult {
    const rejeicao = (): InvoiceIssueResult => ({
      status: 'rejected',
      rejection: {
        code:
          corpo.status_sefaz ?? corpo.codigo ?? corpo.erros?.[0]?.codigo ?? 'FOCUS-DESCONHECIDO',
        message:
          corpo.mensagem_sefaz ??
          corpo.mensagem ??
          corpo.erros?.[0]?.mensagem ??
          'A SEFAZ recusou a nota e nao explicou o motivo.',
      },
    })

    /*
     * DENEGADA nao e recusada — RF-047.
     *
     * A SEFAZ tem cinco desfechos documentados: `autorizado`,
     * `erro_autorizacao`, `denegado`, `cancelado` e
     * `processando_autorizacao`. Tudo que nao fosse `autorizado` caia na mesma
     * rejeicao generica, e isso achatava a diferenca que mais custa dinheiro.
     *
     * Denegacao acontece quando ha irregularidade fiscal do emitente ou do
     * destinatario, e ela CONSOME O NUMERO: a nota denegada existe, nao pode
     * ser reemitida com a mesma numeracao e nao pode ser cancelada. Uma
     * rejeicao comum, ao contrario, deixa o numero livre para tentar de novo.
     *
     * Dizer "a SEFAZ recusou, tente de novo" a quem levou denegacao manda o
     * lojista repetir uma operacao que nunca vai passar, em vez de mandar ele
     * regularizar a situacao cadastral — que e o unico caminho.
     */
    if (corpo.status === 'denegado') {
      return {
        status: 'rejected',
        rejection: {
          code: corpo.status_sefaz ?? 'SEFAZ-DENEGADA',
          message:
            (corpo.mensagem_sefaz ?? 'A SEFAZ denegou a nota.') +
            ' Denegacao e irregularidade cadastral do emitente ou do destinatario: ' +
            'o numero foi consumido, a nota nao pode ser reemitida nem cancelada, ' +
            'e reenviar nao resolve. Regularize a situacao fiscal antes de emitir de novo.',
        },
      }
    }

    if (corpo.status !== 'autorizado') return rejeicao()

    const chave = corpo.chave_nfe
    const numero = Number(corpo.numero)
    const serie = Number(corpo.serie)

    /*
     * `autorizado` sem chave, ou com numero ilegivel, e resposta quebrada do
     * provedor — nao uma autorizacao. Aceitar produziria uma nota sem chave no
     * banco, e a constraint recusaria a gravacao DEPOIS de a SEFAZ ja ter
     * autorizado: a pior ordem possivel.
     */
    if (chave === undefined || !Number.isInteger(numero) || numero <= 0) {
      return {
        status: 'rejected',
        rejection: {
          code: 'FOCUS-RESPOSTA-INCOMPLETA',
          message: 'O provedor autorizou a nota mas nao devolveu chave e numero.',
        },
      }
    }

    /* Contingencia offline: a nota tem chave e numero, e ainda nao tem
       protocolo da SEFAZ. `danfeUrl` nao existe nesse estado. */
    if (corpo.contingencia_offline === true) {
      return {
        status: 'contingency',
        accessKey: chave,
        number: numero,
        series: Number.isInteger(serie) && serie > 0 ? serie : request.series,
        xml: corpo.caminho_xml_nota_fiscal ?? '',
        issuedAt: request.requestedAt,
        reason: corpo.mensagem_sefaz ?? 'SEFAZ indisponivel; nota emitida em contingencia.',
      }
    }

    return {
      status: 'authorized',
      accessKey: chave,
      number: numero,
      series: Number.isInteger(serie) && serie > 0 ? serie : request.series,
      danfeUrl: `${base}${corpo.caminho_danfe ?? ''}`,
      xml: corpo.caminho_xml_nota_fiscal ?? '',
      issuedAt: request.requestedAt,
    }
  }

  return {
    async issue(request: IssueInvoiceRequest): Promise<InvoiceIssueResult> {
      /*
       * A guarda responde ANTES da rede.
       *
       * Nota duplicada nao e inconveniencia, e problema fiscal (RNF-043). O
       * `ref` do Focus tambem recusaria a segunda emissao, mas como ERRO — e
       * traduzir erro de volta em "aqui esta a sua nota" exigiria uma consulta
       * a mais para descobrir qual nota era.
       */
      const guardada = await opcoes.store.findBySale(request.companyId, request.saleId)
      if (guardada !== undefined) return guardada.resultado

      /*
       * Validacao ANTES de transmitir — RF-046.
       *
       * Recusar aqui e barato; recusar na SEFAZ gasta transmissao, entra no
       * historico do emitente e volta com um codigo que ninguem le. E o schema
       * e o mesmo que o resto do sistema usa, entao "valido aqui" e "valido la"
       * nao podem divergir.
       */
      const validado = issueInvoiceRequestSchema.safeParse(request)
      if (!validado.success) {
        const primeiro = validado.error.issues[0]
        const onde = primeiro?.path.join('.') ?? 'pedido'
        return {
          status: 'rejected',
          rejection: {
            code: LOCAL_REJECTION_CODES.validation,
            message: `${primeiro?.message ?? 'Dados fiscais invalidos.'} (${onde})`,
          },
        }
      }

      const { token, cnpj } = await credenciais(request.companyId)

      const { corpo } = await chamar(`/nfce?ref=${encodeURIComponent(request.saleId)}`, {
        method: 'POST',
        token,
        body: corpoDaNota(request, cnpj),
      })

      const resultado = paraResultado(corpo as RespostaDeNota, request)

      /*
       * Guarda ate a REJEICAO, e nao so o sucesso.
       *
       * Sem isso, uma venda rejeitada seria retransmitida a cada reprocessamento
       * do job — e a rejeicao que a tela precisa mostrar (RF-047) so existiria
       * na memoria de quem chamou.
       *
       * `save` devolve o vencedor: se outra execucao gravou no meio do caminho,
       * a nota dela e a que vale, e as duas emissoes dao uma nota so.
       */
      const gravada: NotaGuardada = await opcoes.store.save({
        companyId: request.companyId,
        saleId: request.saleId,
        resultado,
      })

      return gravada.resultado
    },

    /**
     * Consulta o estado atual — RF-053.
     *
     * `GET /nfce/{ref}`, com a referencia que e o nosso `saleId`. NAO emite: se
     * o provedor nao conhece a referencia, isto devolve `undefined` em vez de
     * criar a nota — confundir consulta com emissao faria uma reconciliacao
     * gerar documentos fiscais.
     *
     * A efetivacao EXISTE na documentacao do provedor, e nao serve para nos:
     * `PUT /v2/fiscal/nfce/{ref}/efetivar` pertence ao Comunicador Offline, um
     * agente instalado NA LOJA, e responde em `localhost:55555`. Nossa emissao
     * fala com a API na nuvem, de um servidor — nao ha localhost de loja
     * nenhuma ao alcance. (Registro isto porque antes escrevi aqui que o
     * provedor "nao documenta", o que estava errado: documenta, para outra
     * arquitetura.)
     *
     * Na nuvem ha um campo `contingencia_offline_efetivada` que sugere que
     * ele resolve sozinho, e sugerir nao basta para um documento fiscal. Por
     * isso o que fazemos e PERGUNTAR: se a nota autorizou, a guarda passa a
     * refletir isso; se nao, ela continua em contingencia, visivel.
     */
    async consult(request: {
      companyId: string
      saleId: string
    }): Promise<InvoiceIssueResult | undefined> {
      const { token } = await credenciais(request.companyId)

      const { status, corpo } = await chamar(`/nfce/${encodeURIComponent(request.saleId)}`, {
        method: 'GET',
        token,
      })

      /* 404: o provedor nao conhece esta referencia. Nao e erro — e "essa venda
         nunca foi transmitida". */
      if (status === 404) return undefined

      const resposta = corpo as RespostaDeNota

      /* Ainda processando nao e desfecho: devolver `rejected` aqui marcaria como
         recusada uma nota que talvez autorize em segundos. */
      if (resposta.status === 'processando_autorizacao') return undefined

      /*
       * Ja cancelada tambem nao e desfecho de EMISSAO.
       *
       * Sem isto, a consulta a uma nota cancelada caia na rejeicao generica e
       * voltava como `rejected`. Na reconciliacao de contingencia (RF-053) isso
       * TRAVA a fila: o laco para na primeira nao autorizada, e uma cancelada
       * ficaria ali para sempre, impedindo todas as posteriores de serem
       * reconhecidas. `undefined` e "esta venda nao tem nota valendo", que e a
       * verdade — e quem cuida de cancelamento e a guarda, nao a emissao.
       */
      if (resposta.status === 'cancelado') return undefined

      return paraResultado(resposta, {
        companyId: request.companyId,
        saleId: request.saleId,
        series: Number(resposta.serie) || 1,
        requestedAt: new Date().toISOString(),
      } as IssueInvoiceRequest)
    },

    async cancel(request: CancelInvoiceRequest): Promise<InvoiceCancellation> {
      /*
       * Valida ANTES de transmitir, como na emissao.
       *
       * A SEFAZ exige justificativa de 15 a 255 caracteres. Mandar uma curta
       * gasta uma transmissao para receber de volta um codigo numerico que
       * ninguem le — e o mesmo schema que o resto do sistema usa ja sabe a
       * regra. Foi a suite de contrato que cobrou isto.
       */
      const validado = cancelInvoiceRequestSchema.safeParse(request)
      if (!validado.success) {
        const primeiro = validado.error.issues[0]
        const onde = primeiro?.path.join('.') ?? 'pedido'
        return {
          status: 'rejected',
          rejection: {
            code: LOCAL_REJECTION_CODES.validation,
            message: `${primeiro?.message ?? 'Pedido de cancelamento invalido.'} (${onde})`,
          },
        }
      }

      /*
       * Chave -> referencia. E por isto que a guarda existe: o Focus cancela
       * por `ref` (`DELETE /nfce/{ref}`) e a porta cancela por chave, e nao ha
       * endpoint que traduza.
       *
       * Nota de outra empresa nao e encontrada — 404 e nao 403, porque 403
       * confirmaria que a chave existe.
       */
      const guardada = await opcoes.store.findByAccessKey(request.companyId, request.accessKey)

      if (guardada === undefined) {
        return {
          status: 'rejected',
          rejection: {
            code: LOCAL_REJECTION_CODES.notFound,
            message: 'Nota nao encontrada para esta empresa.',
          },
        }
      }

      const { token } = await credenciais(request.companyId)

      const { corpo } = await chamar(`/nfce/${encodeURIComponent(guardada.saleId)}`, {
        method: 'DELETE',
        token,
        body: { justificativa: request.reason },
      })

      const resposta = corpo as RespostaDeCancelamento

      if (resposta.status !== 'cancelado') {
        return {
          status: 'rejected',
          rejection: {
            code: resposta.status_sefaz ?? resposta.codigo ?? 'FOCUS-CANCELAMENTO-RECUSADO',
            message:
              resposta.mensagem_sefaz ??
              resposta.mensagem ??
              'A SEFAZ recusou o cancelamento e nao explicou o motivo.',
          },
        }
      }

      const protocolo = resposta.numero_protocolo ?? ''
      const xml = resposta.caminho_xml_cancelamento ?? ''

      /*
       * Cancelamento sem protocolo nao e cancelamento: o protocolo e a prova
       * perante a SEFAZ. Sem ele o lojista teria uma nota marcada como
       * cancelada e nada para mostrar numa fiscalizacao.
       */
      if (protocolo === '') {
        return {
          status: 'rejected',
          rejection: {
            code: 'FOCUS-CANCELAMENTO-SEM-PROTOCOLO',
            message: 'O provedor cancelou a nota mas nao devolveu o protocolo.',
          },
        }
      }

      await opcoes.store.markCancelled(request.companyId, request.accessKey, {
        protocol: protocolo,
        xml,
        cancelledAt: request.requestedAt,
      })

      return {
        status: 'cancelled',
        accessKey: request.accessKey,
        protocol: protocolo,
        xml,
        cancelledAt: request.requestedAt,
      }
    },
  }
}
