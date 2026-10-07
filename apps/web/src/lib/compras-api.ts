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
  invoiceNumber: string | null
  notes: string | null
  totalCents: number
  installments: number
  items: ItemDaCompra[]
  createdAt: string
}

export type NovaCompra = {
  supplier: string
  invoiceNumber?: string
  notes?: string
  items: { productId: string; quantity: number; unitCostCents: number }[]
  dueDate: string
  installments: number
}

export const carregarCompras = async (): Promise<Resultado<Compra[]>> => {
  const r = await pedir<{ purchases: Compra[] }>('/api/compras')
  return r.ok ? { ok: true, dados: r.dados.purchases } : r
}

export const registrarCompra = (compra: NovaCompra): Promise<Resultado<Compra>> =>
  pedir('/api/compras', { method: 'POST', body: JSON.stringify(compra) })
