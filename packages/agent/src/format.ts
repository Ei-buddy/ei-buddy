import type { DreOutput } from '@na-regua/contracts'
import { Money } from '@na-regua/money'

/** Teto de uma mensagem no canal (mesmo max do MessageSender). RF-108. */
export const LIMITE_TEXTO_MENSAGEM = 4096

const SUFIXO_TRUNCADO = '\n…'

export function formatarCentavos(cents: number): string {
  return Money.fromCents(cents).format()
}

/**
 * Corta texto que nao cabe numa mensagem. Nao inventa arquivo nem link
 * (RF-109 fica fora desta fatia).
 */
export function truncarTexto(texto: string, limite = LIMITE_TEXTO_MENSAGEM): string {
  if (texto.length <= limite) return texto
  const corte = Math.max(0, limite - SUFIXO_TRUNCADO.length)
  return `${texto.slice(0, corte)}${SUFIXO_TRUNCADO}`
}

/**
 * Quatro eixos do DRE ja calculados por `core` — o formatador so exibe.
 * Linhas extras entram depois e sao a primeira coisa a cair no corte (RF-108).
 */
export function formatarResumoDre(out: DreOutput, limite = LIMITE_TEXTO_MENSAGEM): string {
  const eixos = [
    `Resumo de ${out.from} a ${out.to}.`,
    `Faturamento ${formatarCentavos(out.netRevenueCents)}.`,
    `Custo ${formatarCentavos(out.costCents)}.`,
    `Despesas ${formatarCentavos(out.expensesCents)}.`,
    `Resultado ${formatarCentavos(out.resultCents)}.`,
  ]
  const linhas = out.lines.map((l) => `- ${l.accountName}: ${formatarCentavos(l.amountCents)}`)
  return truncarTexto([...eixos, ...linhas].join('\n'), limite)
}

export function diaIso(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function mesDoDia(isoDate: string): { from: string; to: string } {
  const [ano, mes] = isoDate.split('-')
  if (ano === undefined || mes === undefined) {
    return { from: isoDate, to: isoDate }
  }
  const ultimo = new Date(Date.UTC(Number(ano), Number(mes), 0)).getUTCDate()
  return {
    from: `${ano}-${mes}-01`,
    to: `${ano}-${mes}-${String(ultimo).padStart(2, '0')}`,
  }
}

export function chaveDaConversa(input: {
  readonly channel: string
  readonly companyId: string
  readonly userId: string
  readonly peer?: string
}): string {
  if (input.channel === 'whatsapp') {
    return `wa:${input.companyId}:${input.peer ?? ''}`
  }
  return `app:${input.companyId}:${input.userId}`
}
