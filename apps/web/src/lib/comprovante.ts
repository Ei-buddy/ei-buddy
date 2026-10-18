/**
 * Comprovante de venda NAO fiscal — NR-154.
 *
 * O recibo que o lojista entrega quando nao emite nota (ou enquanto a nota nao
 * sai): impresso na termica ou mandado pelo WhatsApp. Texto puro, em largura
 * de bobina (40 colunas), porque e o que sobrevive aos dois caminhos — a
 * impressora de cupom e a conversa do WhatsApp nao entendem layout.
 *
 * O MESMO gerador mora no app (`apps/mobile/src/lib/comprovante.ts`), com o
 * mesmo teste: o cliente que recebe o recibo do celular e o do balcao precisa
 * ver o mesmo papel.
 */

export const LARGURA = 40

export type DadosDoComprovante = {
  loja: {
    nome: string
    cnpj: string
    endereco: string | null
    telefone: string | null
  }
  venda: {
    numero: number
    /** Ja formatado no fuso de quem imprime — ex.: "07/10/2026 14:32". */
    quando: string
    cliente: string | null
    itens: { descricao: string; quantidade: number; precoUnitario: number; total: number }[]
    /** Em reais. */
    bruto: number
    desconto: number
    total: number
    /** Ja sem o troco: e o que ficou com a loja. */
    pagamentos: { forma: string; valor: number; parcelas: number | null }[]
    /** Troco devolvido em dinheiro — NR-156. Zero quando nao houve. */
    troco?: number
    /** Cancelada ou devolvida sai marcada: recibo de venda desfeita engana. */
    situacao: 'normal' | 'cancelada' | 'devolvida'
  }
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
/* O espaco do Intl e nao-quebravel (U+00A0); na bobina vira espaco comum. */
const dinheiro = (v: number) => brl.format(v).replace(/\u00a0/g, ' ')

const linha = (c = '-') => c.repeat(LARGURA)

/** Texto a esquerda e valor a direita, na mesma linha. */
function colunas(esquerda: string, direita: string): string {
  const espaco = LARGURA - direita.length - 1
  const e = esquerda.length > espaco ? `${esquerda.slice(0, espaco - 1)}…` : esquerda
  return `${e}${' '.repeat(LARGURA - e.length - direita.length)}${direita}`
}

function centro(texto: string): string {
  const t = texto.length > LARGURA ? texto.slice(0, LARGURA) : texto
  const sobra = LARGURA - t.length
  return `${' '.repeat(Math.floor(sobra / 2))}${t}`
}

/** Quebra o texto longo em linhas da largura da bobina, sem cortar palavra. */
function quebrar(texto: string): string[] {
  const palavras = texto.split(/\s+/).filter(Boolean)
  const linhas: string[] = []
  let atual = ''
  for (const p of palavras) {
    if (atual === '') atual = p
    else if (atual.length + 1 + p.length <= LARGURA) atual += ` ${p}`
    else {
      linhas.push(atual)
      atual = p
    }
  }
  if (atual !== '') linhas.push(atual)
  return linhas
}

const quantidade = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(3).replace('.', ','))

const cnpjFormatado = (c: string) => {
  const d = c.replace(/\D/g, '')
  return d.length === 14
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : c
}

export function montarComprovante({ loja, venda }: DadosDoComprovante): string {
  const l: string[] = []

  l.push(...quebrar(loja.nome).map(centro))
  l.push(centro(`CNPJ ${cnpjFormatado(loja.cnpj)}`))
  if (loja.endereco) l.push(...quebrar(loja.endereco).map(centro))
  if (loja.telefone) l.push(centro(loja.telefone))
  l.push(linha('='))
  l.push(centro('COMPROVANTE DE VENDA'))
  l.push(centro('NAO E DOCUMENTO FISCAL'))
  l.push(linha('='))
  l.push(colunas(`Venda #${venda.numero}`, venda.quando))
  if (venda.cliente) l.push(...quebrar(`Cliente: ${venda.cliente}`))
  if (venda.situacao !== 'normal') {
    l.push(
      centro(
        venda.situacao === 'cancelada' ? '*** VENDA CANCELADA ***' : '*** VENDA DEVOLVIDA ***',
      ),
    )
  }
  l.push(linha())

  for (const item of venda.itens) {
    l.push(...quebrar(item.descricao))
    l.push(
      colunas(
        `  ${quantidade(item.quantidade)} x ${dinheiro(item.precoUnitario)}`,
        dinheiro(item.total),
      ),
    )
  }

  l.push(linha())
  if (venda.desconto > 0) {
    l.push(colunas('Subtotal', dinheiro(venda.bruto)))
    l.push(colunas('Desconto', `-${dinheiro(venda.desconto)}`))
  }
  l.push(colunas('TOTAL', dinheiro(venda.total)))
  l.push(linha())

  for (const p of venda.pagamentos) {
    const forma = p.parcelas !== null && p.parcelas > 1 ? `${p.forma} ${p.parcelas}x` : p.forma
    l.push(colunas(forma, dinheiro(p.valor)))
  }
  const troco = venda.troco ?? 0
  if (troco > 0) {
    l.push(colunas('Recebido', dinheiro(venda.total + troco)))
    l.push(colunas('Troco', dinheiro(troco)))
  }

  l.push(linha())
  l.push(centro('Obrigado pela preferencia!'))

  return l.join('\n')
}

/** Orcamento para o cliente — NR-159. Mesmo papel do comprovante. */
export type DadosDoOrcamento = {
  loja: DadosDoComprovante['loja']
  orcamento: {
    numero: number
    /** Ja formatados: "07/10/2026". */
    emitido: string
    validoAte: string
    cliente: string | null
    itens: { descricao: string; quantidade: number; precoUnitario: number; total: number }[]
    /** Em reais. */
    bruto: number
    desconto: number
    total: number
    observacoes: string | null
  }
}

export function montarOrcamento({ loja, orcamento }: DadosDoOrcamento): string {
  const l: string[] = []

  l.push(...quebrar(loja.nome).map(centro))
  l.push(centro(`CNPJ ${cnpjFormatado(loja.cnpj)}`))
  if (loja.endereco) l.push(...quebrar(loja.endereco).map(centro))
  if (loja.telefone) l.push(centro(loja.telefone))
  l.push(linha('='))
  l.push(centro('ORCAMENTO'))
  l.push(centro('NAO E DOCUMENTO FISCAL'))
  l.push(linha('='))
  l.push(colunas(`Orcamento #${orcamento.numero}`, orcamento.emitido))
  if (orcamento.cliente) l.push(...quebrar(`Cliente: ${orcamento.cliente}`))
  l.push(linha())

  for (const item of orcamento.itens) {
    l.push(...quebrar(item.descricao))
    l.push(
      colunas(
        `  ${quantidade(item.quantidade)} x ${dinheiro(item.precoUnitario)}`,
        dinheiro(item.total),
      ),
    )
  }

  l.push(linha())
  if (orcamento.desconto > 0) {
    l.push(colunas('Subtotal', dinheiro(orcamento.bruto)))
    l.push(colunas('Desconto', `-${dinheiro(orcamento.desconto)}`))
  }
  l.push(colunas('TOTAL', dinheiro(orcamento.total)))
  l.push(linha())
  l.push(`Valido ate ${orcamento.validoAte}`)
  if (orcamento.observacoes) l.push(...quebrar(`Obs.: ${orcamento.observacoes}`))
  l.push(linha())
  l.push(centro('Obrigado pela preferencia!'))

  return l.join('\n')
}
