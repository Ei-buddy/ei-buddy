import type { ExecutionContext } from '../context.js'

/** Quanto foi pago ou recebido num periodo, e em quantos titulos. */
export type TotalQuitado = {
  readonly totalCents: number
  readonly count: number
}

/**
 * O dinheiro que de fato entrou ou saiu num periodo — RF-061, RF-066.
 *
 * Pela DATA DO PAGAMENTO (a baixa), e nao pelo vencimento: "recebido no mes"
 * e o que caiu no caixa no mes. Baixa estornada nao conta.
 */
export type SettlementTotals = {
  /**
   * `from` e `to` inclusivos, `AAAA-MM-DD` no fuso da loja. Para recebiveis,
   * entra tambem o que ja NASCEU pago (venda em dinheiro e Pix), que nao tem
   * baixa registrada — sem isso, "recebido no mes" ignoraria o balcao.
   */
  totalBetween(
    companyId: string,
    kind: 'payable' | 'receivable',
    from: string,
    to: string,
  ): Promise<TotalQuitado>
}

/** `AAAA-MM-DD` do instante, no fuso dado. */
function diaNoFuso(instante: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante)
}

/**
 * Quitado no mes corrente — o cartao "Recebido/Pago no mes" de contas.
 *
 * O cartao filtrava, na tela, os titulos com status pago e VENCIMENTO no mes.
 * Mas a lista so traz titulos em aberto: o pago nunca chegava, e o cartao
 * marcava R$ 0,00 mesmo com o caixa cheio (achado do QA). E o vencimento nao e
 * quando o dinheiro entra.
 *
 * O mes e o do fuso da loja: as 22h do dia 31 em Brasilia ja e dia 1 em UTC.
 */
export async function settledInMonth(
  deps: { readonly settlementTotals: SettlementTotals; readonly timeZone: string },
  ctx: ExecutionContext,
  kind: 'payable' | 'receivable',
): Promise<TotalQuitado> {
  const hoje = diaNoFuso(ctx.now, deps.timeZone)
  const [ano, mes] = hoje.split('-').map(Number) as [number, number]
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  const prefixo = hoje.slice(0, 8)

  return deps.settlementTotals.totalBetween(
    ctx.companyId,
    kind,
    `${prefixo}01`,
    `${prefixo}${String(ultimoDia).padStart(2, '0')}`,
  )
}
