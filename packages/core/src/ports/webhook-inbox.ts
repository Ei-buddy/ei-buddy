/**
 * Caixa de entrada de webhooks — RNF-028, NR-063.
 *
 * O provedor reentrega o mesmo aviso: ate 5 vezes, e mais se a nossa resposta
 * demorar. Sem esta caixa, uma confirmacao de pagamento vira varias — e, num
 * fluxo de baixa, varias baixas do mesmo ciclo.
 *
 * ## Duas protecoes, e elas nao se substituem
 *
 * Esta evita o TRABALHO: o segundo aviso nem chega ao caso de uso. A maquina
 * de estados evita o ESTRAGO: mesmo que chegasse, `avancar` responderia "nao
 * mudou". Uma protege recurso, a outra protege dado — e quem tira uma porque
 * a outra existe descobre a diferenca no dia em que o processamento deixar de
 * ser idempotente.
 *
 * ## A empresa vem junto
 *
 * `companyId` entra no registro porque a tabela e isolada por tenant, e o
 * aviso ja carrega a empresa (e o `externalReference`). Registrar sem ela
 * exigiria uma leitura sem tenant depois — exatamente o que o desenho do
 * evento evita.
 */
export type WebhookInbox = {
  /**
   * Registra o aviso. `true` = e a PRIMEIRA vez; `false` = ja tinha chegado.
   *
   * A decisao e do banco, num `INSERT ... ON CONFLICT DO NOTHING` sobre a
   * unicidade `(provider, event_id)`. Um `SELECT` antes do `INSERT` daria
   * falso negativo sob reentrega simultanea — e o provedor reentrega em
   * paralelo quando a primeira resposta demora.
   */
  registrar(entrada: {
    readonly provider: string
    readonly eventId: string
    readonly companyId: string
    /** O corpo como chegou, para conferencia posterior sem depender do provedor. */
    readonly payload: unknown
    readonly receivedAt: Date
  }): Promise<boolean>

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
