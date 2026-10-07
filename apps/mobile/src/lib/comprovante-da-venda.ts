import { Share } from 'react-native'
import { montarComprovante } from './comprovante'
import { carregarEmpresa } from './empresa-api'
import { FORMAS, type VendaHistorico } from './vendas-api'

const quando = (iso: string) =>
  new Date(iso)
    .toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(', ', ' ')

const telefone = (ddd: string, numero: string) =>
  numero === ''
    ? null
    : ddd === ''
      ? numero
      : `(${ddd}) ${numero.length === 9 ? `${numero.slice(0, 5)}-${numero.slice(5)}` : numero}`

/**
 * Compartilha o comprovante NAO fiscal da venda — NR-154. O texto e o mesmo do
 * web; o menu do sistema leva ao WhatsApp, ao e-mail ou a impressora termica
 * (pelo app dela).
 */
export async function compartilharComprovante(
  v: VendaHistorico,
): Promise<{ ok: true } | { ok: false; erro: string }> {
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

  const texto = montarComprovante({
    loja: {
      nome: e.nomeFantasia || e.razaoSocial,
      cnpj: e.cnpj,
      endereco: endereco === '' ? null : endereco,
      telefone: telefone(e.ddd, e.celular),
    },
    venda: {
      numero: Number(v.numero),
      quando: quando(v.data),
      cliente: v.clienteNome === '' ? null : v.clienteNome,
      itens: v.itens.map((i) => ({
        descricao: i.descricao,
        quantidade: i.quantidade,
        precoUnitario: i.precoUnitario,
        total: Math.round(i.quantidade * i.precoUnitario * 100) / 100,
      })),
      bruto: v.subtotal,
      desconto: v.desconto,
      total: v.total,
      pagamentos: v.pagamentos.map((p) => ({
        forma: FORMAS.find((f) => f.valor === p.forma)?.rotulo ?? p.forma,
        valor: p.valor,
        parcelas: null,
      })),
      situacao: v.status === 'estornada' ? 'cancelada' : 'normal',
    },
  })

  try {
    await Share.share({ title: `Comprovante #${v.numero}`, message: texto })
    return { ok: true }
  } catch {
    return { ok: false, erro: 'Não deu para compartilhar o comprovante.' }
  }
}
