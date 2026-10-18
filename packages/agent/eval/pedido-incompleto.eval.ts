import { afterAll, describe, expect, it } from 'vitest'
import { linhasCorridas, novaConversa, semChave, semTermoTecnico } from './apoio.js'

describe.skipIf(semChave)('avaliação — Pedido incompleto (US2)', () => {
  const conversa = novaConversa()
  afterAll(() => conversa.salvar('pedido-incompleto'))

  it('“adicione café” pede os obrigatórios numa única mensagem e cita os opcionais', async () => {
    const t = await conversa.enviar('adicione café')
    expect(t.kind).toBe('answer')
    expect(t.buddy).toMatch(/unidade/i)
    expect(t.buddy).toMatch(/custo/i)
    expect(t.buddy).toMatch(/preço de venda|preço/i)
    expect(t.buddy).toMatch(/opcional|opcionais|também pode|se quiser/i)
    expect(semTermoTecnico(t.buddy)).toBe(true)
    expect(linhasCorridas(t.buddy)).toBeLessThanOrEqual(4)
    expect(conversa.loja.gravacoes).toEqual([])
  })
})
