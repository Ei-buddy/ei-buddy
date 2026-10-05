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

/** `AAAA-MM-DD` a partir dos campos LOCAIS — nunca de `toISOString`. */
export function diaLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * O dia de hoje, no fuso de quem esta olhando.
 *
 * `toISOString().slice(0, 10)` daria UTC, e as 21h de Brasilia isso ja e o dia
 * seguinte: uma conta que vence amanha apareceria vencendo hoje, e a baixa
 * lancada a noite entraria com a data errada.
 */
export function hoje(): string {
  return diaLocal(new Date())
}

/**
 * Distancia em dias entre uma data e a referencia (negativo = vencido).
 *
 * ## A referencia era `'2026-08-24'`
 *
 * Fixa, no codigo, como padrao do parametro — o mesmo defeito que o web tinha e
 * que a NR-074 corrigiu la. Aqui ele ficou.
 *
 * O efeito nao e de canto: esta funcao decide o rotulo de vencimento E, em
 * `ContasView`, decide se um titulo esta VENCIDO. Com a referencia parada em
 * agosto, toda conta vencida depois daquele dia caia no grupo "A vencer" —
 * fechado por padrao, porque a tela abre sozinho o grupo de vencidos, que
 * estava vazio. O lojista abria "Contas a pagar" no celular e nao via o que
 * estava atrasado.
 *
 * O parametro fica, e continua util: teste e chamada que precisam de uma data
 * ancorada passam a referencia. So o PADRAO mudou.
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

/** Mascara de data digitada: 05/10/2026. */
export function mascaraData(texto: string): string {
  const d = texto.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

/**
 * "05/10/2026" para "2026-10-05", ou nulo quando a data nao existe.
 *
 * Confere o dia de volta: `new Date(2026, 1, 31)` vira 3 de marco em silencio,
 * e um vencimento em 31/02 entraria como outra data sem ninguem notar.
 */
export function dataDoTexto(texto: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto.trim())
  if (!m) return null
  const [, dia, mes, ano] = m
  const d = new Date(Number(ano), Number(mes) - 1, Number(dia))
  if (d.getDate() !== Number(dia) || d.getMonth() !== Number(mes) - 1) return null
  return diaLocal(d)
}
