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

export const vencido = (o: Orcamento, hoje: string) => o.status === 'open' && o.validUntil < hoje

const resultado = <T>(r: { ok: true; dados: T } | { ok: false; message: string }): Resultado<T> =>
  r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }

export async function carregarOrcamentos(): Promise<Resultado<Orcamento[]>> {
  const r = await chamarApi<{ quotes: Orcamento[] }>('/orcamentos')
  return r.ok ? { ok: true, dados: r.dados.quotes } : { ok: false, erro: r.message }
}

export const carregarOrcamento = async (id: string) =>
  resultado(await chamarApi<Orcamento>(`/orcamentos/${encodeURIComponent(id)}`))

export const criarOrcamento = async (o: NovoOrcamento) =>
  resultado(await chamarApi<Orcamento>('/orcamentos', { method: 'POST', body: o }))

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

/** Direto no WhatsApp, com o texto pronto para escolher o contato. */
export async function mandarPeloWhatsApp(o: Orcamento): Promise<Resultado<true>> {
  const t = await textoDoOrcamento(o)
  if (!t.ok) return t
  try {
    await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(t.dados)}`)
    return { ok: true, dados: true }
  } catch {
    return { ok: false, erro: 'Não deu para abrir o WhatsApp.' }
  }
}
