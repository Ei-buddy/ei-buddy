import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ExecutionContext } from '../context.js'
import { mexeNoSaldoDoCliente, nasceComoDividaDoCliente } from './customer-balance.js'
import { InMemorySettlements } from './fakes.js'
import { reverseSettlement } from './reverse-settlement.js'
import { settlePayable, settleReceivable } from './settle.js'

const AGORA = new Date('2026-09-02T12:00:00.000Z')

function contexto(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: 'empresa-1',
    userId: 'usuario-1',
    role: 'owner',
    channel: 'app',
    requestId: 'req-1',
    now: AGORA,
    ...over,
  }
}

function cenario() {
  /* A MESMA trilha entra na unidade de trabalho: desde a NR-087 a auditoria
     das baixas acontece DENTRO da transacao, entao ela precisa ser a instancia
     que o teste inspeciona. Duas instancias e o teste procurando na vazia. */
  const audit = new InMemoryAuditTrail()
  const uow = new InMemorySettlements(audit)
  uow.adicionarTitulo('empresa-1', 'payable', {
    id: 'pay-1',
    amountCents: 10_000,
    settledAmountCents: 0,
    status: 'open',
    customerId: null,
  })
  uow.adicionarTitulo('empresa-1', 'receivable', {
    id: 'rec-fiado',
    amountCents: 10_000,
    settledAmountCents: 0,
    status: 'open',
    customerId: 'cliente-1',
    isCustomerDebt: true,
  })
  uow.adicionarTitulo('empresa-1', 'receivable', {
    id: 'rec-cartao',
    amountCents: 10_000,
    settledAmountCents: 0,
    status: 'open',
    customerId: 'cliente-1',
    isCustomerDebt: false,
  })
  uow.definirSaldo('cliente-1', 10_000)
  return { deps: { uow, audit }, uow, audit }
}

const baixaPagar = { payableId: 'pay-1', settledOn: '2026-09-02', bankAccount: 'Itau 1234' }
const baixaReceber = { receivableId: 'rec-fiado', method: 'pix' as const, settledOn: '2026-09-02' }

describe('baixa em conta a pagar — RF-059', () => {
  it('baixa total quita a conta', async () => {
    const c = cenario()

    await settlePayable(c.deps, contexto(), { ...baixaPagar, amountCents: 10_000 })

    expect(c.uow.tituloDe('pay-1')?.status).toBe('settled')
  })

  it('baixa parcial deixa o restante em aberto', async () => {
    const c = cenario()

    await settlePayable(c.deps, contexto(), { ...baixaPagar, amountCents: 4_000 })

    const t = c.uow.tituloDe('pay-1')
    expect(t?.status).toBe('partially_settled')
    expect(t?.settledAmountCents).toBe(4_000)
  })

  it('guarda a conta bancaria — sem ela nao da para conciliar', async () => {
    const c = cenario()

    const b = await settlePayable(c.deps, contexto(), { ...baixaPagar, amountCents: 4_000 })

    expect(b.bankAccount).toBe('Itau 1234')
    expect(b.settledOn).toBe('2026-09-02')
  })

  it('recusa pagar mais do que se deve', async () => {
    const c = cenario()

    await expect(
      settlePayable(c.deps, contexto(), { ...baixaPagar, amountCents: 10_001 }),
    ).rejects.toThrow()
  })

  it('conta de outra empresa responde NOT_FOUND', async () => {
    const c = cenario()

    try {
      await settlePayable(c.deps, contexto({ companyId: 'empresa-2' }), {
        ...baixaPagar,
        amountCents: 1_000,
      })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
    }
  })

  it('conta cancelada nao recebe baixa', async () => {
    const c = cenario()
    c.uow.adicionarTitulo('empresa-1', 'payable', {
      id: 'pay-cancelada',
      amountCents: 5_000,
      settledAmountCents: 0,
      status: 'cancelled',
      customerId: null,
    })

    try {
      await settlePayable(c.deps, contexto(), {
        payableId: 'pay-cancelada',
        amountCents: 1_000,
        settledOn: '2026-09-02',
        bankAccount: 'Itau 1234',
      })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('CONFLICT')
    }
  })

  /* Conta a pagar nao mexe em saldo de cliente: quem recebe e o fornecedor. */
  it('nao encosta no saldo de cliente nenhum', async () => {
    const c = cenario()

    await settlePayable(c.deps, contexto(), { ...baixaPagar, amountCents: 10_000 })

    expect(c.uow.saldoDe('cliente-1')).toBe(10_000)
  })
})

describe('baixa em recebivel — RF-066', () => {
  it('o saldo do cliente diminui — US-032', async () => {
    const c = cenario()

    await settleReceivable(c.deps, contexto(), { ...baixaReceber, amountCents: 4_000 })

    expect(c.uow.saldoDe('cliente-1')).toBe(6_000)
  })

  it('o recebimento parcial deixa o restante em aberto', async () => {
    const c = cenario()

    await settleReceivable(c.deps, contexto(), { ...baixaReceber, amountCents: 4_000 })

    expect(c.uow.tituloDe('rec-fiado')?.status).toBe('partially_settled')
  })

  /**
   * O ponto mais facil de errar. Quem deve a loja numa venda no credito e a
   * ADQUIRENTE — o cliente ja pagou. Diminuir o saldo dele aqui daria um
   * credito que ninguem concedeu.
   */
  it('recebivel de cartao NAO mexe no saldo do cliente', async () => {
    const c = cenario()

    await settleReceivable(c.deps, contexto(), {
      receivableId: 'rec-cartao',
      amountCents: 10_000,
      method: 'pix',
      settledOn: '2026-09-02',
    })

    expect(c.uow.saldoDe('cliente-1')).toBe(10_000)
  })

  it('recebivel sem cliente nao mexe em saldo nenhum', async () => {
    const c = cenario()
    c.uow.adicionarTitulo('empresa-1', 'receivable', {
      id: 'rec-avulso',
      amountCents: 3_000,
      settledAmountCents: 0,
      status: 'open',
      customerId: null,
    })

    await settleReceivable(c.deps, contexto(), {
      receivableId: 'rec-avulso',
      amountCents: 3_000,
      method: 'cash',
      settledOn: '2026-09-02',
    })

    expect(c.uow.saldoDe('cliente-1')).toBe(10_000)
  })
})

describe('quem mexe no saldo do cliente', () => {
  const base = { id: 'x', amountCents: 1, settledAmountCents: 0, status: 'open' }

  it.each([
    [true, 'cliente-1', true],
    [false, 'cliente-1', false],
    [true, null, false],
  ] as const)(
    'divida do cliente %s com cliente %s → %s',
    (isCustomerDebt, customerId, esperado) => {
      expect(mexeNoSaldoDoCliente({ ...base, customerId, isCustomerDebt })).toBe(esperado)
    },
  )

  /*
   * A decisao saiu da baixa e foi para o NASCIMENTO do titulo, entao e la que
   * as formas de pagamento importam. Antes tudo isto vivia em
   * `mexeNoSaldoDoCliente`, deduzido de um `paymentMethod` que o repositorio
   * adivinhava com `MIN(p.method)` — e numa venda mista adivinhava errado.
   */
  it.each([
    ['wallet', 'cliente-1', true],
    [null, 'cliente-1', true],
    ['cash', 'cliente-1', false],
    ['credit', 'cliente-1', false],
    ['debit', 'cliente-1', false],
    ['wallet', null, false],
  ] as const)('nasce como divida: %s com cliente %s → %s', (forma, customerId, esperado) => {
    expect(nasceComoDividaDoCliente(customerId, forma)).toBe(esperado)
  })
})

describe('estorno — RF-060, RF-067', () => {
  const motivo = { reason: 'Baixa lancada por engano' }

  it('devolve o titulo ao estado anterior', async () => {
    const c = cenario()
    const b = await settlePayable(c.deps, contexto(), { ...baixaPagar, amountCents: 10_000 })

    await reverseSettlement(c.deps, contexto(), { settlementId: b.id, ...motivo })

    const t = c.uow.tituloDe('pay-1')
    expect(t?.settledAmountCents).toBe(0)
    expect(t?.status).toBe('open')
  })

  /* A baixa nao e apagada: a soma das linhas continua sendo o saldo baixado. */
  it('grava uma linha negativa em vez de apagar a baixa', async () => {
    const c = cenario()
    const b = await settlePayable(c.deps, contexto(), { ...baixaPagar, amountCents: 10_000 })

    const estorno = await reverseSettlement(c.deps, contexto(), { settlementId: b.id, ...motivo })

    expect(estorno.amountCents).toBe(-10_000)
    expect(estorno.reversesId).toBe(b.id)
    expect(c.uow.totalDeBaixas).toBe(2)
  })

  it('restaura o saldo do cliente — US-032', async () => {
    const c = cenario()
    const b = await settleReceivable(c.deps, contexto(), { ...baixaReceber, amountCents: 4_000 })
    expect(c.uow.saldoDe('cliente-1')).toBe(6_000)

    await reverseSettlement(c.deps, contexto(), { settlementId: b.id, ...motivo })

    expect(c.uow.saldoDe('cliente-1')).toBe(10_000)
  })

  it('estorno de baixa de cartao tambem nao mexe no saldo', async () => {
    const c = cenario()
    const b = await settleReceivable(c.deps, contexto(), {
      receivableId: 'rec-cartao',
      amountCents: 10_000,
      method: 'pix',
      settledOn: '2026-09-02',
    })

    await reverseSettlement(c.deps, contexto(), { settlementId: b.id, ...motivo })

    expect(c.uow.saldoDe('cliente-1')).toBe(10_000)
  })

  it('estorna uma entre varias baixas, preservando as demais', async () => {
    const c = cenario()
    await settlePayable(c.deps, contexto(), { ...baixaPagar, amountCents: 4_000 })
    const segunda = await settlePayable(c.deps, contexto(), { ...baixaPagar, amountCents: 3_000 })

    await reverseSettlement(c.deps, contexto(), { settlementId: segunda.id, ...motivo })

    expect(c.uow.tituloDe('pay-1')?.settledAmountCents).toBe(4_000)
  })

  /* Sem esta guarda, duas chamadas seguidas devolveriam a divida duas vezes e o
     titulo terminaria com saldo baixado negativo. */
  it('recusa estornar a mesma baixa duas vezes', async () => {
    const c = cenario()
    const b = await settlePayable(c.deps, contexto(), { ...baixaPagar, amountCents: 4_000 })
    await reverseSettlement(c.deps, contexto(), { settlementId: b.id, ...motivo })

    try {
      await reverseSettlement(c.deps, contexto(), { settlementId: b.id, ...motivo })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('CONFLICT')
    }
  })

  it('recusa estornar um estorno', async () => {
    const c = cenario()
    const b = await settlePayable(c.deps, contexto(), { ...baixaPagar, amountCents: 4_000 })
    const estorno = await reverseSettlement(c.deps, contexto(), { settlementId: b.id, ...motivo })

    try {
      await reverseSettlement(c.deps, contexto(), { settlementId: estorno.id, ...motivo })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('CONFLICT')
    }
  })

  it('baixa de outra empresa responde NOT_FOUND', async () => {
    const c = cenario()
    const b = await settlePayable(c.deps, contexto(), { ...baixaPagar, amountCents: 4_000 })

    try {
      await reverseSettlement(c.deps, contexto({ companyId: 'empresa-2' }), {
        settlementId: b.id,
        ...motivo,
      })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
    }
  })
})

/**
 * A baixa escreve em tres lugares. Nenhum pode sobreviver sozinho: titulo
 * quitado com saldo do cliente intocado e divida que o sistema esqueceu de
 * perdoar.
 */
describe('atomicidade', () => {
  it('falha depois da baixa nao deixa titulo alterado nem saldo mexido', async () => {
    const c = cenario()
    c.uow.falharDepoisDaBaixa = true

    await expect(
      settleReceivable(c.deps, contexto(), { ...baixaReceber, amountCents: 4_000 }),
    ).rejects.toThrow()

    expect(c.uow.tituloDe('rec-fiado')?.settledAmountCents).toBe(0)
    expect(c.uow.saldoDe('cliente-1')).toBe(10_000)
    expect(c.uow.totalDeBaixas).toBe(0)
  })
})

describe('autorizacao por papel', () => {
  it.each(['owner', 'staff'] as const)('%s da baixa', async (role) => {
    const c = cenario()

    const b = await settlePayable(c.deps, contexto({ role }), {
      ...baixaPagar,
      amountCents: 1_000,
    })

    expect(b.id).toBeTruthy()
  })

  it('accountant nao da baixa', async () => {
    const c = cenario()

    try {
      await settlePayable(c.deps, contexto({ role: 'accountant' }), {
        ...baixaPagar,
        amountCents: 1_000,
      })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
    }
  })

  it('accountant nao estorna', async () => {
    const c = cenario()
    const b = await settlePayable(c.deps, contexto(), { ...baixaPagar, amountCents: 1_000 })

    await expect(
      reverseSettlement(c.deps, contexto({ role: 'accountant' }), {
        settlementId: b.id,
        reason: 'Tentando',
      }),
    ).rejects.toThrow()
  })
})

describe('trilha de auditoria — RF-123', () => {
  it('a baixa deixa antes e depois do titulo', async () => {
    const c = cenario()

    await settlePayable(c.deps, contexto(), { ...baixaPagar, amountCents: 4_000 })

    const e = c.audit.daEmpresa('empresa-1')[0]
    expect(e?.before).toEqual({ settledAmountCents: 0, status: 'open' })
    expect(e?.after).toEqual({ settledAmountCents: 4_000, status: 'partially_settled' })
  })

  it('o estorno registra o motivo', async () => {
    const c = cenario()
    const b = await settlePayable(c.deps, contexto(), { ...baixaPagar, amountCents: 4_000 })

    await reverseSettlement(c.deps, contexto(), { settlementId: b.id, reason: 'Engano' })

    expect(c.audit.daEmpresa('empresa-1')[1]?.after).toMatchObject({ reason: 'Engano' })
  })
})
