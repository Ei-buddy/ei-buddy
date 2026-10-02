import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { FakeLlm } from './fake-llm.js'
import type { ToolDescriptor } from './types.js'

const tools: readonly ToolDescriptor[] = [
  { id: 'list_sales', description: '', inputSchema: z.object({}), mutatesValue: false },
  { id: 'period_summary', description: '', inputSchema: z.object({}), mutatesValue: false },
  { id: 'create_payable', description: '', inputSchema: z.object({}), mutatesValue: true },
  { id: 'refuse_certificate', description: '', inputSchema: z.object({}), mutatesValue: false },
  { id: 'refuse_banking', description: '', inputSchema: z.object({}), mutatesValue: false },
  { id: 'refuse_invoice_command', description: '', inputSchema: z.object({}), mutatesValue: false },
]

const today = '2026-09-11'

describe('FakeLlm', () => {
  it.each([
    'quanto vendi hoje?',
    'resumo do mes',
    'lança aluguel 1800 vence dia 10',
    'envia o certificado A1',
    'importa o OFX',
    'emite a nota',
  ])('sem script() "%s" e unknown', async (text) => {
    const llm = new FakeLlm()
    const d = await llm.decide({ text, tools, today })
    expect(d).toEqual({ type: 'unknown' })
  })

  it('script() devolve a decisao da chave normalizada', async () => {
    const llm = new FakeLlm()
    const decisao = {
      type: 'tool' as const,
      name: 'list_sales',
      args: { from: today, to: today },
    }
    llm.script('  Quanto Vendi Hoje?  ', decisao)
    const d = await llm.decide({ text: 'quanto vendi hoje?', tools, today })
    expect(d).toEqual(decisao)
  })

  it('history nao muda o resultado', async () => {
    const llm = new FakeLlm()
    const sem = await llm.decide({ text: 'quanto vendi hoje?', tools, today })
    const com = await llm.decide({
      text: 'quanto vendi hoje?',
      tools,
      today,
      history: [{ role: 'user', body: 'lança aluguel 1800 vence dia 10' }],
    })
    expect(sem).toEqual({ type: 'unknown' })
    expect(com).toEqual(sem)

    const roteirada = {
      type: 'tool' as const,
      name: 'create_payable',
      args: { supplier: 'Aluguel', amountCents: 180_000 },
    }
    llm.script('Lança aluguel 1800 vence dia 10', roteirada)
    const comHistorico = await llm.decide({
      text: 'lanca aluguel 1800 vence dia 10',
      tools,
      today,
      history: [{ role: 'user', body: 'quanto vendi hoje?' }],
    })
    expect(comHistorico).toEqual(roteirada)
  })
})
