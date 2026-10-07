import { describe, expect, it, vi } from 'vitest'
import { createBuddyBrain, type ConversarInput } from './buddy-brain.js'
import { InMemoryConfirmations } from './confirmations.js'
import { RESUMO_VAZIO, type ResumoDeEntidades } from './conversation-context.js'
import { TEXTO_SEM_RESPOSTA_LIMPA } from './technical-terms.js'
import { criarLojaDeTeste, ctxDaEmpresa } from './test-support/loja-de-teste.js'
import { roteiroDoModelo, type EtapaRoteirizada } from './test-support/mock-model.js'

function montar(etapas: readonly EtapaRoteirizada[]) {
  const { modelo, chamadas } = roteiroDoModelo(etapas)
  const loja = criarLojaDeTeste()
  const confirmations = new InMemoryConfirmations()
  const brain = createBuddyBrain({
    model: modelo,
    useCases: loja.useCases,
    confirmations,
    ttlMs: 300_000,
  })
  return { brain, chamadas, loja, confirmations }
}

function entrada(sobrescreve: Partial<ConversarInput> = {}): ConversarInput {
  return {
    execucao: ctxDaEmpresa('A'),
    conversationKey: 'wa:emp-A:5511999990000',
    texto: 'tem café?',
    janela: [],
    resumo: RESUMO_VAZIO,
    hoje: '2026-10-06',
    ...sobrescreve,
  }
}

function textoDoPrompt(prompt: unknown): string {
  return JSON.stringify(prompt)
}

describe('createBuddyBrain — nada técnico na resposta (US1)', () => {
  const UUID = '78a3705e-de89-4b52-b5a2-276561075c13'

  it('resposta com UUID pede uma reescrita e devolve a reescrita', async () => {
    const { brain, chamadas } = montar([
      { texto: `Tem café em grãos (${UUID}) a R$ 25,00.` },
      { texto: 'Tem café em grãos a R$ 25,00.' },
    ])
    const saida = await brain.conversar(entrada())
    expect(saida.texto).toBe('Tem café em grãos a R$ 25,00.')
    expect(chamadas).toHaveLength(2)
  })

  it('se a reescrita também tiver termo, o trecho é removido antes de devolver', async () => {
    const { brain, chamadas } = montar([
      { texto: `Tem café a R$ 25,00. Código ${UUID}.` },
      { texto: `Tem café a R$ 25,00. Código PROD-0001.` },
      { texto: 'nunca chega aqui' },
    ])
    const saida = await brain.conversar(entrada())
    expect(saida.texto).toBe('Tem café a R$ 25,00.')
    expect(chamadas).toHaveLength(2)
  })
})

describe('createBuddyBrain — pedir o que falta (US2)', () => {
  it('venda sem pagamento: a tool devolve faltando e o modelo pergunta, sem proposta', async () => {
    const { brain, confirmations, chamadas } = montar([
      { tool: 'create_sale', args: { customerId: 'Maria', items: [{ productId: 'café' }] } },
      { texto: 'Como a Maria vai pagar: dinheiro, pix, débito, crédito ou fiado?' },
    ])
    const saida = await brain.conversar(entrada({ texto: 'vende um café pra Maria' }))

    expect(saida.propostaNova).toBeUndefined()
    expect(saida.texto).toMatch(/pagar/)
    expect(JSON.stringify(chamadas[1]?.prompt)).toContain('forma de pagamento')
    expect(
      await confirmations.getOpen('emp-A', 'wa:emp-A:5511999990000', new Date()),
    ).toBeUndefined()
    expect(saida.snapshot.intencao).toMatchObject({ acao: 'create_sale', aguardando: 'dados' })
  })

  it('pedir confirmacao sem propor faz o modelo chamar a ferramenta da proposta', async () => {
    const { brain, chamadas } = montar([
      { texto: 'Perfeito: 1 café pra Maria no pix. Pode confirmar?' },
      {
        tool: 'create_sale',
        args: {
          customerId: 'Maria',
          items: [{ productId: 'café' }],
          payments: [{ method: 'pix' }],
        },
      },
      { texto: 'Ficou 1 café em grãos a R$ 25,00 pra Maria, no pix. Posso confirmar?' },
    ])
    const saida = await brain.conversar(entrada({ texto: 'vende um café pra Maria no pix' }))

    expect(chamadas).toHaveLength(3)
    expect(textoDoPrompt(chamadas[1]?.prompt)).toMatch(/sem chamar a ferramenta/)
    expect(saida.propostaNova?.id).toEqual(expect.any(String))
    expect(saida.texto).toMatch(/R\$ 25,00/)
  })

  it.each([
    'Quer que eu siga com 1 unidade no pix?',
    'Quer que eu registre essa venda?',
    'Me confirma se são 2 unidades e pix mesmo?',
    'Preciso só confirmar: são 2 cafés no pix?',
  ])('"%s" sem proposta tambem pede a ferramenta', async (pergunta) => {
    const { brain, chamadas } = montar([{ texto: pergunta }, { texto: 'Pronto.' }])
    await brain.conversar(entrada({ texto: 'vende um café pra Maria no pix' }))
    expect(chamadas).toHaveLength(2)
  })

  it('oferecer cadastro nao e confirmacao solta', async () => {
    const { brain, chamadas } = montar([{ texto: 'Não achei o João. Quer que eu cadastre ele?' }])
    await brain.conversar(entrada({ texto: 'vende um café pro João' }))
    expect(chamadas).toHaveLength(1)
  })

  it('pergunta de confirmacao com proposta pendente nao pede reescrita', async () => {
    const { brain, chamadas } = montar([{ texto: 'Ainda vale aquela venda? Pode confirmar?' }])
    await brain.conversar(
      entrada({
        texto: 'e aí',
        pendente: {
          id: 'conf-1',
          companyId: 'emp-A',
          conversationKey: 'wa:emp-A:5511999990000',
          toolId: 'create_sale',
          args: {},
          summary: '1x café',
          status: 'open',
          expiresAt: new Date('2026-10-06T13:00:00Z'),
          createdAt: new Date('2026-10-06T12:00:00Z'),
        } as never,
      }),
    )
    expect(chamadas).toHaveLength(1)
  })

  it('venda com pagamento: proposta com o assumido e propostaNova na saida', async () => {
    const { brain, confirmations, chamadas, loja } = montar([
      {
        tool: 'create_sale',
        args: {
          customerId: 'Maria',
          items: [{ productId: 'café' }],
          payments: [{ method: 'pix' }],
        },
      },
      { texto: 'Vou registrar 1 café em grãos a R$ 25,00 pra Maria, no pix. Posso confirmar?' },
    ])
    const saida = await brain.conversar(entrada({ texto: 'vende um café pra Maria no pix' }))

    expect(saida.propostaNova?.id).toEqual(expect.any(String))
    expect(JSON.stringify(chamadas[1]?.prompt)).toMatch(/quantidade 1/)
    const pendente = await confirmations.getOpen('emp-A', 'wa:emp-A:5511999990000', new Date())
    expect(pendente?.id).toBe(saida.propostaNova?.id)
    expect(loja.gravacoes).toEqual([])
  })
})

describe('createBuddyBrain — aceite e correção (US3)', () => {
  const nomes = (c: { tools: readonly { name: string }[] } | undefined) =>
    c?.tools.map((t) => t.name) ?? []

  it('sem pendente, accept_proposal e cancel_proposal nao ficam disponiveis', async () => {
    const { brain, chamadas } = montar([{ texto: 'Oi!' }])
    await brain.conversar(entrada({ texto: 'oi' }))
    expect(nomes(chamadas[0])).not.toContain('accept_proposal')
    expect(nomes(chamadas[0])).not.toContain('cancel_proposal')
    expect(nomes(chamadas[0])).toContain('create_sale')
  })

  it('com pendente, as tools de aceite ficam disponiveis e os fatos vao no sistema', async () => {
    const { brain, chamadas, confirmations } = montar([
      {
        tool: 'create_sale',
        args: {
          customerId: 'Maria',
          items: [{ productId: 'café' }],
          payments: [{ method: 'pix' }],
        },
      },
      { texto: 'Vou registrar 1 café pra Maria no pix. Posso?' },
      { tool: 'accept_proposal', args: {} },
      { texto: 'Pronto, venda registrada.' },
    ])
    const primeira = await brain.conversar(entrada({ texto: 'vende um café pra Maria no pix' }))
    const pendente = await confirmations.getOpen('emp-A', 'wa:emp-A:5511999990000', new Date())
    expect(pendente?.id).toBe(primeira.propostaNova?.id)

    const segunda = await brain.conversar(entrada({ texto: 'fechou', pendente: pendente! }))
    expect(nomes(chamadas[2])).toContain('accept_proposal')
    expect(nomes(chamadas[2])).toContain('cancel_proposal')
    expect(JSON.stringify(chamadas[2]?.prompt)).toContain('Maria')
    expect(segunda.decidiuPendente).toBe(true)
    expect(segunda.texto).toBe('Pronto, venda registrada.')
  })

  it('correção no mesmo turno vira nova proposta e encerra a anterior', async () => {
    const { brain, confirmations } = montar([
      {
        tool: 'create_sale',
        args: {
          customerId: 'Maria',
          items: [{ productId: 'café' }],
          payments: [{ method: 'pix' }],
        },
      },
      { texto: 'Vou registrar 1 café. Posso?' },
      { tool: 'accept_proposal', args: {} },
      {
        tool: 'create_sale',
        args: {
          customerId: 'Maria',
          items: [{ productId: 'café', quantity: 3 }],
          payments: [{ method: 'pix' }],
        },
      },
      { texto: 'Então são 3 cafés no pix. Posso confirmar?' },
    ])
    await brain.conversar(entrada({ texto: 'vende um café pra Maria no pix' }))
    const anterior = await confirmations.getOpen('emp-A', 'wa:emp-A:5511999990000', new Date())

    const segunda = await brain.conversar(entrada({ texto: 'não, são 3', pendente: anterior! }))
    const atual = await confirmations.getOpen('emp-A', 'wa:emp-A:5511999990000', new Date())
    expect(segunda.propostaNova?.id).toBe(atual?.id)
    expect(atual?.id).not.toBe(anterior?.id)
    expect(atual?.args).toMatchObject({ entrada: { items: [{ quantity: 3 }] } })
  })
})

describe('createBuddyBrain — referência pelo resumo (US4)', () => {
  it('"ele" usa o ref do resumo e a proposta sai para o João sem nova busca', async () => {
    const resumo: ResumoDeEntidades = {
      entidades: [{ tipo: 'cliente', ref: 'cli-joao', rotulo: 'João' }],
    }
    const { modelo, chamadas } = roteiroDoModelo([
      {
        tool: 'create_sale',
        args: {
          customerId: 'cli-joao',
          items: [{ productId: 'café', quantity: 2 }],
          payments: [{ method: 'pix' }],
        },
      },
      { texto: 'Vou registrar 2 cafés pro João no pix. Posso?' },
    ])
    const loja = criarLojaDeTeste()
    const searchCustomers = vi.spyOn(loja.useCases, 'searchCustomers')
    const confirmations = new InMemoryConfirmations()
    const brain = createBuddyBrain({
      model: modelo,
      useCases: loja.useCases,
      confirmations,
      ttlMs: 300_000,
    })

    await brain.conversar(entrada({ texto: 'ele quer comprar 2 cafés no pix', resumo }))

    const sistema = JSON.stringify(
      (chamadas[0]?.prompt as { role: string; content: unknown }[]).filter(
        (m) => m.role === 'system',
      ),
    )
    expect(sistema).toContain('João')
    expect(sistema).toContain('cli-joao')
    expect(searchCustomers).not.toHaveBeenCalled()
    const pendente = await confirmations.getOpen('emp-A', 'wa:emp-A:5511999990000', new Date())
    expect(pendente?.args).toMatchObject({
      entrada: { customerId: 'cli-joao' },
      rotulos: { cliente: 'João' },
    })
  })
})

describe('createBuddyBrain — caso do João (US5)', () => {
  it('no turno do aceite do cadastro, o modelo retoma a venda e pergunta o pagamento', async () => {
    const intencao = {
      acao: 'create_sale',
      descricao: 'venda de café para o João',
      jaDito: { produto: 'café' },
      aguardando: 'cadastro_cliente' as const,
    }
    const paraRetomar = {
      acao: intencao.acao,
      descricao: intencao.descricao,
      jaDito: intencao.jaDito,
    }
    const { brain, confirmations, chamadas } = montar([
      { tool: 'create_customer', args: { name: 'João', paraRetomar } },
      { texto: 'Vou cadastrar o João. Posso?' },
      { tool: 'accept_proposal', args: {} },
      { tool: 'find_product', args: { termo: 'café' } },
      { tool: 'create_sale', args: { customerId: 'João', items: [{ productId: 'café' }] } },
      { texto: 'João cadastrado! O café sai a R$ 25,00. Como ele vai pagar?' },
    ])
    await brain.conversar(entrada({ texto: 'cadastra ele' }))
    const pendente = await confirmations.getOpen('emp-A', 'wa:emp-A:5511999990000', new Date())

    const saida = await brain.conversar(
      entrada({ texto: 'pode', pendente: pendente!, resumo: { entidades: [], intencao } }),
    )

    expect(saida.decidiuPendente).toBe(true)
    expect(saida.propostaNova).toBeUndefined()
    expect(saida.texto).toMatch(/pagar/)
    expect(JSON.stringify(chamadas[3]?.prompt)).toMatch(/venda de café para o João/)
    expect(saida.snapshot.intencao).toMatchObject({ acao: 'create_sale', aguardando: 'dados' })
    expect(saida.snapshot.entidades).toContainEqual(
      expect.objectContaining({ tipo: 'cliente', rotulo: 'João' }),
    )
  })
})

describe('createBuddyBrain — limite de etapas (US7)', () => {
  it('na quinta etapa o modelo nao pode chamar tool; nenhuma sexta chamada', async () => {
    const { brain, chamadas, loja } = montar([
      { tool: 'check_stock', args: { query: 'café' } },
      { tool: 'check_stock', args: { query: 'café' } },
      { tool: 'check_stock', args: { query: 'café' } },
      { tool: 'check_stock', args: { query: 'café' } },
      { texto: 'Até aqui entendi que você quer saber do café. Quer que eu continue?' },
      { texto: 'nunca chega aqui' },
    ])
    const saida = await brain.conversar(entrada())

    expect(chamadas).toHaveLength(5)
    expect(chamadas[4]?.toolChoice).toEqual({ type: 'none' })
    expect(chamadas[3]?.toolChoice).toEqual({ type: 'auto' })
    expect(saida.etapas).toBe(5)
    expect(saida.texto).toMatch(/entendi/)
    expect(loja.gravacoes).toEqual([])
  })
})

describe('createBuddyBrain — resposta vazia (avaliação)', () => {
  it('etapa final vazia pede ao modelo mais uma tentativa', async () => {
    const { brain, chamadas } = montar([{ texto: '' }, { texto: 'Tem café em grãos a R$ 25,00.' }])
    const saida = await brain.conversar(entrada())
    expect(chamadas).toHaveLength(2)
    expect(saida.texto).toBe('Tem café em grãos a R$ 25,00.')
  })

  it('se o modelo terminar sem texto de novo, a dona recebe uma frase segura, nunca vazio', async () => {
    const { brain } = montar([{ texto: '' }, { texto: '' }])
    const saida = await brain.conversar(entrada())
    expect(saida.texto).toBe(TEXTO_SEM_RESPOSTA_LIMPA)
  })

  it('texto repetido duas vezes seguidas chega uma vez só', async () => {
    const frase = 'Como a Maria vai pagar: dinheiro, pix, débito, crédito ou fiado?'
    const { brain } = montar([{ texto: `${frase}${frase}` }])
    const saida = await brain.conversar(entrada())
    expect(saida.texto).toBe(frase)
  })
})

describe('createBuddyBrain — laço de várias etapas', () => {
  it('consulta dentro do laço e redige a partir do resultado', async () => {
    const { brain, chamadas } = montar([
      { tool: 'check_stock', args: { query: 'café' } },
      { texto: 'Tem café em grãos, sem unidades no estoque, a R$ 25,00.' },
    ])
    const saida = await brain.conversar(entrada())

    expect(saida.texto).toBe('Tem café em grãos, sem unidades no estoque, a R$ 25,00.')
    expect(saida.etapas).toBe(2)
    expect(saida.snapshot.v).toBe(2)
    expect(saida.snapshot.entidades).toContainEqual({
      tipo: 'produto',
      ref: 'p-cafe',
      rotulo: 'café em grãos',
    })
    expect(textoDoPrompt(chamadas[1]?.prompt)).toMatch(/R\$\s?25,00/)
  })

  it('manda a janela como mensagens e a data e o resumo como sistema', async () => {
    const resumo: ResumoDeEntidades = {
      entidades: [{ tipo: 'cliente', ref: 'cli-1', rotulo: 'João' }],
    }
    const { brain, chamadas } = montar([{ texto: 'Certo.' }])
    await brain.conversar(
      entrada({
        janela: [
          { role: 'user', body: 'cadastra o João' },
          { role: 'assistant', body: 'João cadastrado.' },
        ],
        resumo,
      }),
    )

    const prompt = chamadas[0]?.prompt as { role: string; content: unknown }[]
    const sistema = prompt.filter((m) => m.role === 'system').map((m) => JSON.stringify(m.content))
    expect(sistema.join(' ')).toContain('2026-10-06')
    expect(sistema.join(' ')).toContain('João')
    expect(prompt.filter((m) => m.role === 'user')).toHaveLength(2)
    expect(prompt.filter((m) => m.role === 'assistant')).toHaveLength(1)
  })
})
