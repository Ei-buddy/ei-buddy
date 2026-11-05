import { describe, expect, it } from 'vitest'
import {
  CONTEXTO_VAZIO,
  responder,
  resumoDasCompras,
  type FontesDoAssistente,
} from './assistente-api'

/**
 * As perguntas prontas respondem com os dados da LOJA.
 *
 * O QA perguntou "ranking dos clientes" e recebeu clientes de `mock-data` que
 * nao existiam. Aqui as fontes sao falsas e conhecidas: a resposta tem de
 * repetir exatamente elas — e nada alem delas.
 */

const HOJE = '2026-10-01'

const falhar = async () => ({ ok: false as const, erro: 'nao usado neste teste' })

const fontes = (sobrescreve: Partial<FontesDoAssistente>): FontesDoAssistente => ({
  historico: falhar,
  faturamento: falhar,
  rankingDeClientes: falhar,
  rankingDeProdutos: falhar,
  catalogo: falhar,
  contasAPagar: falhar,
  contasAReceber: falhar,
  dre: falhar,
  plano: falhar,
  clientes: falhar,
  comprasDoCliente: falhar,
  pendenciasDoCliente: falhar,
  reposicao: falhar,
  ...sobrescreve,
})

/* Intl separa o simbolo com espaco nao quebravel. */
const texto = (r: unknown) => JSON.stringify(r).replace(/\\u00a0| /g, ' ')

describe('assistente com os dados da loja', () => {
  it('"quanto vendi hoje" usa o historico e os meses reais', async () => {
    const r = await responder(
      'Quanto vendi hoje',
      CONTEXTO_VAZIO,
      fontes({
        historico: async (de, ate) => {
          expect([de, ate]).toEqual([HOJE, HOJE])
          return {
            ok: true,
            dados: {
              vendas: [],
              total: 10,
              pagina: 1,
              porPagina: 1,
              resumo: { quantidade: 10, faturamento: 1130.93, liquido: 1000, ticketMedio: 113.09 },
            },
          }
        },
        faturamento: async () => ({
          ok: true,
          dados: {
            from: '2026-08-01',
            to: '2026-10-31',
            totalNetCents: 103170,
            months: [
              {
                month: '2026-10',
                grossCents: 0,
                discountsCents: 0,
                netCents: 103170,
                salesCount: 10,
                averageTicketCents: null,
              },
            ],
          },
        }),
      }),
      HOJE,
    )

    expect(r.texto).toContain('1.130,93')
    expect(r.texto).toContain('10 vendas')
    /* Bruto e liquido, os dois, cada um com o nome que tem. */
    expect(r.texto).toContain('brutos')
    expect(r.texto).toMatch(/Líquido: R\$\s1\.000,00/)
    expect(texto(r)).toContain('out/2026')
    /* A tabela fixa de antes ("Agosto R$ 64.200") nao pode voltar. */
    expect(texto(r)).not.toContain('64.200')
  })

  it('"ranking dos clientes" lista quem a api devolveu', async () => {
    const r = await responder(
      'Ranking dos clientes',
      CONTEXTO_VAZIO,
      fontes({
        rankingDeClientes: async () => ({
          ok: true,
          dados: {
            from: '2026-07-04',
            to: HOJE,
            unidentifiedCents: 0,
            customers: [
              {
                customerId: 'c1',
                customerName: 'QA Gisele Torres',
                netCents: 78678,
                salesCount: 1,
                lastSaleOn: HOJE,
              },
            ],
          },
        }),
      }),
      HOJE,
    )

    expect(texto(r)).toContain('QA Gisele Torres')
    expect(texto(r)).toContain('786,78')
    expect(texto(r)).not.toContain('Padaria Sol')
  })

  it('"o que ha para pagar hoje" separa hoje e atrasadas das contas reais', async () => {
    const conta = (id: string, dueDate: string, amountCents: number) => ({
      id,
      supplier: `Fornecedor ${id}`,
      description: 'Conta',
      amountCents,
      settledAmountCents: 0,
      dueDate,
      status: 'open' as const,
      accountId: null,
      recurrenceId: null,
      occurrenceNumber: null,
      occurrenceCount: null,
      createdAt: '2026-09-01T12:00:00.000Z',
    })

    const r = await responder(
      'O que há para pagar hoje',
      CONTEXTO_VAZIO,
      fontes({
        contasAPagar: async () => ({
          ok: true,
          dados: [
            conta('hoje', HOJE, 10000),
            conta('atrasada', '2026-09-20', 5000),
            conta('futura', '2026-10-15', 7000),
          ],
        }),
      }),
      HOJE,
    )

    expect(r.texto.replace(/\s/g, ' ')).toBe('1 conta(s) vencendo hoje, somando R$ 100,00.')
    expect(texto(r)).toContain('Fornecedor atrasada')
    expect(texto(r)).not.toContain('Fornecedor futura')
    expect(texto(r)).not.toContain('Torrefacao')
  })
})

describe('cliente citado na pergunta', () => {
  /* "está" com acento nao fechava o nome: a busca recebia "Ana Souza está". */
  it('acha o nome antes de "está devendo"', async () => {
    let termo = ''
    await responder(
      'O que o cliente Ana Souza está devendo',
      CONTEXTO_VAZIO,
      fontes({
        clientes: async (o) => {
          termo = o.termo ?? ''
          return { ok: true, dados: [] }
        },
      }),
      HOJE,
    )

    expect(termo).toBe('Ana Souza')
  })

  it('a divida sai com data em dd/mm/aaaa', async () => {
    const r = await responder(
      'O que o cliente Ana Souza está devendo',
      CONTEXTO_VAZIO,
      fontes({
        clientes: async () => ({
          ok: true,
          dados: [
            {
              id: 'c1',
              nome: 'Ana Souza',
              documento: null,
              celular: null,
              email: null,
              saldoFiado: 16.98,
              ultimaCompra: HOJE,
              totalCompras: 1,
              valorTotal: 16.98,
              faltando: [],
            },
          ],
        }),
        pendenciasDoCliente: async () => ({
          ok: true,
          dados: [
            {
              id: 'p1',
              referente: 'Fiado',
              vencimento: '2026-10-02',
              valor: 16.98,
              status: 'aberto',
            },
          ],
        }),
      }),
      HOJE,
    )

    expect(texto(r)).toContain('vence 02/10/2026')
  })
})

describe('cliente cadastrado — achado do QA', () => {
  const cliente = (id: string, nome: string) => ({
    id,
    nome,
    documento: null,
    celular: null,
    email: null,
    saldoFiado: 0,
    ultimaCompra: null,
    totalCompras: 0,
    valorTotal: 0,
    faltando: [],
  })

  /* "funciona desde que a pergunta tenha vindo do cadastro de clientes; no
     assistente nao": sem a palavra "cliente" o nome nao era reconhecido. */
  it.each([
    ['O João Silva está cadastrado?', 'João Silva'],
    ['Maria Souza é cliente?', 'Maria Souza'],
    ['Tem o Pedro cadastrado?', 'Pedro'],
    ['Existe cliente chamado Carla Dias?', 'Carla Dias'],
    ['procure o cliente Ana', 'Ana'],
    ['O cliente Ana Souza está cadastrado?', 'Ana Souza'],
  ])('reconhece o nome em "%s"', async (pergunta, esperado) => {
    let termo = ''
    const r = await responder(
      pergunta,
      CONTEXTO_VAZIO,
      fontes({
        clientes: async (o) => {
          termo = o.termo ?? ''
          return { ok: true, dados: [cliente('c1', esperado)] }
        },
        comprasDoCliente: async () => ({ ok: true, dados: [] }),
      }),
      HOJE,
    )

    expect(termo).toBe(esperado)
    expect(r.contexto.clienteId).toBe('c1')
  })

  it('responde que esta cadastrado', async () => {
    const r = await responder(
      'O João Silva está cadastrado?',
      CONTEXTO_VAZIO,
      fontes({
        clientes: async () => ({ ok: true, dados: [cliente('c1', 'João da Silva')] }),
        comprasDoCliente: async () => ({ ok: true, dados: [] }),
      }),
      HOJE,
    )

    expect(r.texto).toBe('Sim, encontrei João da Silva no cadastro, ainda sem compras.')
  })

  it('com mais de um, lista e pergunta qual — e nao escolhe o primeiro', async () => {
    const r = await responder(
      'A Maria está cadastrada?',
      CONTEXTO_VAZIO,
      fontes({
        clientes: async () => ({
          ok: true,
          dados: [cliente('c1', 'Maria Silva'), cliente('c2', 'Maria Souza')],
        }),
      }),
      HOJE,
    )

    expect(r.intencao).toBe('cliente_varios')
    expect(r.contexto.clienteId).toBeNull()
    expect(texto(r)).toContain('Maria Souza')
  })

  it('nao achou: oferece cadastrar', async () => {
    const r = await responder(
      'O Zeca está cadastrado?',
      CONTEXTO_VAZIO,
      fontes({ clientes: async () => ({ ok: true, dados: [] }) }),
      HOJE,
    )

    expect(r.intencao).toBe('cliente_nao_encontrado')
  })
})

describe('reposicao — media de 6 meses', () => {
  it('lista o que o servidor sugeriu, com o negativo marcado', async () => {
    const r = await responder(
      'Quais produtos precisam de reposição de estoque',
      CONTEXTO_VAZIO,
      fontes({
        reposicao: async () => ({
          ok: true,
          dados: [
            {
              productId: 'p1',
              description: 'Café 500g',
              unitOfMeasure: 'un',
              stock: 2,
              minStock: 0,
              monthlyAverage: 10,
              suggestedQuantity: 8,
              reason: 'vendas' as const,
            },
            {
              productId: 'p2',
              description: 'Açúcar',
              unitOfMeasure: 'kg',
              stock: -3,
              minStock: 0,
              monthlyAverage: 0,
              suggestedQuantity: 3,
              reason: 'negativo' as const,
            },
          ],
        }),
      }),
      HOJE,
    )

    expect(r.intencao).toBe('reposicao')
    expect(texto(r)).toContain('Café 500g')
    expect(texto(r)).toContain('8 un')
    expect(texto(r)).toContain('3 kg (negativo)')
  })
})

describe('resumo das compras do cliente', () => {
  it('fala natural, sem "compra(s)", e nao inventa numero acima da lista', () => {
    expect(resumoDasCompras(0)).toBe('ainda sem compras')
    expect(resumoDasCompras(1)).toBe('com 1 compra')
    expect(resumoDasCompras(7)).toBe('com 7 compras')
    /* A lista do cliente vem com no maximo 20 vendas. */
    expect(resumoDasCompras(20)).toBe('com 20 compras ou mais')
  })
})
