import { afterAll, describe, expect, it } from 'vitest'
import { cliente, criarLojaDeTeste } from '../src/test-support/loja-de-teste.js'
import { novaConversa, semChave, semTermoTecnico } from './apoio.js'

describe.skipIf(semChave)('avaliação — Correção (US3)', () => {
  const conversa = novaConversa(
    criarLojaDeTeste({ clientes: [cliente({ id: 'cli-pedro', name: 'Pedro' })] }),
  )
  afterAll(() => conversa.salvar('correcao'))

  it('proposta de 1 café → "não, são 3" não grava e refaz → "fechou" grava 3', async () => {
    const proposta = await conversa.enviar('vende um café pro Pedro no pix')
    expect(proposta.kind).toBe('confirmation')
    expect(semTermoTecnico(proposta.buddy)).toBe(true)

    const correcao = await conversa.enviar('não, são 3')
    expect(conversa.loja.gravacoes).toEqual([])
    expect(correcao.kind).toBe('confirmation')
    expect(correcao.buddy).toMatch(/3/)

    const aceite = await conversa.enviar('fechou')
    expect(aceite.kind).toBe('answer')
    const vendas = conversa.loja.gravacoes.filter((g) => g.acao === 'registerSale')
    expect(vendas).toHaveLength(1)
    expect(vendas[0]?.input).toMatchObject({ items: [{ quantity: 3 }] })
    expect(semTermoTecnico(aceite.buddy)).toBe(true)
  })
})
