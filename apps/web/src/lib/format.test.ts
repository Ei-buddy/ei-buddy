/**
 * Datas de vencimento — NR-013.
 *
 * ## O que este arquivo guarda
 *
 * `daysUntil` tinha a referencia FIXA no codigo: `reference = '2026-08-24'`. E
 * ela nao decide so um rotulo — em `ContasView` ela decide se um titulo esta
 * VENCIDO. Com a referencia parada em agosto, toda conta vencida depois daquele
 * dia aparecia como "aberto", e o lojista abria a tela de contas a pagar sem
 * ver o que estava atrasado.
 *
 * ## O fuso e a metade dificil
 *
 * Os testes rodam num fuso FIXO (`America/Sao_Paulo`, UTC-3) e nao no da
 * maquina, como em `agenda-api.test.ts`. O motivo e o mesmo: `toISOString()`
 * converte para UTC, e as 21h de Sao Paulo viram o DIA SEGUINTE. Num runner em
 * UTC o defeito nao aparece — foi assim que ele sobreviveu em tres
 * repositorios de `db`, segundo o comentario do vitest.config de la.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { daysUntil, describeDueDate, diaLocal, formatCentavos, hoje, mesDeHoje } from './format'

/* Import estatico e `TZ` depois, como em `agenda-api.test.ts`: as funcoes leem
   o fuso na CHAMADA, e nao na carga do modulo. */
const FUSO_ORIGINAL = process.env.TZ
process.env.TZ = 'America/Sao_Paulo'

afterAll(() => {
  process.env.TZ = FUSO_ORIGINAL
})

describe('diaLocal', () => {
  it('devolve o dia do fuso local', () => {
    expect(diaLocal(new Date('2026-09-08T12:00:00-03:00'))).toBe('2026-09-08')
  })

  /*
   * O caso que `toISOString()` erra: as 21h de Sao Paulo sao 00h do dia
   * seguinte em UTC. Um calendario que se adiantasse um dia depois das 21h e
   * um defeito que so aparece para quem abre a tela de noite — e por isso
   * ninguem reporta.
   */
  it('as 21h de Sao Paulo AINDA sao o mesmo dia', () => {
    expect(diaLocal(new Date('2026-09-08T21:30:00-03:00'))).toBe('2026-09-08')
  })

  it('as 23h59 tambem', () => {
    expect(diaLocal(new Date('2026-09-08T23:59:00-03:00'))).toBe('2026-09-08')
  })

  it('a meia-noite ja e o dia seguinte', () => {
    expect(diaLocal(new Date('2026-09-09T00:01:00-03:00'))).toBe('2026-09-09')
  })

  it('preenche mes e dia com zero', () => {
    expect(diaLocal(new Date('2026-01-05T10:00:00-03:00'))).toBe('2026-01-05')
  })
})

describe('hoje e mesDeHoje', () => {
  it('hoje segue o relogio, e nao uma constante', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2027-03-14T10:00:00-03:00'))
      expect(hoje()).toBe('2027-03-14')

      /* Anda com o relogio: o defeito antigo era exatamente nao andar. */
      vi.setSystemTime(new Date('2027-03-15T10:00:00-03:00'))
      expect(hoje()).toBe('2027-03-15')
    } finally {
      vi.useRealTimers()
    }
  })

  it('mesDeHoje e o mes corrente', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2027-03-14T10:00:00-03:00'))
      expect(mesDeHoje()).toBe('2027-03')
    } finally {
      vi.useRealTimers()
    }
  })

  /* A data de agosto de 2026 nao pode voltar por nenhum caminho. */
  it('nunca devolve a data congelada antiga', () => {
    expect(hoje()).not.toBe('2026-08-24')
    expect(mesDeHoje()).not.toBe('2026-08')
  })
})

describe('daysUntil', () => {
  it('conta os dias entre a data e a referencia', () => {
    expect(daysUntil('2026-09-10', '2026-09-08')).toBe(2)
  })

  it('devolve negativo para data passada — e o que marca vencido', () => {
    expect(daysUntil('2026-09-05', '2026-09-08')).toBe(-3)
  })

  it('devolve zero no proprio dia', () => {
    expect(daysUntil('2026-09-08', '2026-09-08')).toBe(0)
  })

  it('aceita instante ISO e usa so a parte de data', () => {
    expect(daysUntil('2026-09-10T23:00:00Z', '2026-09-08')).toBe(2)
  })

  /*
   * O defeito. Antes, `daysUntil('2026-09-05')` sem referencia dava +12 —
   * porque a referencia era 24/08 — e a conta vencida ha tres dias aparecia
   * como "vence em 12 dias".
   */
  it('sem referencia, usa HOJE', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-08T10:00:00-03:00'))
      expect(daysUntil('2026-09-05')).toBe(-3)
      expect(daysUntil('2026-09-11')).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  /* O parametro continua: teste e chamada de servidor passam a referencia
     para nao depender do relogio. So o PADRAO mudou. */
  it('a referencia explicita ainda manda', () => {
    expect(daysUntil('2026-09-05', '2026-08-24')).toBe(12)
  })

  /* Horario de verao nao existe mais no Brasil, mas a conta e por dia
     civil e nao por 24h exatas — arredondar protege de um fuso que mude. */
  it('atravessa mudanca de mes sem perder um dia', () => {
    expect(daysUntil('2026-10-01', '2026-09-30')).toBe(1)
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1)
  })
})

describe('describeDueDate', () => {
  it.each([
    ['2026-09-08', 'Vence hoje'],
    ['2026-09-09', 'Vence amanhã'],
    ['2026-09-11', 'Vence em 3 dias'],
    ['2026-09-07', '1 dia em atraso'],
    ['2026-09-03', '5 dias em atraso'],
  ])('%s -> %s', (data, esperado) => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-08T10:00:00-03:00'))
      expect(describeDueDate(data)).toBe(esperado)
    } finally {
      vi.useRealTimers()
    }
  })

  /*
   * A consequencia que importava: com a referencia congelada, esta conta —
   * vencida ha tres dias — era anunciada como "Vence em 12 dias". O lojista
   * nao pagava, e nao tinha como saber que devia.
   */
  it('conta vencida e anunciada como vencida, e nao como futura', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-08T10:00:00-03:00'))
      expect(describeDueDate('2026-09-05')).toContain('atraso')
      expect(describeDueDate('2026-09-05')).not.toContain('Vence em')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('formatCentavos', () => {
  /* Intl separa o simbolo com espaco nao quebravel. */
  const limpo = (t: string) => t.replace(/\s/g, ' ')

  it('le centavos, nao reais', () => {
    expect(limpo(formatCentavos(97770))).toBe('R$ 977,70')
  })

  it('formata milhar e zero', () => {
    expect(limpo(formatCentavos(123456789))).toBe('R$ 1.234.567,89')
    expect(limpo(formatCentavos(0))).toBe('R$ 0,00')
  })

  it('mantem o sinal do estorno', () => {
    expect(limpo(formatCentavos(-1500))).toBe('-R$ 15,00')
  })
})
