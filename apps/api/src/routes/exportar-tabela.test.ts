import { describe, expect, it } from 'vitest'
import { type Tabela, tabelaCsv, tabelaPdf } from './exportar-tabela.js'

/** O exportador generico — NR-155. */

type L = { nome: string; valor: string }

const tabela: Tabela<L> = {
  titulo: 'Clientes',
  colunas: [
    { titulo: 'Nome', valor: (l) => l.nome, largura: 300 },
    { titulo: 'Saldo', valor: (l) => l.valor, largura: 100, alinhar: 'direita' },
  ],
  linhas: [
    { nome: 'Maria; Souza', valor: 'R$ 1.234,56' },
    { nome: 'João "Zé"', valor: 'R$ 0,00' },
  ],
  rodape: ['Total', 'R$ 1.234,56'],
}

describe('exportar tabela — NR-155', () => {
  it('CSV com BOM, ; e aspas onde precisa', () => {
    const csv = tabelaCsv(tabela)
    const [cabecalho, l1, l2, , rodape] = csv.slice(1).split('\r\n')

    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(cabecalho).toBe('Nome;Saldo')
    expect(l1).toBe('"Maria; Souza";R$ 1.234,56')
    expect(l2).toBe('"João ""Zé""";R$ 0,00')
    expect(rodape).toBe('Total;R$ 1.234,56')
  })

  it('PDF de verdade, mesmo com muitas linhas (quebra de pagina)', async () => {
    const muitas = { ...tabela, linhas: Array.from({ length: 120 }, () => tabela.linhas[0]!) }

    const pdf = await tabelaPdf(muitas, new Date('2026-10-07T12:00:00Z'))

    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('PDF de lista vazia nao quebra', async () => {
    const pdf = await tabelaPdf({ ...tabela, linhas: [], rodape: undefined }, new Date())

    expect(pdf.length).toBeGreaterThan(100)
  })
})
