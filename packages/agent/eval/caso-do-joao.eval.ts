import { afterAll, describe, expect, it } from 'vitest'
import { criarLojaDeTeste } from '../src/test-support/loja-de-teste.js'
import { novaConversa, semChave, semTermoTecnico } from './apoio.js'

/**
 * O caso do teste manual que motivou a spec 013: cliente que não existe,
 * cadastro no meio do pedido e retomada da venda sem a dona repetir.
 */
describe.skipIf(semChave)('avaliação — Caso do João (US5)', () => {
  const conversa = novaConversa(criarLojaDeTeste({ clientes: [] }))
  afterAll(() => conversa.salvar('caso-do-joao'))

  it('pede a venda, cadastra, retoma, pergunta o pagamento e grava em até 4 mensagens dela', async () => {
    const pedido = await conversa.enviar('O João quer comprar café')
    expect(pedido.buddy).toMatch(/cadastr/i)
    expect(pedido.buddy).not.toMatch(/n[aã]o encontrei esse cliente\.?$/i)
    expect(semTermoTecnico(pedido.buddy)).toBe(true)

    const mensagensDela: string[] = []
    const responder = async (texto: string) => {
      mensagensDela.push(texto)
      return conversa.enviar(texto)
    }

    let atual = await responder('cadastra')
    if (atual.kind === 'confirmation' && !/pagar|pagamento|pix|dinheiro/i.test(atual.buddy)) {
      atual = await responder('pode')
    }
    expect(atual.buddy).toMatch(/pag/i)
    expect(conversa.loja.clientes.some((c) => c.name.includes('João'))).toBe(true)

    atual = await responder('pix')
    expect(atual.kind).toBe('confirmation')
    expect(atual.buddy).toMatch(/café/i)

    await responder('fechou')
    const vendas = conversa.loja.gravacoes.filter((g) => g.acao === 'registerSale')
    expect(vendas).toHaveLength(1)
    expect(mensagensDela.length).toBeLessThanOrEqual(4)
    expect(conversa.turnos.every((t) => semTermoTecnico(t.buddy))).toBe(true)
  })
})
