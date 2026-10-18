import { afterAll, describe, expect, it } from 'vitest'
import { cliente, criarLojaDeTeste } from '../src/test-support/loja-de-teste.js'
import { novaConversa, semChave, semTermoTecnico } from './apoio.js'

describe.skipIf(semChave)('avaliação — Referência (US4)', () => {
  const conversa = novaConversa(
    criarLojaDeTeste({ clientes: [cliente({ id: 'cli-joao', name: 'João' })] }),
  )
  afterAll(() => conversa.salvar('referencia'))

  it('cita o João e depois "ele quer comprar 2 cafés" segue a venda sem pedir o nome', async () => {
    await conversa.enviar('quanto o João deve?')
    const t = await conversa.enviar('ele quer comprar 2 cafés no pix')

    expect(t.kind).toBe('confirmation')
    expect(t.buddy).toMatch(/João/)
    expect(t.buddy).not.toMatch(/qual (cliente|o nome)/i)
    expect(semTermoTecnico(t.buddy)).toBe(true)
    expect(conversa.loja.gravacoes).toEqual([])
  })
})
