import type { ConversationPurgeRepository, InvoiceIssuer, MessageSender } from '@na-regua/core'

/**
 * Consumidores de fila — NR-041.
 *
 * Todo consumidor e uma funcao pura de `(deps, payload) => resultado`, e nao um
 * `Worker` do BullMQ. A separacao nao e estetica: um consumidor que instancia a
 * propria conexao com o Redis so pode ser testado com Redis no ar, e ai o teste
 * mede a fila em vez de medir a regra. Assim o `index.ts` cuida da fila, e cada
 * consumidor cuida do que fazer com o job.
 */

export type ConsumerDeps = {
  readonly invoices: InvoiceIssuer
  readonly messages: MessageSender
  readonly overdue: OverdueReader
  readonly enqueue: Enqueuer
  readonly now: () => Date
  /** Expurgo de 30 d — porta do nucleo; o worker so orquestra o laco por tenant. */
  readonly conversations: ConversationPurgeRepository
  readonly listTenantIds: () => Promise<readonly string[]>
}

/**
 * O que a varredura de cobranca precisa ler.
 *
 * Porta declarada aqui, no worker, e nao em `core`, porque hoje nao existe caso
 * de uso de cobranca — e inventar um em `core` sem tarefa seria decidir por
 * conta propria o que a loja cobra e de quem.
 *
 * **Quando esse caso de uso existir, esta porta deve sumir** e o consumidor
 * passa a chamar `core`, como o resto. Enquanto isso, o consumidor faz
 * orquestracao (ler, enfileirar) e nao regra.
 */
export type OverdueReader = {
  /** Recebiveis vencidos ate a data, com cliente identificado e telefone. */
  listOverdue(hoje: string): Promise<readonly RecebivelVencido[]>
}

export type RecebivelVencido = {
  readonly companyId: string
  readonly receivableId: string
  readonly customerName: string
  readonly phone: string
  readonly amountCents: number
  readonly dueDate: string
}

/** Enfileira um job em outra fila. */
export type Enqueuer = {
  add(queue: string, payload: unknown): Promise<void>
}

/**
 * O que um consumidor devolve.
 *
 * Nunca `void`: o resultado vai para o log e para o job concluido, e "terminou"
 * sem dizer o que aconteceu e a diferenca entre uma nota autorizada e uma
 * rejeitada desaparecendo no mesmo silencio.
 */
export type ResultadoDoJob = {
  readonly outcome: string
  readonly detalhes?: Readonly<Record<string, unknown>>
}
