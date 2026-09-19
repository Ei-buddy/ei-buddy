import { timingSafeEqual } from 'node:crypto'
import { createSubscriptionRequestSchema } from '@na-regua/contracts'
import type {
  CreateSubscriptionRequest,
  ProviderSubscription,
  SubscriptionEventType,
  SubscriptionWebhookResult,
} from '@na-regua/contracts'

/**
 * Assinatura do SaaS no Asaas — NR-063, ADR-0004.
 *
 * Satisfaz `SubscriptionProvider` (declarada em `core`) estruturalmente: a
 * regra de fronteira proibe `billing` de importar `core`, entao o vocabulario
 * vem de `contracts` — mesmo desenho de `criarGatewayAsaas`.
 *
 * ## Conta-pai, e uma chave so
 *
 * Aqui esta a diferenca que justifica `billing` existir separado de
 * `payments`: la cada loja e uma SUBCONTA com chave propria, porque o dinheiro
 * e dela. Aqui o dinheiro e NOSSO, a conta e uma so, e o "cliente" e o
 * lojista. Por isso a chave e uma string de ambiente e nao uma porta por
 * empresa — resolver chave por `companyId` aqui seria cobrar a mensalidade na
 * conta do proprio lojista.
 *
 * ## Criar a recorrencia nao e o lojista ter pago
 *
 * O POST devolve a assinatura em estado pendente. Quem ativa o acesso e o
 * evento `subscription.paid`, lido no webhook — nunca esta chamada.
 */

export type AmbienteAsaas = 'sandbox' | 'producao'

export type AsaasSubscriptionOptions = {
  readonly ambiente: AmbienteAsaas
  /** Chave da CONTA-PAI (`ASAAS_API_KEY`). Nunca a de uma subconta. */
  readonly apiKey: string
  /**
   * O `authToken` que cadastramos nos webhooks da conta-pai — RNF-028.
   *
   * O Asaas nao assina o corpo: ele repete este mesmo valor no cabecalho
   * `asaas-access-token` de cada aviso. Sem ele o adapter recusa TODO webhook,
   * em vez de aceitar sem conferir.
   */
  readonly webhookAuthToken?: string
  /** Injetavel para teste. Sem isto, o teste falaria com o Asaas de verdade. */
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
}

const URLS: Record<AmbienteAsaas, string> = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  producao: 'https://api.asaas.com/v3',
}

const TIMEOUT_PADRAO_MS = 15_000

export function criarProvedorDeAssinaturaAsaas(opcoes: AsaasSubscriptionOptions) {
  const buscar = opcoes.fetch ?? globalThis.fetch
  const base = URLS[opcoes.ambiente]
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS

  async function chamar(
    caminho: string,
    init: { method: string; body?: unknown } = { method: 'GET' },
  ): Promise<{ ok: boolean; status: number; corpo: Record<string, unknown> }> {
    const resposta = await buscar(`${base}${caminho}`, {
      method: init.method,
      headers: { access_token: opcoes.apiKey, 'content-type': 'application/json' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      /* `AbortSignal.timeout` e nao um setTimeout solto: o segundo deixa a
         requisicao correndo depois de a promessa rejeitar. */
      signal: AbortSignal.timeout(timeoutMs),
    })

    const corpo = (await resposta.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: resposta.ok, status: resposta.status, corpo }
  }

  /**
   * A recorrencia ja existente com esta referencia, se houver.
   *
   * E o que torna `createSubscription` idempotente: o Asaas nao tem chave de
   * idempotencia no POST, entao a garantia sai de consultar por
   * `externalReference` antes. Duas recorrencias para um lojista sao ele
   * pagando em dobro todo mes — e descobrindo no extrato, nao aqui.
   */
  async function porReferencia(
    externalReference: string,
  ): Promise<Record<string, unknown> | undefined> {
    const { corpo } = await chamar(
      `/subscriptions?externalReference=${encodeURIComponent(externalReference)}`,
    )
    const lista = Array.isArray(corpo.data) ? (corpo.data as Record<string, unknown>[]) : []
    /* Cancelada nao serve como "ja existe": o lojista que encerrou e voltou
       precisa de uma recorrencia nova, nao da carcaca da antiga. */
    return lista.find((s) => String(s.status ?? '') !== 'INACTIVE')
  }

  return {
    createSubscription: async (
      request: CreateSubscriptionRequest,
    ): Promise<ProviderSubscription> => {
      /*
       * Valida antes de chamar a rede — e o unico metodo daqui que o faz.
       *
       * `amountCents` chega de um calculo de desconto, e um zero que passasse
       * criaria uma recorrencia que nunca cobra: o lojista usaria o sistema de
       * graca e ninguem descobriria ate o fechamento do mes. O schema recusa
       * antes de o Asaas aceitar.
       */
      const validado = createSubscriptionRequestSchema.parse(request)

      const existente = await porReferencia(validado.externalReference)

      const assinatura =
        existente ??
        (
          await chamar('/subscriptions', {
            method: 'POST',
            body: {
              customer: validado.customerReference,
              /* `UNDEFINED` deixa o lojista escolher Pix, boleto ou cartao na
                 hora de pagar. Fixar um meio aqui decidiria por ele, e o
                 recorte da DEC-010 e "mensalidade", nao "mensalidade no
                 cartao". */
              billingType: 'UNDEFINED',
              cycle: 'MONTHLY',
              value: centavosParaDecimal(validado.amountCents),
              nextDueDate: validado.firstDueDate,
              description: `EiBuddy — plano ${validado.planCode}`,
              externalReference: validado.externalReference,
            },
          })
        ).corpo

      const id = String(assinatura.id ?? '')
      if (id === '') throw new Error('O Asaas nao devolveu id da assinatura.')

      return {
        providerSubscriptionId: id,
        externalReference: validado.externalReference,
        /* Cru, como o provedor escreve — vai para `provider_status`. Traduzir
           aqui daria a impressao de que o estado DELE manda no acesso do
           lojista, e quem manda e a nossa tabela. */
        providerStatus: String(assinatura.status ?? 'PENDING'),
        nextDueDate: String(assinatura.nextDueDate ?? validado.firstDueDate),
      }
    },

    cancelSubscription: async (request: {
      companyId: string
      providerSubscriptionId: string
      reason: string
      requestedAt: string
    }): Promise<void> => {
      const { ok, status } = await chamar(`/subscriptions/${request.providerSubscriptionId}`, {
        method: 'DELETE',
      })

      /*
       * 404 e sucesso: cancelar o que nao existe mais e exatamente o estado
       * desejado. Lancar aqui prenderia o lojista a uma cobranca porque uma
       * tentativa anterior ja tinha funcionado pela metade.
       */
      if (!ok && status !== 404) {
        throw new Error(`O Asaas recusou o cancelamento da assinatura (HTTP ${status}).`)
      }
    },

    readWebhook: (rawBody: string, signature: string): SubscriptionWebhookResult => {
      /* Token ausente recusa TUDO. Aceitar sem conferir seria transformar
         configuracao faltando em porta aberta — qualquer um postaria
         "mensalidade paga" e a loja bloqueada voltaria a funcionar. */
      if (opcoes.webhookAuthToken === undefined) return { status: 'invalid_signature' }
      if (!tokenConfere(signature, opcoes.webhookAuthToken)) {
        return { status: 'invalid_signature' }
      }

      let corpo: Record<string, unknown>
      try {
        corpo = JSON.parse(rawBody) as Record<string, unknown>
      } catch {
        return { status: 'malformed', reason: 'Corpo do webhook nao e JSON.' }
      }

      const evento = String(corpo.event ?? '')
      const tipo = TIPOS[evento]
      if (tipo === undefined) {
        return { status: 'ignored', reason: `Evento ${evento || '?'} nao interessa.` }
      }

      const pagamento = (corpo.payment ?? {}) as Record<string, unknown>
      const assinatura = (corpo.subscription ?? {}) as Record<string, unknown>

      /*
       * O id da assinatura vem de dois lugares: o aviso de PAGAMENTO carrega
       * `payment.subscription`, o de ASSINATURA carrega `subscription.id`.
       */
      const providerSubscriptionId = String(pagamento.subscription ?? assinatura.id ?? '')

      if (providerSubscriptionId === '') {
        /*
         * Pagamento avulso na conta-pai. Ignorado, e nao malformado: existe e
         * e legitimo (uma cobranca manual nossa, por exemplo) — so nao move
         * assinatura nenhuma. Tratar como erro faria o Asaas reentregar para
         * sempre um aviso que nunca vamos querer.
         */
        return { status: 'ignored', reason: 'Aviso sem assinatura associada.' }
      }

      return {
        status: 'accepted',
        event: {
          eventId: String(corpo.id ?? `${evento}:${providerSubscriptionId}`),
          type: tipo,
          providerSubscriptionId,
          externalReference: textoOuNulo(
            pagamento.externalReference ?? assinatura.externalReference,
          ),
          amountCents: decimalParaCentavos(pagamento.value ?? assinatura.value),
          failureReason: textoOuNulo(corpo.failureReason),
          occurredAt: String(corpo.dateCreated ?? new Date().toISOString()),
        },
      }
    },
  }
}

/**
 * Os avisos que movem a assinatura, e so eles.
 *
 * A lista sai da tabela de "quais avisos cadastrar" do
 * [fluxo-asaas.md](../../../docs/arquitetura/integracoes/fluxo-asaas.md), e
 * nao de memoria: evento inventado aqui e um `ignored` silencioso em producao,
 * que e indistinguivel de "o provedor nunca avisou".
 *
 * `PAYMENT_CREATED` fica de fora de proposito: cobranca gerada nao e cobranca
 * paga, e trata-la como paga liberaria o acesso de quem so recebeu o boleto.
 *
 * `PAYMENT_REFUNDED` tambem: estorno de um ciclo da mensalidade e assunto
 * nosso com o lojista, nao um estado da assinatura — e nao ha o que decidir
 * sozinho aqui sem uma regra de produto escrita.
 */
const TIPOS: Record<string, SubscriptionEventType> = {
  PAYMENT_CONFIRMED: 'subscription.paid',
  PAYMENT_RECEIVED: 'subscription.paid',
  PAYMENT_OVERDUE: 'subscription.payment_failed',
  SUBSCRIPTION_DELETED: 'subscription.cancelled',
}

/**
 * O decimal do provedor em centavo inteiro.
 *
 * `Math.round` e nao `Math.trunc`: `129.9 * 100` da `12989.999...` em ponto
 * flutuante, e truncar cobraria um centavo a menos todo mes.
 */
function decimalParaCentavos(valor: unknown): number {
  const numero = typeof valor === 'number' ? valor : Number(valor ?? 0)
  return Number.isFinite(numero) ? Math.round(numero * 100) : 0
}

function centavosParaDecimal(centavos: number): number {
  return centavos / 100
}

/** String nao vazia do provedor, ou `null`. Campo ausente nao vira `"undefined"`. */
function textoOuNulo(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null
}

/**
 * O Asaas autentica webhook com TOKEN ESTATICO, e nao com HMAC — RNF-028.
 *
 * Ele repete, em `asaas-access-token`, o mesmo `authToken` que cadastramos.
 * Comparacao em tempo constante: `===` vazaria, pelo tempo de resposta, quanto
 * do prefixo bateu. O tamanho e conferido antes porque `timingSafeEqual` LANCA
 * com buffers diferentes, e um throw viraria 500 em vez de 401.
 */
function tokenConfere(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido.trim(), 'utf8')
  const b = Buffer.from(esperado, 'utf8')
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}
