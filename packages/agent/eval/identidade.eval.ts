import { afterAll, describe, expect, it } from 'vitest'
import { novaConversa, semChave, semTermoTecnico } from './apoio.js'

describe.skipIf(semChave)('avaliação — Identidade de quem fala', () => {
  const conversa = novaConversa()
  afterAll(() => conversa.salvar('identidade'))

  it('consulta da Maria não trata a operadora Ana como cliente', async () => {
    const t = await conversa.enviar('quanto a Maria deve?')
    expect(t.buddy).toMatch(/Maria/i)
    expect(t.buddy).not.toMatch(/cadastr/i)
    expect(t.buddy).not.toMatch(/\bAna\b/)
    expect(semTermoTecnico(t.buddy)).toBe(true)
    expect(conversa.loja.gravacoes).toEqual([])
  })
})
