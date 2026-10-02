import { describe, expect, it } from 'vitest'
import { CONTEXTO_VAZIO, responder, type FontesDoAssistente } from './assistente-api'

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
