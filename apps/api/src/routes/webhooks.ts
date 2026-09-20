import {
  handleSubscriptionEvent,
  empresaDaReferencia,
  settleCustomerCharge,
  type HandleSubscriptionEventDeps,
  type SettleCustomerChargeDeps,
  type WebhookInbox,
} from '@na-regua/core'
import type { SubscriptionWebhookResult, WebhookReadResult } from '@na-regua/contracts'
import type { FastifyInstance } from 'fastify'

export type WebhookRouteDeps = {
  /**
   * O provedor da mensalidade. `undefined` sem configuracao — e ai a rota
   * responde 503 em vez de existir pela metade.
   */
  readonly assinatura?:
    | (HandleSubscriptionEventDeps & {
        readonly readWebhook: (rawBody: string, signature: string) => SubscriptionWebhookResult
        readonly inbox: WebhookInbox
      })
    | undefined

  /**
   * A cobranca das LOJAS — RF-068. Outro provedor de leitura, outro token.
   *
   * Separado da assinatura de proposito: sao contas diferentes no Asaas (a
   * subconta da loja e a nossa conta-pai) com tokens diferentes. Um caminho so
   * faria o token de uma valer para a outra.
   */
  readonly cobranca?:
    | (SettleCustomerChargeDeps & {
        readonly readWebhook: (rawBody: string, signature: string) => WebhookReadResult
        readonly inbox: WebhookInbox
      })
    | undefined
}

/** Cabecalho em que o Asaas repete o `authToken` que cadastramos. */
const CABECALHO = 'asaas-access-token'
const PROVEDOR = 'asaas'

/**
 * Webhooks — RNF-028, NR-063.
 *
 * ## Escopo proprio, e nao rota solta
 *
 * O `register` do Fastify encapsula, e e isso que permite trocar o parser de
 * corpo SO aqui. As outras rotas continuam recebendo `request.body` ja
 * parseado; esta recebe a STRING como chegou.
 *
 * O provedor de hoje nao assina o corpo — autentica por token —, entao o
 * corpo bruto nao e necessario para conferir nada. Ele existe mesmo assim
 * porque trocar de provedor nao pode virar trocar a rota: quem assina, assina
 * os BYTES, e um corpo reserializado depois de `JSON.parse` tem outros bytes.
 *
 * ## Responder 200 rapido
 *
 * O provedor pausa a fila dele quando as respostas demoram, e uma fila pausada
 * e uma loja que nao destrava ao pagar. O processamento e curto de proposito:
 * grava na caixa de entrada e move um estado.
 *
 * ## Os codigos importam
 *
 * | Caso                | Resposta | Por que                                             |
 * | ------------------- | -------- | --------------------------------------------------- |
 * | processado / ja visto | 200    | nada a reentregar                                   |
 * | evento que ignoramos  | 200    | 4xx faria reentregar para sempre                    |
 * | token invalido        | 401    | 200 ensinaria o atacante que o corpo foi aceito     |
 * | corpo ilegivel        | 400    | assinatura valida e corpo quebrado e bug do provedor |
 */
export function registerWebhookRoutes(app: FastifyInstance, deps: WebhookRouteDeps): void {
  void app.register(
    async (escopo) => {
      /* Guarda a string como chegou, em vez de entregar objeto. */
      escopo.addContentTypeParser(
        'application/json',
        { parseAs: 'string' },
        (_request, body, done) => {
          done(null, body)
        },
      )

      escopo.post('/asaas/plataforma', async (request, reply) => {
        const assinatura = deps.assinatura
        if (assinatura === undefined) {
          /* Sem provedor configurado a rota EXISTE e recusa, em vez de dar 404:
             404 faria o Asaas desativar o webhook depois de algumas falhas. */
          return reply
            .code(503)
            .send({ error: { code: 'UNAVAILABLE', message: 'Assinatura nao configurada.' } })
        }

        const token = request.headers[CABECALHO]
        const leitura = assinatura.readWebhook(
          typeof request.body === 'string' ? request.body : '',
          typeof token === 'string' ? token : '',
        )

        if (leitura.status === 'invalid_signature') {
          return reply
            .code(401)
            .send({ error: { code: 'UNAUTHORIZED', message: 'Nao autorizado.' } })
        }
        if (leitura.status === 'malformed') {
          return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: leitura.reason } })
        }
        if (leitura.status === 'ignored') {
          return reply.code(200).send({ ok: true, ignorado: leitura.reason })
        }

        const evento = leitura.event
        const companyId = evento.externalReference

        if (companyId === null) {
          /* Aviso legitimo que nao aponta para assinatura nossa. Nao entra na
             caixa: sem empresa nao ha onde grava-lo. */
          return reply.code(200).send({ ok: true, ignorado: 'Aviso sem empresa associada.' })
        }

        const agora = new Date()
        const novo = await assinatura.inbox.registrar({
          provider: PROVEDOR,
          eventId: evento.eventId,
          companyId,
          payload: leitura.event,
          receivedAt: agora,
        })

        if (!novo) {
          /* Reentrega. 200 sem trabalho nenhum — e sem 4xx, que faria o
             provedor insistir para sempre num aviso ja tratado. */
          return reply.code(200).send({ ok: true, repetido: true })
        }

        await handleSubscriptionEvent(assinatura, evento)

        await assinatura.inbox.marcarProcessado({
          provider: PROVEDOR,
          eventId: evento.eventId,
          companyId,
          processedAt: new Date(),
        })

        return reply.code(200).send({ ok: true })
      })

      /**
       * A cobranca das lojas — RF-068.
       *
       * Caminho proprio, e nao um `if` dentro do outro: o token da subconta da
       * loja nao pode autenticar um aviso da conta-pai, nem o contrario. Dois
       * caminhos e a forma mais simples de isso continuar verdade quando
       * alguem mexer aqui daqui a um ano.
       */
      escopo.post('/asaas/lojas', async (request, reply) => {
        const cobranca = deps.cobranca
        if (cobranca === undefined) {
          return reply
            .code(503)
            .send({ error: { code: 'UNAVAILABLE', message: 'Cobranca nao configurada.' } })
        }

        const token = request.headers[CABECALHO]
        const leitura = cobranca.readWebhook(
          typeof request.body === 'string' ? request.body : '',
          typeof token === 'string' ? token : '',
        )

        if (leitura.status === 'invalid_signature') {
          return reply
            .code(401)
            .send({ error: { code: 'UNAUTHORIZED', message: 'Nao autorizado.' } })
        }
        if (leitura.status === 'malformed') {
          return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: leitura.reason } })
        }
        if (leitura.status === 'ignored') {
          return reply.code(200).send({ ok: true, ignorado: leitura.reason })
        }

        const evento = leitura.event

        /*
         * So pagamento AUTORIZADO baixa titulo. Estorno e falha chegam pelo
         * mesmo cano e pedem tratamento proprio — que ainda nao existe. Tratar
         * um estorno como baixa seria o titulo sumir justamente quando o
         * dinheiro voltou.
         */
        if (evento.type !== 'payment.authorized') {
          return reply.code(200).send({ ok: true, ignorado: `Evento ${evento.type} nao baixa.` })
        }

        /* Sem empresa nao ha tenant, e sem tenant nao ha leitura possivel. */
        const companyId =
          evento.externalReference === null
            ? undefined
            : empresaDaReferencia(evento.externalReference)
        if (companyId === undefined) {
          return reply.code(200).send({ ok: true, ignorado: 'Aviso sem empresa.' })
        }

        const agora = new Date()
        const novo = await cobranca.inbox.registrar({
          provider: 'asaas-lojas',
          eventId: evento.eventId,
          companyId,
          payload: evento,
          receivedAt: agora,
        })

        if (!novo) return reply.code(200).send({ ok: true, repetido: true })

        const r = await settleCustomerCharge(cobranca, evento, companyId, agora)

        await cobranca.inbox.marcarProcessado({
          provider: 'asaas-lojas',
          eventId: evento.eventId,
          companyId,
          processedAt: new Date(),
        })

        return reply.code(200).send({ ok: true, ...r })
      })
    },
    { prefix: '/webhooks' },
  )
}
