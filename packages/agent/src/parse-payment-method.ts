import type { PaymentMethod } from '@na-regua/contracts'

const REGRAS: ReadonlyArray<{ method: PaymentMethod; test: (texto: string) => boolean }> = [
  { method: 'pix', test: (t) => /\bno\s+pix\b/i.test(t) || /\bpix\b/i.test(t) },
  { method: 'cash', test: (t) => /\bdinheiro\b/i.test(t) || /\bcash\b/i.test(t) },
  { method: 'debit', test: (t) => /\bdebito\b/i.test(t) || /\bd[eé]bito\b/i.test(t) },
  { method: 'credit', test: (t) => /\bcredito\b/i.test(t) || /\bcr[eé]dito\b/i.test(t) },
  {
    method: 'wallet',
    test: (t) => /\bfiado\b/i.test(t) || /\bcarteira\b/i.test(t) || /\bwallet\b/i.test(t),
  },
]

export type ParsePaymentResult =
  | { kind: 'method'; method: PaymentMethod }
  | { kind: 'empty' }
  | { kind: 'ambiguous' }
  | { kind: 'none' }

/** Forma de pagamento inequívoca no texto, ou ausente/ambígua. */
export function parsePaymentMethod(text: string): ParsePaymentResult {
  const compact = text.trim()
  if (compact === '') return { kind: 'empty' }

  const encontrados = REGRAS.filter((r) => r.test(compact)).map((r) => r.method)
  if (encontrados.length === 0) return { kind: 'none' }
  if (encontrados.length > 1) return { kind: 'ambiguous' }
  return { kind: 'method', method: encontrados[0]! }
}
