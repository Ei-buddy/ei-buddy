import { afterAll, describe, expect, it } from 'vitest'
import { novaConversa, semChave, semTermoTecnico } from './apoio.js'

describe.skipIf(semChave)('avaliação — Fora do escopo, recusa e erro de regra (US6)', () => {
  const conversa = novaConversa()
  afterAll(() => conversa.salvar('nao-e-erro'))

  it('“me conta uma piada” diz o que faz em palavras comuns, sem nome de ferramenta', async () => {
    const t = await conversa.enviar('me conta uma piada')
    expect(t.buddy).toMatch(/loja/i)
    expect(t.buddy).toMatch(/vend|estoque|devendo|conta/i)
    expect(t.buddy).not.toMatch(/por que o|porque ele|haha/i)
    expect(semTermoTecnico(t.buddy)).toBe(true)
    expect(t.buddy).not.toMatch(/_/)
    expect(conversa.loja.gravacoes).toEqual([])
  })

  it('“importa meu extrato” recusa, diz que nada foi feito e onde fazer', async () => {
    const t = await conversa.enviar('importa meu extrato do banco')
    expect(t.buddy).toMatch(/aplicativo|app/i)
    expect(semTermoTecnico(t.buddy)).toBe(true)
    expect(conversa.loja.gravacoes).toEqual([])
  })

  it('produto com preço abaixo do custo explica e não diz que gravou', async () => {
    const t = await conversa.enviar('cadastra feijão, unidade kg, custo 10 reais, vende a 8 reais')
    expect(t.buddy).toMatch(/custo/i)
    expect(t.buddy).not.toMatch(/cadastrad[oa]\b(?!.*não)/i)
    expect(conversa.loja.gravacoes).toEqual([])
  })
})
