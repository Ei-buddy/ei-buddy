import {
  type CancelServiceInvoiceRequest,
  cancelServiceInvoiceRequestSchema,
  ErroDeIntegracao,
  LOCAL_REJECTION_CODES,
  type ServiceInvoiceCancellation,
  type ServiceInvoiceRequest,
  serviceInvoiceRequestSchema,
  type ServiceInvoiceResult,
  type SimplesNacionalOption,
} from '@na-regua/contracts'
import { type ChamadaFocus, criarChamadaFocus, referenciaFocus } from './focusnfe-http.js'
import { type AmbienteFocusNfe, FOCUS_NFE_URLS, reaisDeCentavos } from './focusnfe-issuer.js'

/**
 * Emissor de NFS-e no padrao nacional — Focus NFe, `/v2/nfsen`. DEC-031, NR-240.
 *
 * Os nomes e valores dos campos sao os da documentacao da Focus, copiada em
 * `docs/assets/focus-nfse-nacional/` (`emitir_dps_nacional.md` e a lista
 * completa de campos em `EmissaoDPSXml.html`).
 *
 * ## Tres coisas do provedor que moldam o codigo
 *
 * 1. **E ASSINCRONA.** O `POST` so pre-valida e devolve `202` com
 *    `processando_autorizacao`. Autorizacao ou rejeicao chegam depois, pela
 *    consulta (`GET /v2/nfsen/{ref}`) — e quem consulta de novo e o worker.
 * 2. **A referencia e nossa e nao se repete.** `"Ja existe um DPS com esta
 *    referencia"` e o 422 de quem reenvia. Por isso `issue` CONSULTA antes de
 *    enviar: um job que caiu depois de a Focus aceitar o pedido acha a nota na
 *    segunda volta, em vez de receber um erro e desistir dela. Nota rejeitada
 *    e a excecao — a Focus aceita o reenvio corrigido com a mesma referencia.
 * 3. **A numeracao e da Focus.** Serie e proximo numero da DPS ficam no cadastro
 *    da empresa (`serie_nfsen_*`, `proximo_numero_nfsen_*`, calculado
 *    automaticamente), e a nota sai sem `serie_dps` nem `numero_dps`.
 */

export type CredenciaisNfsen = {
  /** Token de emissao da empresa, ou `undefined` se ela nao emite. */
  tokenDe(companyId: string): Promise<string | undefined>
}

export type EmissorNfsenOptions = {
  readonly ambiente: AmbienteFocusNfe
  readonly credenciais: CredenciaisNfsen
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
}

export type EmissorNfsen = {
  issue(request: ServiceInvoiceRequest): Promise<ServiceInvoiceResult>
  /** `undefined` quando a Focus nao conhece a referencia (nunca foi enviada). */
  consult(request: {
    readonly companyId: string
    readonly saleId: string
  }): Promise<ServiceInvoiceResult | undefined>
  cancel(request: CancelServiceInvoiceRequest): Promise<ServiceInvoiceCancellation>
}

const TIMEOUT_PADRAO_MS = 20_000

/**
 * A referencia da NFS-e na Focus: so letras e numeros, como a Focus pede
 * (`docs/arquitetura/integracoes/focusnfe.md`, "Referencia").
 *
 * O `saleId` sem os hifens, com o sufixo `nfse`: a mesma venda pode ter as duas
 * notas, e a referencia e unica por token — uma nao pode valer pelas duas.
 */
export function referenciaDaNfsen(saleId: string): string {
  return referenciaFocus(saleId, 'nfse')
}

/**
 * O instante no fuso de Brasilia, como a DPS pede (`AAAA-MM-DDThh:mm:ssTZD`).
 *
 * Sem `Z` nem milissegundos: o padrao nacional descreve o fuso como deslocamento,
 * e o Brasil nao tem horario de verao desde 2019, entao -03:00 e fixo.
 */
export function horarioDeBrasilia(iso: string): string {
  const deslocado = new Date(Date.parse(iso) - 3 * 60 * 60 * 1000)
  return `${deslocado.toISOString().slice(0, 19)}-03:00`
}

/** `opSimpNac`: 1 nao optante, 2 MEI, 3 ME/EPP. */
const OPCAO_SIMPLES: Record<SimplesNacionalOption, number> = {
  not_optant: 1,
  mei: 2,
  me_epp: 3,
}

/** Centavos para o decimal da API (`Decimal[15.2]`, numero no JSON). */
const reais = (centavos: number): number => Number(reaisDeCentavos(centavos))

/**
 * O corpo da DPS como a Focus nomeia os campos.
 *
 * Recebe o pedido JA validado: os documentos ja chegam so com digitos.
 */
export function corpoDaNfsen(request: ServiceInvoiceRequest): Record<string, unknown> {
  const p = request.provider
  const s = request.service
  const tomador = request.recipient

  return {
    data_emissao: horarioDeBrasilia(request.requestedAt),
    data_competencia: request.competenceDate,
    /* 1 = o proprio prestador emite. */
    emitente_dps: 1,
    codigo_municipio_emissora: Number(p.cityIbgeCode),
    cnpj_prestador: p.cnpj,
    ...(p.municipalRegistration === undefined
      ? {}
      : { inscricao_municipal_prestador: p.municipalRegistration }),
    codigo_opcao_simples_nacional: OPCAO_SIMPLES[p.simplesNacional],
    /*
     * ME/EPP do Simples informa como apura: 1 = federais e ISS dentro do
     * Simples, o caso de quase toda loja pequena. MEI e nao optante nao
     * informam.
     */
    ...(p.simplesNacional === 'me_epp' ? { regime_tributario_simples_nacional: 1 } : {}),
    /* 0 = nenhum regime especial municipal (cooperativa, estimativa, etc.). */
    regime_especial_tributacao: 0,

    ...(tomador === undefined
      ? {}
      : {
          ...(tomador.document.length === 11
            ? { cpf_tomador: tomador.document }
            : { cnpj_tomador: tomador.document }),
          ...(tomador.name === undefined ? {} : { razao_social_tomador: tomador.name }),
          ...(tomador.email === undefined ? {} : { email_tomador: tomador.email }),
        }),

    /* O servico e prestado na loja: o municipio da prestacao e o dela. */
    codigo_municipio_prestacao: p.cityIbgeCode,
    codigo_tributacao_nacional_iss: s.nationalServiceCode,
    ...(s.nbsCode === undefined ? {} : { codigo_nbs: s.nbsCode }),
    descricao_servico: s.description,
    valor_servico: reais(s.amountCents),
    ...(s.discountCents === undefined || s.discountCents === 0
      ? {}
      : { desconto_incondicionado: reais(s.discountCents) }),

    /* 1 = operacao tributavel; 1 = ISS nao retido pelo tomador. */
    tributacao_iss: 1,
    tipo_retencao_iss: 1,
    /*
     * A aliquota da loja (DEC-031). O MEI recolhe ISS fixo no DAS e nao
     * informa. Para municipio do Sistema Nacional a aliquota ja esta
     * parametrizada; para os outros, e o emitente quem informa.
     */
    ...(s.issRatePercent === undefined || p.simplesNacional === 'mei'
      ? {}
      : { percentual_aliquota_relativa_municipio: s.issRatePercent }),

    /*
     * Reforma Tributaria — obrigatorios na lista de campos da Focus.
     * 0 = NFS-e regular; consumidor final quando o tomador nao e empresa;
     * 0 = o destinatario e o proprio tomador. IBS/CBS: CST 000 (tributacao
     * integral) e classificacao 000001, os do caso geral.
     */
    finalidade_emissao: 0,
    consumidor_final: tomador?.document.length === 14 ? 0 : 1,
    indicador_destinatario: 0,
    ibs_cbs_situacao_tributaria: '000',
    ibs_cbs_classificacao_tributaria: '000001',
  }
}

/** O que a API devolve na emissao e na consulta. Campos verbatim do provedor. */
type RespostaDaNfsen = {
  status?: string
  numero?: string | number
  codigo_verificacao?: string
  data_emissao?: string
  url?: string
  url_danfse?: string
  caminho_xml_nota_fiscal?: string
  erros?: { codigo?: string; mensagem?: string; correcao?: string }[]
  codigo?: string
  mensagem?: string
}

/** A chave de 50 digitos, que vem no link publico ou no nome do XML. */
function chaveDe(corpo: RespostaDaNfsen): string | undefined {
  const doLink = corpo.url?.match(/chave=(\d{50})/)?.[1]
  if (doLink !== undefined) return doLink
  return corpo.caminho_xml_nota_fiscal?.match(/NFS(\d{50})/)?.[1]
}

/** Os erros da Focus numa rejeicao so, com a correcao quando ela vem. */
type Rejeicao = Extract<ServiceInvoiceResult, { status: 'rejected' }>

function rejeicaoDe(corpo: RespostaDaNfsen, padrao: string): Rejeicao {
  const erros = corpo.erros ?? []
  const mensagens = erros
    .slice(0, 3)
    .map((e) => [e.mensagem, e.correcao].filter((v) => v !== undefined && v !== '').join(' '))
    .filter((m) => m !== '')

  return {
    status: 'rejected',
    rejection: {
      code: erros[0]?.codigo ?? corpo.codigo ?? 'FOCUS-DESCONHECIDO',
      message: mensagens.length > 0 ? mensagens.join(' | ') : (corpo.mensagem ?? padrao),
    },
  }
}

/** Data com fuso valida, ou `undefined`. */
function instante(v: string | undefined): string | undefined {
  if (v === undefined || Number.isNaN(Date.parse(v))) return undefined
  return /([+-]\d{2}:?\d{2}|Z)$/.test(v) ? v : undefined
}

/** A resposta de emissao ou consulta para o resultado do contrato. */
export function paraResultadoDaNfsen(corpo: RespostaDaNfsen): ServiceInvoiceResult {
  switch (corpo.status) {
    case 'processando_autorizacao':
      return { status: 'processing' }

    case 'erro_autorizacao':
      return rejeicaoDe(corpo, 'O Ambiente Nacional recusou a NFS-e e nao explicou o motivo.')

    case 'negado':
      return rejeicaoDe(corpo, 'O Ambiente Nacional negou a NFS-e.')

    case 'cancelado': {
      const chave = chaveDe(corpo)
      return {
        status: 'cancelled',
        ...(corpo.numero === undefined ? {} : { number: String(corpo.numero) }),
        ...(chave === undefined ? {} : { accessKey: chave }),
      }
    }

    case 'autorizado': {
      const numero = corpo.numero === undefined ? '' : String(corpo.numero)
      const danfse = corpo.url_danfse ?? corpo.url
      const xml = corpo.caminho_xml_nota_fiscal
      const emitidaEm = instante(corpo.data_emissao)

      /*
       * Autorizada, mas sem numero, PDF ou XML: o provedor ainda esta montando
       * os arquivos. Continua "processando" e a proxima consulta completa —
       * marcar como rejeitada uma nota que o Ambiente Nacional autorizou seria
       * o pior erro possivel aqui.
       */
      if (numero === '' || danfse === undefined || xml === undefined || emitidaEm === undefined) {
        return { status: 'processing' }
      }

      const chave = chaveDe(corpo)
      return {
        status: 'authorized',
        number: numero,
        ...(chave === undefined ? {} : { accessKey: chave }),
        ...(corpo.codigo_verificacao === undefined
          ? {}
          : { verificationCode: corpo.codigo_verificacao }),
        danfseUrl: danfse,
        ...(corpo.url === undefined ? {} : { publicUrl: corpo.url }),
        xmlPath: xml,
        issuedAt: emitidaEm,
      }
    }

    default:
      /* Estado que a documentacao nao lista: consultar de novo e mais seguro
         que adivinhar um desfecho. O worker tem teto de tentativas. */
      return { status: 'processing' }
  }
}

/** Resposta 5xx e falha do provedor, nao recusa da nota: lanca para o job tentar de novo. */
function falhaDoProvedor(status: number, operacao: string, corpo: unknown): ErroDeIntegracao {
  return new ErroDeIntegracao(`Focus NFe respondeu ${status} em ${operacao}.`, {
    provedor: 'focusnfe',
    operacao,
    status,
    resposta: JSON.stringify(corpo),
  })
}

export function criarEmissorNfsenFocus(opcoes: EmissorNfsenOptions): EmissorNfsen {
  const chamar: ChamadaFocus = criarChamadaFocus({
    base: FOCUS_NFE_URLS[opcoes.ambiente],
    ...(opcoes.fetch === undefined ? {} : { fetch: opcoes.fetch }),
    timeoutMs: opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS,
  })

  /** Credencial ausente e configuracao, nao rejeicao fiscal: lanca. */
  async function tokenDe(companyId: string): Promise<string> {
    const token = await opcoes.credenciais.tokenDe(companyId)
    if (token === undefined) {
      throw new Error(`Empresa ${companyId} nao tem emissao fiscal habilitada (token ausente).`)
    }
    return token
  }

  async function consultar(token: string, ref: string): Promise<ServiceInvoiceResult | undefined> {
    const caminho = `/nfsen/${ref}`
    const { status, corpo } = await chamar(caminho, { method: 'GET', token })
    if (status === 404) return undefined
    if (status >= 500) throw falhaDoProvedor(status, `GET ${caminho}`, corpo)
    return paraResultadoDaNfsen(corpo as RespostaDaNfsen)
  }

  return {
    async issue(request) {
      const validado = serviceInvoiceRequestSchema.safeParse(request)
      if (!validado.success) {
        const primeiro = validado.error.issues[0]
        const onde = primeiro?.path.join('.') ?? 'pedido'
        return {
          status: 'rejected',
          rejection: {
            code: LOCAL_REJECTION_CODES.validation,
            message: `${primeiro?.message ?? 'Dados da NFS-e invalidos.'} (${onde})`,
          },
        }
      }

      const pedido = validado.data
      const token = await tokenDe(pedido.companyId)
      const ref = referenciaDaNfsen(pedido.saleId)

      /*
       * Ja enviada (o job caiu depois de a Focus aceitar): devolve o estado
       * dela, e nao um segundo envio que voltaria como erro. A excecao e a
       * REJEITADA: pedir de novo e a correcao, e a Focus aceita o reenvio com
       * a mesma referencia enquanto a nota nao foi autorizada.
       */
      const existente = await consultar(token, ref)
      if (existente !== undefined && existente.status !== 'rejected') return existente

      const caminho = `/nfsen?ref=${ref}`
      const { status, corpo } = await chamar(caminho, {
        method: 'POST',
        token,
        body: corpoDaNfsen(pedido),
      })

      if (status >= 500) throw falhaDoProvedor(status, `POST ${caminho}`, corpo)

      /* 400 e 422: a pre-validacao da Focus recusou, de forma sincrona. */
      if (status >= 400) {
        return rejeicaoDe(corpo as RespostaDaNfsen, 'A Focus NFe recusou a NFS-e.')
      }

      return paraResultadoDaNfsen(corpo as RespostaDaNfsen)
    },

    async consult(request) {
      const token = await tokenDe(request.companyId)
      return consultar(token, referenciaDaNfsen(request.saleId))
    },

    async cancel(request) {
      const validado = cancelServiceInvoiceRequestSchema.safeParse(request)
      if (!validado.success) {
        return {
          status: 'rejected',
          rejection: {
            code: LOCAL_REJECTION_CODES.validation,
            message: validado.error.issues[0]?.message ?? 'Pedido de cancelamento invalido.',
          },
        }
      }

      const pedido = validado.data
      const token = await tokenDe(pedido.companyId)
      const caminho = `/nfsen/${referenciaDaNfsen(pedido.saleId)}`
      const { status, corpo } = await chamar(caminho, {
        method: 'DELETE',
        token,
        body: { justificativa: pedido.reason },
      })

      if (status === 404) {
        return {
          status: 'rejected',
          rejection: {
            code: LOCAL_REJECTION_CODES.notFound,
            message: 'A Focus NFe nao conhece esta NFS-e.',
          },
        }
      }
      if (status >= 500) throw falhaDoProvedor(status, `DELETE ${caminho}`, corpo)

      const resposta = corpo as RespostaDaNfsen
      if (resposta.status === 'cancelado') return { status: 'cancelled' }

      return rejeicaoDe(resposta, 'O Ambiente Nacional recusou o cancelamento.')
    },
  }
}
