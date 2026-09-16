import type { DreOutput } from '@na-regua/contracts'
import { Money } from '@na-regua/money'
import { describe, expect, it } from 'vitest'
import {
  chaveDaConversa,
  diaIso,
  formatarCentavos,
  formatarResumoDre,
  LIMITE_TEXTO_MENSAGEM,
  mesDoDia,
  truncarTexto,
} from './format.js'

function dre(over: Partial<DreOutput> = {}): DreOutput {
  return {
    from: '2026-09-01',
    to: '2026-09-30',
    grossRevenueCents: 100_000,
    deductionsCents: 5_000,
    netRevenueCents: 95_000,
    costCents: 40_000,
    grossProfitCents: 55_000,
    expensesCents: 20_000,
    resultCents: 12_345,
    grossMarginPoints: 58,
    lines: [],
    ...over,
  }
}

describe('format', () => {
  it('formata centavos pelo money do dominio', () => {
    expect(formatarCentavos(1_990)).toMatch(/R\$/)
  })

  it('so exibe centavos ja calculados — nao soma nem multiplica — RF-101', () => {
    expect(formatarCentavos(9_500)).toBe(Money.fromCents(9_500).format())
    expect(formatarCentavos(4_990)).toBe(Money.fromCents(4_990).format())
    /* Multiplicar quantidade * preco e conta de domain/core, nao do formatador. */
    expect(formatarCentavos(9_500)).not.toBe(formatarCentavos(2 * 4_990))
  })

  it('corta o dia no fuso da loja, nao em UTC', () => {
    expect(diaIso(new Date('2026-09-12T02:30:00.000Z'), 'America/Sao_Paulo')).toBe('2026-09-11')
  })

  it('abre o mes civil a partir de uma data ISO', () => {
    expect(mesDoDia('2026-09-11')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
  })

  it('cai no proprio valor quando a data nao e AAAA-MM-DD', () => {
    expect(mesDoDia('hoje')).toEqual({ from: 'hoje', to: 'hoje' })
  })

  it('isola conversa de WhatsApp da do aplicativo', () => {
    expect(chaveDaConversa({ channel: 'app', companyId: 'e1', userId: 'u1' })).toBe('app:e1:u1')
    expect(
      chaveDaConversa({
        channel: 'whatsapp',
        companyId: 'e1',
        userId: 'u1',
        peer: '5511',
      }),
    ).toBe('wa:e1:5511')
  })

  it('nao corta texto que cabe no teto', () => {
    expect(truncarTexto('resumo curto', 20)).toBe('resumo curto')
  })

  it('corta texto maior que o teto sem arquivo nem link — RF-108 / RF-109', () => {
    const longo = 'abcdefghij'.repeat(10)
    const cortado = truncarTexto(longo, 12)
    expect(cortado.length).toBe(12)
    expect(cortado.endsWith('\n…')).toBe(true)
    expect(cortado).not.toMatch(/https?:\/\//)
    expect(cortado).not.toMatch(/arquivo|download|\.pdf/i)
  })

  it('teto padrao e o da mensagem do canal', () => {
    expect(LIMITE_TEXTO_MENSAGEM).toBe(4096)
    expect(truncarTexto('x'.repeat(4096)).length).toBe(4096)
    expect(truncarTexto('x'.repeat(4097)).length).toBe(4096)
  })

  it('exibe os quatro eixos do DRE com os centavos do core — RF-108', () => {
    const texto = formatarResumoDre(dre())
    expect(texto).toContain('2026-09-01')
    expect(texto).toContain('2026-09-30')
    expect(texto).toContain('Faturamento')
    expect(texto).toContain('Custo')
    expect(texto).toContain('Despesas')
    expect(texto).toContain('Resultado')
    expect(texto).toContain(formatarCentavos(95_000))
    expect(texto).toContain(formatarCentavos(40_000))
    expect(texto).toContain(formatarCentavos(20_000))
    expect(texto).toContain(formatarCentavos(12_345))
    /* 95_000 - 40_000 - 20_000 = 35_000 — o formatador nao recalcula resultado. */
    expect(texto).not.toContain(formatarCentavos(35_000))
  })

  it('trunca detalhe longo e guarda os eixos — RF-108; RF-109 nao implementado', () => {
    const texto = formatarResumoDre(
      dre({
        lines: Array.from({ length: 80 }, (_, i) => ({
          accountId: `acc-${i}`,
          accountName: `Conta detalhada ${i} com nome longo para estourar o teto`,
          type: 'expense' as const,
          amountCents: 1_000 + i,
          entryCount: 1,
        })),
      }),
      220,
    )
    expect(texto.length).toBeLessThanOrEqual(220)
    expect(texto).toContain('Faturamento')
    expect(texto).toContain('Custo')
    expect(texto).toContain('Despesas')
    expect(texto).toContain('Resultado')
    expect(texto).toContain(formatarCentavos(12_345))
    expect(texto.endsWith('\n…')).toBe(true)
    expect(texto).not.toMatch(/https?:\/\//)
    expect(texto).not.toMatch(/arquivo|download|\.pdf|link para/i)
  })
})
