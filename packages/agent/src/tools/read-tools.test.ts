import { describe, expect, it } from 'vitest'
import { RESUMO_VAZIO } from '../conversation-context.js'
import { cliente, criarLojaDeTeste, ctxDaEmpresa, produto } from '../test-support/loja-de-teste.js'
import { ferramentasDeLeitura } from './read-tools.js'
import { ColetorDoTurno, contextoDoTurno, type EstadoDoTurno } from './shared.js'

function estado(sobrescreve: Partial<EstadoDoTurno> = {}): EstadoDoTurno {
  return {
    execucao: ctxDaEmpresa('A'),
    textoDaDona: 'quanto tem de café?',
    resumo: RESUMO_VAZIO,
    coletor: new ColetorDoTurno(),
    conversationKey: 'wa:emp-A:5511999990000',
    ttlMs: 300_000,
    ...sobrescreve,
  }
}

async function chamar(
  tools: ReturnType<typeof ferramentasDeLeitura>,
  id: string,
  input: unknown,
  turno: EstadoDoTurno,
) {
  const tool = (
    tools as unknown as Record<
      string,
      { execute?: (input: unknown, context: unknown) => Promise<unknown> } | undefined
    >
  )[id]
  if (tool?.execute === undefined) throw new Error(`tool ${id} ausente`)
  return tool.execute(input, { requestContext: contextoDoTurno(turno) })
}

function chavesEmCentavos(valor: unknown): string[] {
  const achadas: string[] = []
  const visitar = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visitar)
    if (v === null || typeof v !== 'object') return
    for (const [k, filho] of Object.entries(v)) {
      if (/cents$/i.test(k)) achadas.push(k)
      visitar(filho)
    }
  }
  visitar(valor)
  return achadas
}

const LEITURAS = [
  ['list_sales', { from: '2026-10-06', to: '2026-10-06' }],
  ['period_summary', { from: '2026-10-01', to: '2026-10-31' }],
  ['revenue_by_month', { from: '2026-01-01', to: '2026-10-31' }],
  ['check_stock', { query: 'café' }],
  ['search_products', { q: 'café' }],
  ['check_customer_wallet', { query: 'Maria' }],
  ['list_payables', {}],
  ['list_receivables', {}],
  ['day_agenda', { day: '2026-10-06' }],
  ['rank_customers', { from: '2026-10-01', to: '2026-10-31' }],
  ['rank_products', { from: '2026-10-01', to: '2026-10-31' }],
] as const

describe('tools de leitura', () => {
  it.each(LEITURAS)('%s devolve status ok sem chave em centavos', async (id, input) => {
    const loja = criarLojaDeTeste()
    const saida = await chamar(ferramentasDeLeitura(loja.useCases), id, input, estado())
    expect(saida).toMatchObject({ status: expect.any(String) })
    expect(chavesEmCentavos(saida)).toEqual([])
    expect(loja.gravacoes).toEqual([])
  })

  it('usa o ExecutionContext do turno, nunca um argumento do modelo', async () => {
    const loja = criarLojaDeTeste({
      produtos: [produto({ companyId: 'emp-B', description: 'café da loja B' })],
    })
    const tools = ferramentasDeLeitura(loja.useCases)
    const daA = await chamar(
      tools,
      'check_stock',
      { query: 'café' },
      estado({ execucao: ctxDaEmpresa('A') }),
    )
    expect(daA).toMatchObject({ status: 'nao_encontrado' })
    const daB = await chamar(
      tools,
      'check_stock',
      { query: 'café' },
      estado({ execucao: ctxDaEmpresa('B') }),
    )
    expect(daB).toMatchObject({ status: 'ok', produto: 'café da loja B' })
  })

  it('check_stock devolve preco em reais e registra o produto no coletor', async () => {
    const loja = criarLojaDeTeste()
    const turno = estado()
    const saida = await chamar(
      ferramentasDeLeitura(loja.useCases),
      'check_stock',
      { query: 'café' },
      turno,
    )
    expect(saida).toMatchObject({
      status: 'ok',
      produto: 'café em grãos',
      ref: 'p-cafe',
      quantidade: 'zerado',
    })
    expect(JSON.stringify(saida)).toMatch(/R\$\s?25,00/)
    expect(turno.coletor.snapshot().entidades).toContainEqual({
      tipo: 'produto',
      ref: 'p-cafe',
      rotulo: 'café em grãos',
    })
  })

  it('check_stock de produto sem localizacao nao devolve localizacao — FR-006', async () => {
    const loja = criarLojaDeTeste()
    const saida = await chamar(
      ferramentasDeLeitura(loja.useCases),
      'check_stock',
      { query: 'café' },
      estado(),
    )
    expect(saida).not.toHaveProperty('localizacao')
    expect(JSON.stringify(saida)).not.toMatch(/indispon/i)
  })

  it('search_products com dois produtos lista opcoes com rotulo, preco em reais e ref separado', async () => {
    const loja = criarLojaDeTeste({
      produtos: [
        produto(),
        produto({ id: 'p-moido', description: 'café moído', salePriceCents: 1_800 }),
      ],
    })
    const saida = (await chamar(
      ferramentasDeLeitura(loja.useCases),
      'search_products',
      { q: 'café' },
      estado(),
    )) as { status: string; opcoes: { ref: string; rotulo: string; detalhe: string }[] }
    expect(saida.status).toBe('varios')
    expect(saida.opcoes).toEqual([
      { ref: 'p-cafe', rotulo: 'café em grãos', detalhe: expect.stringMatching(/25,00/) },
      { ref: 'p-moido', rotulo: 'café moído', detalhe: expect.stringMatching(/18,00/) },
    ])
    expect(saida.opcoes.every((o) => !o.rotulo.includes(o.ref))).toBe(true)
  })

  it.each([
    ['find_customer', { termo: 'João' }, 'João'],
    ['find_product', { termo: 'feijão' }, 'feijão'],
  ])('%s sem cadastro devolve nao_encontrado com o termo — US5', async (id, input, termo) => {
    const loja = criarLojaDeTeste()
    const saida = await chamar(ferramentasDeLeitura(loja.useCases), id, input, estado())
    expect(saida).toEqual({ status: 'nao_encontrado', procurado: termo })
  })

  it('find_customer com dois parecidos devolve varios; com um, ok e registra — US5', async () => {
    const loja = criarLojaDeTeste({
      clientes: [
        cliente({ id: 'cli-1', name: 'Pedro Silva' }),
        cliente({ id: 'cli-2', name: 'Pedro Souza' }),
      ],
    })
    const tools = ferramentasDeLeitura(loja.useCases)
    expect(await chamar(tools, 'find_customer', { termo: 'Pedro' }, estado())).toMatchObject({
      status: 'varios',
      opcoes: [{ rotulo: 'Pedro Silva' }, { rotulo: 'Pedro Souza' }],
    })
    const turno = estado()
    expect(await chamar(tools, 'find_customer', { termo: 'Silva' }, turno)).toMatchObject({
      status: 'ok',
      ref: 'cli-1',
      rotulo: 'Pedro Silva',
    })
    expect(turno.coletor.snapshot().entidades).toContainEqual({
      tipo: 'cliente',
      ref: 'cli-1',
      rotulo: 'Pedro Silva',
    })
  })

  it('find_product com um resultado devolve ok com preco em reais — US5', async () => {
    const loja = criarLojaDeTeste()
    const saida = await chamar(
      ferramentasDeLeitura(loja.useCases),
      'find_product',
      { termo: 'café' },
      estado(),
    )
    expect(saida).toMatchObject({
      status: 'ok',
      ref: 'p-cafe',
      rotulo: 'café em grãos',
      quantidade: 'zerado',
    })
    expect(JSON.stringify(saida)).toMatch(/25,00/)
  })

  it('check_customer_wallet registra o cliente no coletor', async () => {
    const loja = criarLojaDeTeste()
    const turno = estado()
    await chamar(
      ferramentasDeLeitura(loja.useCases),
      'check_customer_wallet',
      { query: 'Maria' },
      turno,
    )
    expect(turno.coletor.snapshot().entidades).toContainEqual({
      tipo: 'cliente',
      ref: 'cli-maria',
      rotulo: 'Maria',
    })
  })
})
