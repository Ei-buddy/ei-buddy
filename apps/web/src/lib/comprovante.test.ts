import { describe, expect, it } from 'vitest'
import { LARGURA, montarComprovante, type DadosDoComprovante } from './comprovante'

/**
 * Comprovante nao fiscal — NR-154. O app tem o MESMO teste
 * (`apps/mobile/src/lib/comprovante.test.ts`): os dois papeis precisam bater.
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
    pagamentos: [{ forma: 'Dinheiro', valor: 100, parcelas: null }],
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
    expect(t).toMatch(/Troco\s+R\$ 30,00/)
  })

  it('credito parcelado mostra as parcelas', () => {
    const t = montarComprovante({
      ...base,
      venda: { ...base.venda, pagamentos: [{ forma: 'Crédito', valor: 70, parcelas: 3 }] },
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
