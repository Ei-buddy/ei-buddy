import { describe, expect, it, vi } from 'vitest'
import { InMemoryConfirmations } from '../confirmations.js'
import { RESUMO_VAZIO, type ResumoDeEntidades } from '../conversation-context.js'
import {
  AGORA,
  cliente,
  criarLojaDeTeste,
  ctxDaEmpresa,
  produto,
  type LojaDeTeste,
} from '../test-support/loja-de-teste.js'
import { ferramentasDeProposta } from './proposal-tools.js'
import { ColetorDoTurno, contextoDoTurno, type EstadoDoTurno } from './shared.js'

const TTL = 300_000

function montar(loja: LojaDeTeste = criarLojaDeTeste(), resumo: ResumoDeEntidades = RESUMO_VAZIO) {
  const confirmations = new InMemoryConfirmations()
  const put = vi.spyOn(confirmations, 'put')
  const tools = ferramentasDeProposta(loja.useCases, confirmations) as unknown as Record<
    string,
    { execute: (input: unknown, context: unknown) => Promise<unknown> }
  >
  const turno: EstadoDoTurno = {
    execucao: ctxDaEmpresa('A'),
    textoDaDona: 'vende um café pro Pedro',
    resumo,
    coletor: new ColetorDoTurno(),
    conversationKey: 'wa:emp-A:5511999990000',
    ttlMs: TTL,
  }
  const chamar = (id: string, input: unknown) =>
    tools[id]!.execute(input, { requestContext: contextoDoTurno(turno) })
  return { loja, confirmations, put, turno, chamar }
}

const pedro = cliente({ id: 'cli-pedro', name: 'Pedro' })

describe('create_sale — perguntar e assumir (US2)', () => {
  it('sem pagamento devolve faltando e nao cria proposta', async () => {
    const { chamar, put, loja } = montar(criarLojaDeTeste({ clientes: [pedro] }))
    const saida = await chamar('create_sale', {
      customerId: 'Pedro',
      items: [{ productId: 'café' }],
    })
    expect(saida).toMatchObject({ status: 'faltando', faltando: ['forma de pagamento'] })
    expect(put).not.toHaveBeenCalled()
    expect(loja.gravacoes).toEqual([])
  })

  it('sem quantidade e preco assume 1 e o preco de tabela, e grava a proposta validada', async () => {
    const { chamar, confirmations, turno, loja } = montar(criarLojaDeTeste({ clientes: [pedro] }))
    const saida = (await chamar('create_sale', {
      customerId: 'Pedro',
      items: [{ productId: 'café' }],
      payments: [{ method: 'pix' }],
    })) as { status: string; fatos: string[]; assumido: string[] }

    expect(saida.status).toBe('proposta')
    expect(saida.assumido.join(' ')).toMatch(/quantidade 1/)
    expect(saida.assumido.join(' ')).toMatch(/preço de tabela.*25,00/)
    expect(saida.fatos.join(' ')).toMatch(/Pedro/)
    expect(saida.fatos.join(' ')).toMatch(/pix/)
    expect(JSON.stringify(saida)).not.toMatch(/Cents|cli-pedro|p-cafe/)

    const pendente = await confirmations.getOpen('emp-A', turno.conversationKey, AGORA)
    expect(pendente).toMatchObject({ toolId: 'create_sale' })
    expect(pendente?.expiresAt.getTime()).toBe(AGORA.getTime() + TTL)
    expect(pendente?.args).toMatchObject({
      entrada: {
        customerId: 'cli-pedro',
        items: [{ productId: 'p-cafe', quantity: 1, unitPriceCents: 2_500 }],
        payments: [{ method: 'pix', amountCents: 2_500 }],
      },
    })
    expect(turno.coletor.propostaNova?.id).toBe(pendente?.id)
    expect(loja.gravacoes).toEqual([])
  })

  it('desconto zero nao aparece nos fatos nem na entrada guardada', async () => {
    const { chamar, confirmations, turno } = montar(criarLojaDeTeste({ clientes: [pedro] }))
    const saida = (await chamar('create_sale', {
      customerId: 'Pedro',
      items: [{ productId: 'café', discountCents: 0 }],
      payments: [{ method: 'pix' }],
      discountCents: 0,
    })) as { fatos: string[] }

    expect(saida.fatos.join(' ')).not.toMatch(/desconto/)
    const pendente = await confirmations.getOpen('emp-A', turno.conversationKey, AGORA)
    expect(JSON.stringify(pendente?.args)).not.toMatch(/discount/)
  })

  it('parcela unica fora do credito e a vista: nao recusa o pix', async () => {
    const { chamar, confirmations, turno } = montar(criarLojaDeTeste({ clientes: [pedro] }))
    const saida = (await chamar('create_sale', {
      customerId: 'Pedro',
      items: [{ productId: 'café' }],
      payments: [{ method: 'pix', installments: 1 }],
    })) as { status: string }

    expect(saida.status).toBe('proposta')
    const pendente = await confirmations.getOpen('emp-A', turno.conversationKey, AGORA)
    expect(pendente?.args).toMatchObject({
      entrada: { payments: [{ method: 'pix', amountCents: 2_500 }] },
    })
    expect(JSON.stringify(pendente?.args)).not.toMatch(/installments/)
  })

  it('pix parcelado continua recusado com a regra', async () => {
    const { chamar, put } = montar(criarLojaDeTeste({ clientes: [pedro] }))
    const saida = await chamar('create_sale', {
      customerId: 'Pedro',
      items: [{ productId: 'café' }],
      payments: [{ method: 'pix', installments: 3 }],
    })
    expect(saida).toMatchObject({ status: 'recusado' })
    expect(put).not.toHaveBeenCalled()
  })

  it('cliente com mais de um cadastro compativel devolve varios com nome e telefone', async () => {
    const { chamar, put } = montar(
      criarLojaDeTeste({
        clientes: [
          cliente({ id: 'cli-1', name: 'Pedro Silva', phone: '11911110000' }),
          cliente({ id: 'cli-2', name: 'Pedro Souza', phone: '11922220000' }),
        ],
      }),
    )
    const saida = await chamar('create_sale', {
      customerId: 'Pedro',
      items: [{ productId: 'café' }],
      payments: [{ method: 'pix' }],
    })
    expect(saida).toMatchObject({
      status: 'varios',
      opcoes: [
        { rotulo: 'Pedro Silva', detalhe: '11911110000' },
        { rotulo: 'Pedro Souza', detalhe: '11922220000' },
      ],
    })
    expect(put).not.toHaveBeenCalled()
  })

  it('produto com mais de um cadastro compativel devolve varios', async () => {
    const { chamar, put } = montar(
      criarLojaDeTeste({
        produtos: [produto(), produto({ id: 'p-moido', description: 'café moído' })],
      }),
    )
    const saida = await chamar('create_sale', {
      items: [{ productId: 'café' }],
      payments: [{ method: 'cash' }],
    })
    expect(saida).toMatchObject({ status: 'varios' })
    expect(put).not.toHaveBeenCalled()
  })

  it('fiado sem cliente e recusado pela regra da tela', async () => {
    const { chamar, put } = montar()
    const saida = await chamar('create_sale', {
      items: [{ productId: 'café' }],
      payments: [{ method: 'wallet' }],
    })
    expect(saida).toMatchObject({ status: 'recusado', mensagem: expect.stringMatching(/fiado/i) })
    expect(put).not.toHaveBeenCalled()
  })
})

describe('create_product — obrigatorio e opcional (US2)', () => {
  it('sem os obrigatorios devolve faltando com os nomes e os opcionais', async () => {
    const { chamar, put } = montar()
    const saida = (await chamar('create_product', { description: 'café' })) as {
      status: string
      faltando: string[]
      opcionais: string[]
    }
    expect(saida.status).toBe('faltando')
    expect(saida.faltando).toEqual(['unidade', 'custo', 'preço de venda'])
    expect(saida.opcionais.join(' ')).toMatch(/código de barras/)
    expect(put).not.toHaveBeenCalled()
  })

  it('preco de venda menor que o custo e recusado sem proposta', async () => {
    const { chamar, put } = montar()
    const saida = await chamar('create_product', {
      description: 'café',
      unitOfMeasure: 'un',
      costPriceCents: 2_000,
      salePriceCents: 1_000,
    })
    expect(saida).toMatchObject({ status: 'recusado', mensagem: expect.stringMatching(/custo/i) })
    expect(put).not.toHaveBeenCalled()
  })
})

describe('cadastro no meio do pedido (US5)', () => {
  const paraRetomar = {
    acao: 'create_sale',
    descricao: 'venda de café para o João',
    jaDito: { produto: 'café' },
  }

  it('create_customer com paraRetomar abre a intencao e o campo nao vai para o caso de uso', async () => {
    const { chamar, turno, confirmations } = montar()
    const saida = await chamar('create_customer', { name: 'João', paraRetomar })
    expect(saida).toMatchObject({ status: 'proposta' })
    expect(turno.coletor.snapshot().intencao).toEqual({
      acao: 'create_sale',
      descricao: 'venda de café para o João',
      jaDito: { produto: 'café' },
      aguardando: 'cadastro_cliente',
    })
    const pendente = await confirmations.getOpen('emp-A', turno.conversationKey, AGORA)
    expect(pendente?.args).toEqual({ entrada: { name: 'João' }, rotulos: {} })
  })

  it('create_product com paraRetomar abre a intencao aguardando o cadastro do produto', async () => {
    const { chamar, turno } = montar()
    await chamar('create_product', {
      description: 'feijão',
      unitOfMeasure: 'kg',
      costPriceCents: 500,
      salePriceCents: 900,
      paraRetomar,
    })
    expect(turno.coletor.snapshot().intencao).toMatchObject({ aguardando: 'cadastro_produto' })
  })

  it('paraRetomar sem jaDito herda o que a venda interrompida ja sabia', async () => {
    const { chamar, turno } = montar()
    await chamar('create_sale', {
      customerId: 'João',
      items: [{ productId: 'café' }],
      payments: [{ method: 'pix' }],
    })
    await chamar('create_customer', {
      name: 'João',
      paraRetomar: { acao: 'create_sale', descricao: 'venda de café para o João' },
    })
    expect(turno.coletor.snapshot().intencao?.jaDito).toMatchObject({
      payments: [{ method: 'pix' }],
      items: [{ productId: 'café' }],
    })
  })

  it('cliente com o mesmo nome ja conhecido na conversa nao vira outro cadastro', async () => {
    const { chamar, put } = montar(criarLojaDeTeste(), {
      entidades: [{ tipo: 'cliente', ref: 'cli-joao', rotulo: 'João' }],
    })
    const saida = await chamar('create_customer', { name: 'joao', paraRetomar })
    expect(saida).toMatchObject({ status: 'ja_cadastrado', ref: 'cli-joao', rotulo: 'João' })
    expect(put).not.toHaveBeenCalled()
  })

  it('uma segunda proposta no mesmo turno devolve ja_tem_proposta e nao grava outra', async () => {
    const { chamar, put } = montar()
    await chamar('create_customer', { name: 'João' })
    const segunda = await chamar('create_sale', {
      customerId: 'Maria',
      items: [{ productId: 'café' }],
      payments: [{ method: 'pix' }],
    })
    expect(segunda).toMatchObject({ status: 'ja_tem_proposta' })
    expect(put).toHaveBeenCalledOnce()
  })

  it('cliente inexistente na venda devolve nao_encontrado e abre intencao de cadastro', async () => {
    const { chamar, turno, put } = montar()
    const saida = await chamar('create_sale', {
      customerId: 'João',
      items: [{ productId: 'café' }],
      payments: [{ method: 'pix' }],
    })
    expect(saida).toEqual({ status: 'nao_encontrado', tipo: 'cliente', procurado: 'João' })
    expect(turno.coletor.snapshot().intencao).toMatchObject({
      acao: 'create_sale',
      aguardando: 'cadastro_cliente',
    })
    expect(put).not.toHaveBeenCalled()
  })
})

const DEMAIS: readonly [string, unknown][] = [
  ['create_customer', { name: 'João' }],
  ['update_customer', { id: 'Maria', phone: '11999998888' }],
  ['mark_customer_deleted', { id: 'Maria' }],
  ['update_product', { id: 'café', salePriceCents: 3_000 }],
  ['mark_product_deleted', { id: 'café' }],
  ['cancel_sale', { saleId: 'venda-1', reason: 'cliente desistiu' }],
  [
    'create_payable',
    {
      supplier: 'Imobiliária',
      description: 'Aluguel',
      amountCents: 180_000,
      dueDate: '2026-10-10',
    },
  ],
  [
    'create_receivable',
    { description: 'Aluguel vitrine', amountCents: 50_000, dueDate: '2026-10-18' },
  ],
  [
    'settle_payable',
    { payableId: 'pag-1', amountCents: 10_000, settledOn: '2026-10-06', bankAccount: 'Caixa' },
  ],
  [
    'settle_receivable',
    { receivableId: 'rec-1', amountCents: 10_000, settledOn: '2026-10-06', method: 'pix' },
  ],
  ['adjust_stock', { productId: 'café', countedQuantity: 3, reason: 'contagem' }],
  ['create_appointment', { title: 'Entrega do fornecedor', startsAt: '2026-10-07T13:00:00.000Z' }],
  ['send_charge', { customerId: 'Maria' }],
]

describe('demais tools de proposta (US2)', () => {
  it.each(DEMAIS)(
    '%s grava proposta validada e nao chama caso de uso de gravacao',
    async (id, input) => {
      const { chamar, put, loja } = montar()
      const saida = (await chamar(id, input)) as { status: string; fatos: string[] }
      expect(saida.status).toBe('proposta')
      expect(saida.fatos.length).toBeGreaterThan(0)
      expect(JSON.stringify(saida.fatos)).not.toMatch(/[a-z][A-Z]|_|Cents/)
      expect(put).toHaveBeenCalledOnce()
      expect(put.mock.calls[0]?.[0]).toMatchObject({ toolId: id, companyId: 'emp-A' })
      expect(loja.gravacoes).toEqual([])
    },
  )

  it('update_product fala em preco de venda em reais', async () => {
    const { chamar } = montar()
    const saida = (await chamar('update_product', { id: 'café', salePriceCents: 1_400 })) as {
      fatos: string[]
    }
    expect(saida.fatos.join(' ')).toMatch(/preço de venda.*14,00/)
    expect(saida.fatos.join(' ')).toMatch(/café em grãos/)
  })
})
