import { describe, expect, it, vi } from 'vitest'
import { planoNaTela } from './contabilidade-api'

vi.mock('./api', () => ({ chamarApi: vi.fn() }))

/** Plano de contas — achado do QA: ordenar por nome e filtrar por tipo. */
const plano = [
  { name: 'Venda de mercadoria', type: 'revenue' as const },
  { name: 'Outras receitas', type: 'revenue' as const },
  { name: 'Impostos sobre venda', type: 'deduction' as const },
  { name: 'Custo da mercadoria vendida', type: 'cost' as const },
  { name: 'aluguel', type: 'expense' as const },
  { name: 'Água', type: 'expense' as const },
  { name: 'Energia', type: 'expense' as const },
]
const nomes = (l: readonly { name: string }[]) => l.map((c) => c.name)

describe('planoNaTela', () => {
  it('padrao: todos, na ordem do servidor (a do DRE)', () => {
    expect(nomes(planoNaTela(plano, 'todos', 'tipo'))).toEqual(nomes(plano))
  })

  it('ordena por nome sem tropecar em acento nem maiuscula', () => {
    expect(nomes(planoNaTela(plano, 'todos', 'nome'))).toEqual([
      'Água',
      'aluguel',
      'Custo da mercadoria vendida',
      'Energia',
      'Impostos sobre venda',
      'Outras receitas',
      'Venda de mercadoria',
    ])
  })

  it('nome de Z a A', () => {
    expect(nomes(planoNaTela(plano, 'todos', 'nome-desc'))[0]).toBe('Venda de mercadoria')
  })

  it('filtra por tipo e ordena dentro do filtro', () => {
    expect(nomes(planoNaTela(plano, 'expense', 'nome'))).toEqual(['Água', 'aluguel', 'Energia'])
    expect(nomes(planoNaTela(plano, 'revenue', 'tipo'))).toEqual([
      'Venda de mercadoria',
      'Outras receitas',
    ])
  })

  it('tipo sem conta devolve lista vazia, sem mexer no original', () => {
    const copia = [...plano]
    expect(
      planoNaTela(
        plano.filter((c) => c.type !== 'cost'),
        'cost',
        'nome',
      ),
    ).toEqual([])
    planoNaTela(plano, 'todos', 'nome')
    expect(plano).toEqual(copia)
  })
})
