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
  supplierId: string | null
  /** `cancelled` = estornada (achado do QA). */
  status: 'active' | 'cancelled'
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
  supplierId?: string
  invoiceNumber?: string
  items: { productId: string; quantity: number; unitCostCents: number }[]
  /** Cada parcela com vencimento e valor — achado do QA. */
  parcels?: { dueDate: string; amountCents: number }[]
  /** So na compra de custo zero, que nao gera conta. */
  dueDate?: string
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

/** Estorno — devolve o estoque e cancela as contas a pagar da compra. */
export async function estornarCompra(id: string, motivo: string): Promise<Resultado<Compra>> {
  const r = await chamarApi<Compra>(`/compras/${encodeURIComponent(id)}/estornar`, {
    method: 'POST',
    body: { reason: motivo },
  })
  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

/** Somar meses a AAAA-MM-DD segurando o fim do mes — a mesma regra do web. */
export function somarMeses(dia: string, meses: number): string {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number]
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1))
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate()
  alvo.setUTCDate(Math.min(d, ultimo))
  return alvo.toISOString().slice(0, 10)
}

/** Parcelas mensais iguais; a sobra vai na primeira, como no servidor. */
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
