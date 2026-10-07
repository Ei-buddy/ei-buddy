import { describe, expect, it } from 'vitest'
import { LARGURA, montarComprovante, montarOrcamento, type DadosDoComprovante } from './comprovante'

/**
 * Comprovante nao fiscal — NR-154. O web tem o MESMO teste
 * (`apps/web/src/lib/comprovante.test.ts`): os dois papeis precisam bater.
 */

const base: DadosDoComprovante = {
  loja: {
    nome: 'Mercearia Sol Nascente',
    cnpj: '11222333000181',
    endereco: 'Rua das Flores, 100 - Centro - Curitiba/PR',
    telefone: '(41) 99999-0000',
  },
  venda: {
    numero: 42,
    quando: '07/10/2026 14:32',
    cliente: 'Maria Souza',
    itens: [
      { descricao: 'Arroz tipo 1 5kg', quantidade: 2, precoUnitario: 28.9, total: 57.8 },
      { descricao: 'Cafe torrado 500g', quantidade: 1, precoUnitario: 18.9, total: 18.9 },
    ],
    bruto: 76.7,
    desconto: 6.7,
    total: 70,
    pagamentos: [{ forma: 'Dinheiro', valor: 70, parcelas: null }],
    troco: 30,
    situacao: 'normal',
  },
}

describe('comprovante nao fiscal — NR-154', () => {
  it('diz que nao e documento fiscal', () => {
    expect(montarComprovante(base)).toContain('NAO E DOCUMENTO FISCAL')
  })

  it('nenhuma linha passa da largura da bobina', () => {
    const longo = {
      ...base,
      venda: {
        ...base.venda,
        itens: [
          {
            descricao: 'Produto com uma descricao muito comprida que nao cabe numa linha so',
            quantidade: 1,
            precoUnitario: 1234.56,
            total: 1234.56,
          },
        ],
      },
    }
    for (const l of montarComprovante(longo).split('\n')) {
      expect(l.length).toBeLessThanOrEqual(LARGURA)
    }
  })

  it('traz loja, numero, cliente, itens, desconto, total, pagamento e troco', () => {
    const t = montarComprovante(base)

    expect(t).toContain('CNPJ 11.222.333/0001-81')
    expect(t).toContain('Venda #42')
    expect(t).toContain('Cliente: Maria Souza')
    expect(t).toContain('2 x R$ 28,90')
    expect(t).toMatch(/Desconto\s+-R\$ 6,70/)
    expect(t).toMatch(/TOTAL\s+R\$ 70,00/)
    expect(t).toMatch(/Recebido\s+R\$ 100,00/)
    expect(t).toMatch(/Troco\s+R\$ 30,00/)
  })

  it('credito parcelado mostra as parcelas', () => {
    const t = montarComprovante({
      ...base,
      venda: {
        ...base.venda,
        pagamentos: [{ forma: 'Crédito', valor: 70, parcelas: 3 }],
        troco: 0,
      },
    })

    expect(t).toMatch(/Crédito 3x\s+R\$ 70,00/)
    expect(t).not.toContain('Troco')
  })

  it('venda cancelada sai marcada', () => {
    const t = montarComprovante({ ...base, venda: { ...base.venda, situacao: 'cancelada' } })

    expect(t).toContain('VENDA CANCELADA')
  })

  it('sem cliente e sem desconto, nao inventa linha', () => {
    const t = montarComprovante({
      ...base,
      venda: { ...base.venda, cliente: null, desconto: 0, bruto: 70 },
    })

    expect(t).not.toContain('Cliente:')
    expect(t).not.toContain('Subtotal')
  })
})

describe('orcamento — NR-159', () => {
  const texto = montarOrcamento({
    loja: base.loja,
    orcamento: {
      numero: 7,
      emitido: '07/10/2026',
      validoAte: '17/10/2026',
      cliente: 'Joana',
      itens: [{ descricao: 'Tinta 18L', quantidade: 2, precoUnitario: 300, total: 600 }],
      bruto: 600,
      desconto: 50,
      total: 550,
      observacoes: 'Entrega em 3 dias',
    },
  })

  it('tem cabecalho, validade e total, sem passar da bobina', () => {
    expect(texto).toContain('ORCAMENTO')
    expect(texto).toContain('Orcamento #7')
    expect(texto).toContain('Valido ate 17/10/2026')
    expect(texto).toMatch(/TOTAL\s+R\$ 550,00/)
    expect(texto).toContain('Obs.: Entrega em 3 dias')
    for (const l of texto.split('\n')) expect(l.length).toBeLessThanOrEqual(LARGURA)
  })
})
