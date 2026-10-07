import { pedir, type Resultado } from './http'

/** Orcamentos — NR-159. Valores em CENTAVOS, como a api. */

export type ItemDoOrcamento = {
  productId: string
  description: string
  quantity: number
  unitPriceCents: number
  code: string
  costPriceCents: number
  stock: number
  isActive: boolean
}

export type Orcamento = {
  id: string
  number: number
  customerName: string | null
  status: 'open' | 'converted' | 'cancelled'
  validUntil: string
  notes: string | null
  discountCents: number
  totalCents: number
  saleId: string | null
  items: ItemDoOrcamento[]
  createdAt: string
}

export type NovoOrcamento = {
  customerName?: string
  items: { productId: string; quantity: number; unitPriceCents: number }[]
  validUntil: string
  discountCents?: number
  notes?: string
}

export const ROTULO_SITUACAO: Record<Orcamento['status'], string> = {
  open: 'Em aberto',
  converted: 'Virou venda',
  cancelled: 'Cancelado',
}

/** Aberto mas vencido: o cliente nao respondeu a tempo. */
export const vencido = (o: Orcamento, hoje: string) => o.status === 'open' && o.validUntil < hoje

export const carregarOrcamentos = async (): Promise<Resultado<Orcamento[]>> => {
  const r = await pedir<{ quotes: Orcamento[] }>('/api/orcamentos')
  return r.ok ? { ok: true, dados: r.dados.quotes } : r
}

export const carregarOrcamento = (id: string): Promise<Resultado<Orcamento>> =>
  pedir(`/api/orcamentos/${encodeURIComponent(id)}`)

export const criarOrcamento = (o: NovoOrcamento): Promise<Resultado<Orcamento>> =>
  pedir('/api/orcamentos', { method: 'POST', body: JSON.stringify(o) })

export const cancelarOrcamento = (id: string): Promise<Resultado<Orcamento>> =>
  pedir(`/api/orcamentos/${encodeURIComponent(id)}/cancelar`, { method: 'POST' })

export const converterOrcamento = (id: string, saleId: string): Promise<Resultado<Orcamento>> =>
  pedir(`/api/orcamentos/${encodeURIComponent(id)}/converter`, {
    method: 'POST',
    body: JSON.stringify({ saleId }),
  })
