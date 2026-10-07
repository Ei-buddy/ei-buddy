import { chamarApi } from './api'

/** Entrada de mercadoria — NR-158, as mesmas rotas do web. Valores em CENTAVOS. */

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string }

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
  items: { productId: string; quantity: number; unitCostCents: number }[]
  dueDate: string
  installments: number
}

export async function carregarCompras(): Promise<Resultado<Compra[]>> {
  const r = await chamarApi<{ purchases: Compra[] }>('/compras')
  return r.ok ? { ok: true, dados: r.dados.purchases } : { ok: false, erro: r.message }
}

export async function registrarCompra(compra: NovaCompra): Promise<Resultado<Compra>> {
  const r = await chamarApi<Compra>('/compras', {
    method: 'POST',
    body: compra,
  })
  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}
