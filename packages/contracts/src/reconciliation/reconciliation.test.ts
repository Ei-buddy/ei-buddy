import { describe, expect, it } from 'vitest'
import {
  confirmReconciliationsInputSchema,
  bankTransactionDirectionSchema,
  bankTransactionOutputSchema,
  createEntryFromTransactionInputSchema,
  reconcileInputSchema,
  suggestMatchesInputSchema,
  undoReconciliationInputSchema,
} from './reconciliation.js'

describe('direcao da transacao — RF-078', () => {
  it.each(['debit', 'credit'])('aceita "%s"', (d) => {
    expect(bankTransactionDirectionSchema.parse(d)).toBe(d)
  })

  /* Sinal no valor foi rejeitado de proposito: cada banco traz a convencao
     dele no OFX, e converter na importacao apagaria qual delas veio. */
  it.each(['saida', 'entrada', 'DEBIT', ''])('recusa "%s"', (d) => {
    expect(bankTransactionDirectionSchema.safeParse(d).success).toBe(false)
  })
})

describe('transacao do extrato', () => {
  const valida = {
    id: 'btx-1',
    externalId: 'FITID-9931',
    direction: 'debit' as const,
    amountCents: 48_000,
    postedOn: '2026-09-10',
    description: 'PAGTO ELETRON COPEL',
    counterparty: null,
    reconciledEntryKind: null,
    reconciledEntryId: null,
    settlementId: null,
  }

  it('aceita a transacao na fila', () => {
    expect(bankTransactionOutputSchema.parse(valida).amountCents).toBe(48_000)
  })

  it('aceita a transacao ja conciliada', () => {
    const conciliada = bankTransactionOutputSchema.parse({
      ...valida,
      reconciledEntryKind: 'payable',
      reconciledEntryId: 'ent-7',
    })
    expect(conciliada.reconciledEntryId).toBe('ent-7')
  })

  /* Quem diz o sinal e `direction`. Valor negativo aqui significaria que
     alguem inverteu a convencao no meio do caminho. */
  it('recusa valor negativo', () => {
    expect(bankTransactionOutputSchema.safeParse({ ...valida, amountCents: -100 }).success).toBe(
      false,
    )
  })

  it('recusa valor com centavo fracionado', () => {
    expect(bankTransactionOutputSchema.safeParse({ ...valida, amountCents: 480.5 }).success).toBe(
      false,
    )
  })

  it.each(['10/09/2026', '2026-9-10', '2026-09-10T00:00:00Z'])(
    'recusa data lancada como "%s"',
    (postedOn) => {
      expect(bankTransactionOutputSchema.safeParse({ ...valida, postedOn }).success).toBe(false)
    },
  )

  it('aceita contraparte quando o banco informa', () => {
    expect(
      bankTransactionOutputSchema.parse({ ...valida, counterparty: 'COPEL DISTRIBUICAO' })
        .counterparty,
    ).toBe('COPEL DISTRIBUICAO')
  })
})

describe('conciliar — RF-079', () => {
  const valida = { transactionId: 'btx-1', entryKind: 'payable' as const, entryId: 'ent-1' }

  it('aceita o pedido minimo', () => {
    expect(reconcileInputSchema.parse(valida).entryKind).toBe('payable')
  })

  it.each([
    ['transactionId', { ...valida, transactionId: '' }],
    ['entryId', { ...valida, entryId: '' }],
  ])('exige %s', (_campo, entrada) => {
    expect(reconcileInputSchema.safeParse(entrada).success).toBe(false)
  })

  it('recusa tipo de lancamento que nao existe', () => {
    expect(reconcileInputSchema.safeParse({ ...valida, entryKind: 'venda' }).success).toBe(false)
  })

  it('recusa campo desconhecido — o schema e strict', () => {
    expect(reconcileInputSchema.safeParse({ ...valida, force: true }).success).toBe(false)
  })

  it('a sugestao pede so a transacao', () => {
    expect(suggestMatchesInputSchema.parse({ transactionId: 'btx-1' }).transactionId).toBe('btx-1')
  })
})

describe('criar lancamento a partir da transacao — RF-079', () => {
  const valida = {
    transactionId: 'btx-1',
    counterparty: 'Banco Cooperativo',
    description: 'Tarifa de manutencao de conta',
  }

  it('aceita o minimo', () => {
    expect(createEntryFromTransactionInputSchema.parse(valida).counterparty).toBe(
      'Banco Cooperativo',
    )
  })

  it('aceita classificacao ja na criacao', () => {
    expect(
      createEntryFromTransactionInputSchema.parse({ ...valida, accountId: 'acc-3' }).accountId,
    ).toBe('acc-3')
  })

  it('apara os textos', () => {
    const p = createEntryFromTransactionInputSchema.parse({
      ...valida,
      counterparty: '  Banco  ',
      description: '  Tarifa  ',
    })
    expect([p.counterparty, p.description]).toEqual(['Banco', 'Tarifa'])
  })

  /*
   * Valor e data NAO entram: sao o extrato. Aceitar aqui abriria a chance de
   * criar um lancamento que nao corresponde a linha sendo conciliada — e o
   * `strict` e o que garante que a tela nao possa mandar.
   */
  it.each(['amountCents', 'dueDate', 'postedOn'])('recusa %s no corpo', (campo) => {
    expect(
      createEntryFromTransactionInputSchema.safeParse({ ...valida, [campo]: 100 }).success,
    ).toBe(false)
  })

  it('exige contraparte com algum conteudo', () => {
    expect(
      createEntryFromTransactionInputSchema.safeParse({ ...valida, counterparty: 'x' }).success,
    ).toBe(false)
  })

  it('exige descricao', () => {
    const { description: _fora, ...sem } = valida
    expect(createEntryFromTransactionInputSchema.safeParse(sem).success).toBe(false)
  })
})

describe('desfazer — RF-080', () => {
  const valida = { transactionId: 'btx-1', reason: 'casei com a conta errada' }

  it('aceita com motivo', () => {
    expect(undoReconciliationInputSchema.parse(valida).reason).toBe('casei com a conta errada')
  })

  /*
   * Motivo obrigatorio: sem ele a auditoria registraria que alguem desfez e
   * nao por que, que e a unica pergunta que se faz depois.
   */
  it('recusa sem motivo', () => {
    const { reason: _fora, ...sem } = valida
    expect(undoReconciliationInputSchema.safeParse(sem).success).toBe(false)
  })

  it.each(['', ' ', 'ok'])('recusa motivo vazio ou curto: "%s"', (reason) => {
    expect(undoReconciliationInputSchema.safeParse({ ...valida, reason }).success).toBe(false)
  })

  it('recusa campo desconhecido', () => {
    expect(undoReconciliationInputSchema.safeParse({ ...valida, silent: true }).success).toBe(false)
  })
})

describe('conciliar da baixa — DEC-026', () => {
  const par = { transactionId: 'btx-1', entryKind: 'payable' as const, entryId: 'ent-1' }

  it('confirmar exige a conta do extrato e pelo menos um par', () => {
    expect(confirmReconciliationsInputSchema.safeParse({ pairs: [par] }).success).toBe(false)
    expect(
      confirmReconciliationsInputSchema.safeParse({ bankAccount: 'Nubank', pairs: [] }).success,
    ).toBe(false)
    expect(
      confirmReconciliationsInputSchema.parse({ bankAccount: ' Nubank ', pairs: [par] })
        .bankAccount,
    ).toBe('Nubank')
  })

  it('a mesma linha ou o mesmo lancamento em dois pares e recusado', () => {
    const mesmaLinha = confirmReconciliationsInputSchema.safeParse({
      bankAccount: 'X',
      pairs: [par, { ...par, entryId: 'ent-2' }],
    })
    expect(mesmaLinha.error?.issues[0]?.message).toBe(
      'A mesma linha do extrato aparece em dois pares.',
    )
    const mesmoLancamento = confirmReconciliationsInputSchema.safeParse({
      bankAccount: 'X',
      pairs: [par, { ...par, transactionId: 'btx-2' }],
    })
    expect(mesmoLancamento.error?.issues[0]?.message).toBe(
      'O mesmo lançamento aparece em dois pares.',
    )
  })

  it('conciliar um par aceita a conta (com ela, da baixa); sem ela, segue valendo', () => {
    expect(reconcileInputSchema.parse({ ...par, bankAccount: 'Nubank' }).bankAccount).toBe('Nubank')
    expect(reconcileInputSchema.parse(par).bankAccount).toBeUndefined()
  })
})
