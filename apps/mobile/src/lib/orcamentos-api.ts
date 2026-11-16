import { Linking, Share } from 'react-native'
import { chamarApi } from './api'
import { montarOrcamento } from './comprovante'
import { carregarEmpresa } from './empresa-api'
import { formatDate } from './format'

/** Orcamentos — NR-159, as mesmas rotas do web. Valores em CENTAVOS. */

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string }

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

export const vencido = (o: Orcamento, hoje: string) => o.status === 'open' && o.validUntil < hoje

const resultado = <T>(r: { ok: true; dados: T } | { ok: false; message: string }): Resultado<T> =>
  r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }

/**
 * A situacao na tela — NR-210, a mesma do web. "Vencido" nao e status
 * gravado: e o aberto cuja validade passou.
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
 * Conversao, em %: dos que ja tiveram desfecho (venda, cancelamento ou
 * vencimento sem resposta), quantos viraram venda. Nulo sem nenhum desfecho.
 */
export function conversao(r: ResumoDosOrcamentos): number | null {
  const desfechos = r.converted.count + r.cancelled.count + r.expired.count
  return desfechos === 0 ? null : Math.round((r.converted.count / desfechos) * 100)
}

export type FiltroDosOrcamentos = {
  termo: string
  situacao: SituacaoDoOrcamento | ''
  de?: string
  ate?: string
  pagina: number
  porPagina?: number
}

export type PaginaDeOrcamentos = {
  orcamentos: Orcamento[]
  /** Quantos casam com busca, periodo e situacao. */
  total: number
  /** Sobre busca e periodo — a situacao escolhida nao zera o painel. */
  resumo: ResumoDosOrcamentos
}

/** So viaja o que veio: `from=` vazio seria recusado como data invalida. */
export function consultaDosOrcamentos(f: FiltroDosOrcamentos): string {
  const q = new URLSearchParams({ page: String(f.pagina), pageSize: String(f.porPagina ?? 20) })
  const termo = f.termo.trim()
  if (termo !== '') q.set('q', termo)
  if (f.situacao !== '') q.set('situation', f.situacao)
  if (f.de) q.set('from', f.de)
  if (f.ate) q.set('to', f.ate)
  return q.toString()
}

/** Busca, situacao, periodo e pagina, com o painel — NR-210. */
export async function carregarOrcamentos(
  f: FiltroDosOrcamentos,
): Promise<Resultado<PaginaDeOrcamentos>> {
  const r = await chamarApi<{ quotes: Orcamento[]; total: number; summary: ResumoDosOrcamentos }>(
    `/orcamentos?${consultaDosOrcamentos(f)}`,
  )
  if (!r.ok) return { ok: false, erro: r.message }
  return {
    ok: true,
    dados: { orcamentos: r.dados.quotes, total: r.dados.total, resumo: r.dados.summary },
  }
}

export const carregarOrcamento = async (id: string) =>
  resultado(await chamarApi<Orcamento>(`/orcamentos/${encodeURIComponent(id)}`))

export const criarOrcamento = async (o: NovoOrcamento) =>
  resultado(await chamarApi<Orcamento>('/orcamentos', { method: 'POST', body: o }))

/** Edita o orcamento aberto — substitui cliente, itens, validade e desconto. */
export const editarOrcamento = async (id: string, o: NovoOrcamento) =>
  resultado(
    await chamarApi<Orcamento>(`/orcamentos/${encodeURIComponent(id)}`, { method: 'PUT', body: o }),
  )

export const cancelarOrcamento = async (id: string) =>
  resultado(
    await chamarApi<Orcamento>(`/orcamentos/${encodeURIComponent(id)}/cancelar`, {
      method: 'POST',
    }),
  )

export const converterOrcamento = async (id: string, saleId: string) =>
  resultado(
    await chamarApi<Orcamento>(`/orcamentos/${encodeURIComponent(id)}/converter`, {
      method: 'POST',
      body: { saleId },
    }),
  )

const telefone = (ddd: string, numero: string) =>
  numero === ''
    ? null
    : ddd === ''
      ? numero
      : `(${ddd}) ${numero.length === 9 ? `${numero.slice(0, 5)}-${numero.slice(5)}` : numero}`

/** O papel do orcamento — o mesmo texto do web (`montarOrcamento`). */
export async function textoDoOrcamento(o: Orcamento): Promise<Resultado<string>> {
  const empresa = await carregarEmpresa()
  if (!empresa.ok) return { ok: false, erro: empresa.erro }
  const e = empresa.dados
  const endereco = [
    [e.logradouro, e.numero].filter(Boolean).join(', '),
    e.bairro,
    [e.cidade, e.uf].filter(Boolean).join('/'),
  ]
    .filter(Boolean)
    .join(' - ')
  const reais = (c: number) => c / 100
  const bruto = o.items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0)

  return {
    ok: true,
    dados: montarOrcamento({
      loja: {
        nome: e.nomeFantasia || e.razaoSocial,
        cnpj: e.cnpj,
        endereco: endereco === '' ? null : endereco,
        telefone: telefone(e.ddd, e.celular),
      },
      orcamento: {
        numero: o.number,
        emitido: new Date(o.createdAt).toLocaleDateString('pt-BR'),
        validoAte: formatDate(o.validUntil),
        cliente: o.customerName,
        itens: o.items.map((i) => ({
          descricao: i.description,
          quantidade: i.quantity,
          precoUnitario: reais(i.unitPriceCents),
          total: reais(i.quantity * i.unitPriceCents),
        })),
        bruto: reais(bruto),
        desconto: reais(o.discountCents),
        total: reais(o.totalCents),
        observacoes: o.notes,
      },
    }),
  }
}

/** Menu do sistema: WhatsApp, e-mail ou o app da impressora termica. */
export async function compartilharOrcamento(o: Orcamento): Promise<Resultado<true>> {
  const t = await textoDoOrcamento(o)
  if (!t.ok) return t
  try {
    await Share.share({ title: `Orçamento nº ${o.number}`, message: t.dados })
    return { ok: true, dados: true }
  } catch {
    return { ok: false, erro: 'Não deu para compartilhar o orçamento.' }
  }
}

/**
 * Direto no WhatsApp, com o texto pronto para escolher o contato.
 *
 * Achado do QA: "verificar se o aplicativo do Whats esta aberto, caso nao,
 * recorrer ao Whats Web". Primeiro o aplicativo (`whatsapp://`); sem ele, o
 * sistema recusa a abertura e vai o `wa.me` — no navegador do celular, a
 * pagina do WhatsApp que leva ao Web ou a instalar.
 */
export async function mandarPeloWhatsApp(o: Orcamento): Promise<Resultado<true>> {
  const t = await textoDoOrcamento(o)
  if (!t.ok) return t
  const texto = encodeURIComponent(t.dados)
  try {
    await Linking.openURL(`whatsapp://send?text=${texto}`)
    return { ok: true, dados: true }
  } catch {
    /* Sem o aplicativo: o caminho pelo navegador. */
  }
  try {
    await Linking.openURL(`https://wa.me/?text=${texto}`)
    return { ok: true, dados: true }
  } catch {
    return { ok: false, erro: 'Não deu para abrir o WhatsApp.' }
  }
}
