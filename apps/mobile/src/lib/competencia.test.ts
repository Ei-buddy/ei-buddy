import { describe, expect, it } from 'vitest'
import {
  anosDoSeletor,
  competencia,
  competenciaPorExtenso,
  primeiroMesDoAno,
  vencimentoNoMes,
} from './competencia'

/** Gerar contas dos custos fixos por mes e ano — achado do QA. */
describe('seletor de mes e ano', () => {
  it('anos: o atual e os dois seguintes', () => {
    expect(anosDoSeletor('2026-11-07')).toEqual([2026, 2027, 2028])
  })

  it('no ano atual comeca no mes atual; nos seguintes, em janeiro', () => {
    expect(primeiroMesDoAno('2026-11-07', 2026)).toBe(11)
    expect(primeiroMesDoAno('2026-11-07', 2027)).toBe(1)
  })

  it('competencia no formato da api', () => {
    expect(competencia(2026, 3)).toBe('2026-03')
    expect(competencia(2027, 12)).toBe('2027-12')
  })

  it('por extenso para a mensagem', () => {
    expect(competenciaPorExtenso('2026-03')).toBe('março de 2026')
  })
})

describe('vencimentoNoMes — a regra do servidor', () => {
  it('dia comum fica no dia', () => {
    expect(vencimentoNoMes(5, '2026-12')).toBe('2026-12-05')
  })

  it('dia 31 em mes de 30 vence no 30', () => {
    expect(vencimentoNoMes(31, '2026-11')).toBe('2026-11-30')
  })

  it('fevereiro: 28 em ano comum, 29 em bissexto', () => {
    expect(vencimentoNoMes(30, '2027-02')).toBe('2027-02-28')
    expect(vencimentoNoMes(30, '2028-02')).toBe('2028-02-29')
  })
})
