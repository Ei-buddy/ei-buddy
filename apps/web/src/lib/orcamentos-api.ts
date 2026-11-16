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
  /** Nulo nos orcamentos antigos, que so tinham o nome digitado. */
  customerId: string | null
  customerName: string | null
  status: 'open' | 'converted' | 'cancelled'
  validUntil: string
  notes: string | null
  discountCents: number
  totalCents: number
  saleId: string | null
  /** O numero da venda que nasceu dele — NR-172. */
  saleNumber: number | null
  items: ItemDoOrcamento[]
  createdAt: string
}

/** O cliente e obrigatorio e vem do cadastro: o nome sai de la, no servidor. */
export type NovoOrcamento = {
  customerId: string
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

/**
 * A situacao na tela — NR-210. "Vencido" nao e status gravado: e o aberto
 * cuja validade passou. O servidor decide pelo dia da loja; a tela usa a
 * mesma regra para o selo de cada linha.
 */
export type SituacaoDoOrcamento = 'open' | 'expired' | 'converted' | 'cancelled'

export const ROTULO_DA_SITUACAO: Record<SituacaoDoOrcamento, string> = {
  open: 'Em aberto',
  expired: 'Vencidos',
  converted: 'Viraram venda',
  cancelled: 'Cancelados',
}

export const SITUACOES: readonly SituacaoDoOrcamento[] = [
  'open',
  'expired',
  'converted',
  'cancelled',
]

export const situacaoDe = (o: Orcamento, hoje: string): SituacaoDoOrcamento =>
  vencido(o, hoje) ? 'expired' : o.status

export type TotalDaSituacao = { count: number; totalCents: number }

export type ResumoDosOrcamentos = Record<SituacaoDoOrcamento, TotalDaSituacao>

/**
 * Conversao, em %: dos orcamentos que ja tiveram desfecho (viraram venda,
 * foram cancelados ou venceram sem resposta), quantos viraram venda. O aberto
 * no prazo fica fora — ainda pode virar. Nulo quando nenhum teve desfecho.
 */
export function conversao(r: ResumoDosOrcamentos): number | null {
  const desfechos = r.converted.count + r.cancelled.count + r.expired.count
  return desfechos === 0 ? null : Math.round((r.converted.count / desfechos) * 100)
}

export type PaginaDeOrcamentos = {
  orcamentos: Orcamento[]
  /** Quantos casam com busca, periodo e situacao. */
  total: number
  pagina: number
  porPagina: number
  /** Sobre busca e periodo — a situacao escolhida nao zera o painel. */
  resumo: ResumoDosOrcamentos
}

export type FiltroDosOrcamentos = {
  termo: string
  situacao: SituacaoDoOrcamento | ''
  de: string
  ate: string
  pagina: number
  porPagina: number
}

/** So viaja o que veio: `from=` vazio seria recusado como data invalida. */
export function consultaDosOrcamentos(f: FiltroDosOrcamentos): string {
  const q = new URLSearchParams({ page: String(f.pagina), pageSize: String(f.porPagina) })
  const termo = f.termo.trim()
  if (termo !== '') q.set('q', termo)
  if (f.situacao !== '') q.set('situation', f.situacao)
  if (f.de !== '') q.set('from', f.de)
  if (f.ate !== '') q.set('to', f.ate)
  return q.toString()
}

export const carregarOrcamentos = async (
  f: FiltroDosOrcamentos,
): Promise<Resultado<PaginaDeOrcamentos>> => {
  const r = await pedir<{
    quotes: Orcamento[]
    total: number
    page: number
    pageSize: number
    summary: ResumoDosOrcamentos
  }>(`/api/orcamentos?${consultaDosOrcamentos(f)}`)
  if (!r.ok) return r
  return {
    ok: true,
    dados: {
      orcamentos: r.dados.quotes,
      total: r.dados.total,
      pagina: r.dados.page,
      porPagina: r.dados.pageSize,
      resumo: r.dados.summary,
    },
  }
}

export const carregarOrcamento = (id: string): Promise<Resultado<Orcamento>> =>
  pedir(`/api/orcamentos/${encodeURIComponent(id)}`)

export const criarOrcamento = (o: NovoOrcamento): Promise<Resultado<Orcamento>> =>
  pedir('/api/orcamentos', { method: 'POST', body: JSON.stringify(o) })

/** Edita o orcamento aberto — substitui cliente, itens, validade e desconto. */
export const editarOrcamento = (id: string, o: NovoOrcamento): Promise<Resultado<Orcamento>> =>
  pedir(`/api/orcamentos/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(o) })

export const cancelarOrcamento = (id: string): Promise<Resultado<Orcamento>> =>
  pedir(`/api/orcamentos/${encodeURIComponent(id)}/cancelar`, { method: 'POST' })

export const converterOrcamento = (id: string, saleId: string): Promise<Resultado<Orcamento>> =>
  pedir(`/api/orcamentos/${encodeURIComponent(id)}/converter`, {
    method: 'POST',
    body: JSON.stringify({ saleId }),
  })
