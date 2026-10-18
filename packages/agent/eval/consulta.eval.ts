import { afterAll, describe, expect, it } from 'vitest'
import { linhasCorridas, novaConversa, semChave, semTermoTecnico } from './apoio.js'

describe.skipIf(semChave)('avaliação — Consulta (US1)', () => {
  const conversa = novaConversa()
  afterAll(() => conversa.salvar('consulta'))

  it('“quanto tem de café?” responde nome, quantidade e preço em reais, sem nada técnico', async () => {
    const t = await conversa.enviar('quanto tem de café?')
    expect(t.buddy).toMatch(/café/i)
    expect(t.buddy).toMatch(/\b0\b|nenhum|zerad|sem estoque|n[aã]o tem|acabou/i)
    expect(t.buddy).toMatch(/R\$\s?25,00/)
    expect(semTermoTecnico(t.buddy)).toBe(true)
    expect(t.buddy).not.toMatch(/indispon/i)
    expect(linhasCorridas(t.buddy)).toBeLessThanOrEqual(3)
    expect(conversa.loja.gravacoes).toEqual([])
  })
})
