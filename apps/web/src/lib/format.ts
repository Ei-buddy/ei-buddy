/** Formatadores compartilhados pelas telas. */

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const brlCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatMoney(value: number): string {
  return brl.format(value)
}

/**
 * Valor em CENTAVOS, que e como a API devolve tudo. `formatMoney` recebe
 * reais; passar centavos para ele mostrou os totais de contas 100x maiores.
 */
export function formatCentavos(centavos: number): string {
  return brl.format(centavos / 100)
}

export function formatMoneyCompact(value: number): string {
  return brlCompact.format(value)
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits).replace('.', ',')}%`
}

/** Aceita "2026-08-24" ou ISO completo e devolve "24/08/2026". */
export function formatDate(value: string | null): string {
  if (!value) return '—'
  const [date] = value.split('T')
  const [year, month, day] = date.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

/** Devolve "24/08/2026 14:32" quando houver hora no valor. */
export function formatDateTime(value: string): string {
  const [date, time] = value.split('T')
  const formatted = formatDate(date)
  if (!time) return formatted
  return `${formatted} ${time.slice(0, 5)}`
}

/**
 * `AAAA-MM-DD` no fuso de quem esta olhando, sem passar por UTC.
 *
 * `toISOString()` converte para UTC, e as 21h de Sao Paulo viram o dia
 * seguinte. Para "vence hoje" e para o dia de um calendario, um dia de
 * diferenca e um defeito que aparece so para quem abre a tela de noite.
 *
 * Estava em `agenda-api.ts`, onde nasceu ao consertar a agenda congelada. Nao
 * e funcao de agenda: e a resposta a "que dia e hoje", e o app inteiro
 * pergunta isso.
 */
export function diaLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** O dia de hoje, no fuso de quem esta olhando. */
export function hoje(): string {
  return diaLocal(new Date())
}

/** O mes de hoje, `AAAA-MM`. */
export function mesDeHoje(): string {
  return hoje().slice(0, 7)
}

/**
 * Distancia em dias entre uma data e a referencia (negativo = vencido).
 *
 * ## A referencia era `'2026-08-24'`
 *
 * Fixa, no codigo, como padrao do parametro. O efeito nao ficava no canto: esta
 * funcao decide o rotulo de vencimento e, em `ContasView`, decide se um titulo
 * ESTA VENCIDO. Com a referencia parada em agosto, toda conta vencida depois
 * daquele dia aparecia como "aberto" — o lojista abria a tela de contas a pagar
 * e nao via o que estava atrasado.
 *
 * Tambem afetava o quadro do CRM (cartao atrasado), o detalhe do cliente e as
 * respostas do assistente.
 *
 * O parametro fica, e continua util: teste e chamada de servidor passam a
 * referencia para nao depender do relogio. So o PADRAO mudou.
 */
export function daysUntil(value: string, reference = hoje()): number {
  const target = new Date(`${value.split('T')[0]}T00:00:00`).getTime()
  const base = new Date(`${reference}T00:00:00`).getTime()
  return Math.round((target - base) / 86_400_000)
}

/** Texto curto de vencimento: "Vence hoje", "Vence em 3 dias", "5 dias em atraso". */
export function describeDueDate(value: string): string {
  const diff = daysUntil(value)
  if (diff === 0) return 'Vence hoje'
  if (diff === 1) return 'Vence amanhã'
  if (diff > 1) return `Vence em ${diff} dias`
  if (diff === -1) return '1 dia em atraso'
  return `${Math.abs(diff)} dias em atraso`
}

export const formaPagamentoLabel: Record<string, string> = {
  pix: 'Pix',
  debito: 'Débito',
  credito: 'Crédito',
  dinheiro: 'Dinheiro',
  carteira: 'Carteira',
  /* Os codigos da API, como chegam no painel — sem eles a tela mostrava
     "cash" e "wallet" crus (achado do QA). */
  cash: 'Dinheiro',
  debit: 'Débito',
  credit: 'Crédito',
  wallet: 'Fiado',
}

export const statusTituloLabel: Record<string, string> = {
  aberto: 'Em aberto',
  pago: 'Baixado',
  parcial: 'Baixa parcial',
  vencido: 'Vencido',
}

export const statusVendaLabel: Record<string, string> = {
  concluida: 'Concluída',
  cancelada: 'Cancelada',
  em_aberto: 'Em aberto',
  open: 'Aberta',
  settled: 'Quitada',
  cancelled: 'Cancelada',
  returned: 'Devolvida',
}

export const notaLabel: Record<string, string> = {
  nfce: 'NFC-e',
  nfse: 'NFS-e',
  sem_nota: 'Sem nota',
}
