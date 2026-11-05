import { pedir, type Resultado } from './http'

/** Entrada de mercadoria — NR-158. Valores em CENTAVOS, como a api. */

export type ItemDaCompra = {
  productId: string
  description: string
  quantity: number
  unitCostCents: number
}

export type Compra = {
  id: string
  supplier: string
  supplierId: string | null
  /** `cancelled` = estornada (achado do QA). */
  status: 'active' | 'cancelled'
  cancelledAt: string | null
  cancelReason: string | null
  invoiceNumber: string | null
  notes: string | null
  totalCents: number
  installments: number
  items: ItemDaCompra[]
  createdAt: string
}

export type NovaCompra = {
  supplier: string
  /** O fornecedor do cadastro (NR-191), quando escolhido da lista. */
  supplierId?: string
  invoiceNumber?: string
  notes?: string
  items: { productId: string; quantity: number; unitCostCents: number }[]
  /** Cada parcela com o vencimento e o valor — achado do QA. */
  parcels?: { dueDate: string; amountCents: number }[]
  /** So na compra de custo zero, que nao gera conta. */
  dueDate?: string
}

export const carregarCompras = async (): Promise<Resultado<Compra[]>> => {
  const r = await pedir<{ purchases: Compra[] }>('/api/compras')
  return r.ok ? { ok: true, dados: r.dados.purchases } : r
}

export const registrarCompra = (compra: NovaCompra): Promise<Resultado<Compra>> =>
  pedir('/api/compras', { method: 'POST', body: JSON.stringify(compra) })

/** Estorno — devolve o estoque e cancela as contas a pagar da compra. */
export const estornarCompra = (id: string, motivo: string): Promise<Resultado<Compra>> =>
  pedir(`/api/compras/${encodeURIComponent(id)}/estornar`, {
    method: 'POST',
    body: JSON.stringify({ reason: motivo }),
  })

/** Somar `meses` a uma data AAAA-MM-DD, segurando o fim do mes (31/01 → 28/02). */
export function somarMeses(dia: string, meses: number): string {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number]
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1))
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate()
  alvo.setUTCDate(Math.min(d, ultimo))
  return alvo.toISOString().slice(0, 10)
}

/** O total em parcelas mensais iguais; os centavos que sobram vao na primeira (como o servidor). */
export function parcelasIguais(
  totalCents: number,
  quantas: number,
  primeiroVencimento: string,
): { dueDate: string; amountCents: number }[] {
  const base = Math.floor(totalCents / quantas)
  const sobra = totalCents - base * quantas
  return Array.from({ length: quantas }, (_, i) => ({
    dueDate: somarMeses(primeiroVencimento, i),
    amountCents: i === 0 ? base + sobra : base,
  }))
}
