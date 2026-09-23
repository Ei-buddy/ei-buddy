/**
 * Caixa de entrada de webhooks — RNF-028, NR-063.
 *
 * O provedor reentrega o mesmo aviso: ate 5 vezes, e mais se a nossa resposta
 * demorar. Sem esta caixa, uma confirmacao de pagamento vira varias — e, num
 * fluxo de baixa, varias baixas do mesmo ciclo.
 *
 * ## Duas protecoes, e elas nao se substituem
 *
 * Esta evita o TRABALHO: o aviso JA PROCESSADO nem chega ao caso de uso. O
 * aviso que ficou pelo caminho (`processed_at` nulo) chega de novo — e essa
 * e a diferenca que a caixa existe para preservar. A maquina de estados evita
 * o ESTRAGO: mesmo que chegasse, `avancar` responderia "nao mudou". Uma
 * protege recurso, a outra protege dado — e quem tira uma porque a outra
 * existe descobre a diferenca no dia em que o processamento deixar de ser
 * idempotente.
 *
 * ## A empresa vem junto
 *
 * `companyId` entra no registro porque a tabela e isolada por tenant, e o
 * aviso ja carrega a empresa (e o `externalReference`). Registrar sem ela
 * exigiria uma leitura sem tenant depois — exatamente o que o desenho do
 * evento evita.
 */

/**
 * Situacao do aviso depois do `INSERT ... ON CONFLICT`.
 *
 * - `novo` — primeira entrega; processar.
 * - `pendente` — reentrega de um aviso que falhou no meio; processar de novo.
 * - `processado` — reentrega de um aviso que ja deu certo; 200 sem trabalho.
 */
export type WebhookInboxSituacao = 'novo' | 'pendente' | 'processado'

export type WebhookInbox = {
  /**
   * Registra o aviso e devolve se deve ser processado.
   *
   * A decisao e do banco, num `INSERT ... ON CONFLICT DO NOTHING` sobre a
   * unicidade `(provider, event_id)`. Um `SELECT` antes do `INSERT` daria
   * falso negativo sob reentrega simultanea — e o provedor reentrega em
   * paralelo quando a primeira resposta demora. Conflito com `processed_at`
   * nulo e `pendente`, nao `processado`: a primeira entrega pode ter morrido
   * depois do INSERT e antes de `marcarProcessado`, e a reentrega e a unica
   * chance de terminar o trabalho.
   */
  registrar(entrada: {
    readonly provider: string
    readonly eventId: string
    readonly companyId: string
    /** O corpo como chegou, para conferencia posterior sem depender do provedor. */
    readonly payload: unknown
    readonly receivedAt: Date
  }): Promise<WebhookInboxSituacao>

  /**
   * Marca que o aviso foi tratado.
   *
   * Separado do registro de proposito: entre um e outro pode dar erro, e a
   * diferenca entre "recebido" e "processado" e o que permite reprocessar o
   * que ficou pelo caminho sem reprocessar o que deu certo.
   */
  marcarProcessado(entrada: {
    readonly provider: string
    readonly eventId: string
    readonly companyId: string
    readonly processedAt: Date
  }): Promise<void>
}
