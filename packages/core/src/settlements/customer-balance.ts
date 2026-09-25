import type { TituloSnapshot } from '../ports/settlement-writers.js'

/**
 * A baixa deste titulo mexe no que o cliente deve? — RF-066, RF-067.
 *
 * A regra vive em `core`, e nao no repositorio, porque e regra: quem le o banco
 * nao deveria decidir de quem e a divida. E vive aqui e nao dentro do caso de
 * uso porque o NASCIMENTO, a baixa e o estorno precisam da MESMA resposta — se
 * divergirem, o estorno devolve uma divida que a baixa nunca tirou, e o saldo
 * do cliente cresce sozinho a cada par de operacoes.
 *
 * ## Le um fato, e nao mais deduz da forma de pagamento
 *
 * Antes a resposta saia de `paymentMethod`: fiado ou avulso mexiam, cartao nao
 * — porque venda no credito e divida da ADQUIRENTE, nao de quem passou o
 * cartao. O raciocinio continua certo; o que estava errado era de onde a forma
 * vinha.
 *
 * `receivables` nao guarda a forma, entao o repositorio a derivava com
 * `MIN(p.method)` sobre os pagamentos da venda. Numa venda paga metade em
 * dinheiro e metade no fiado, `MIN('cash','wallet')` e `'cash'` — e o "Fiado"
 * daquela venda era lido como recebimento em dinheiro. Pagar esse fiado nao
 * abatia nada, e pagar metade agora e ficar devendo o resto e o caso mais
 * comum do balcao.
 *
 * Nao ha `MIN` que acerte, porque o recebivel nao sabe de qual pagamento
 * nasceu. Entao quem decide e `core`, uma vez, quando o titulo nasce — e o
 * banco guarda a resposta em `is_customer_debt` (migration 0037).
 */
export function mexeNoSaldoDoCliente(titulo: TituloSnapshot): boolean {
  if (titulo.customerId === null) return false
  return titulo.isCustomerDebt
}

/**
 * Este recebivel, ao NASCER, e divida do cliente? — RF-013.
 *
 * A mesma pergunta da funcao acima, feita antes de o titulo existir: la ha uma
 * linha para ler, aqui so o que se vai gravar.
 *
 * - Sem cliente nao ha divida de ninguem.
 * - `wallet` e o fiado: divida dele.
 * - `null` e recebivel avulso (RF-065) — cobranca nominal, divida dele.
 * - `cash` e `pix` nascem liquidados: nao ha divida.
 * - `credit` e `debit` sao divida da ADQUIRENTE — o cliente ja pagou.
 */
export function nasceComoDividaDoCliente(
  customerId: string | null | undefined,
  formaDePagamento: string | null,
): boolean {
  if (customerId === null || customerId === undefined) return false
  return formaDePagamento === 'wallet' || formaDePagamento === null
}
