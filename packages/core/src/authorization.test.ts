import { describe, expect, it } from 'vitest'
import { isAppError } from './app-error.js'
import {
  assertCanWrite,
  assertPapelPodeEscrever,
  MENSAGEM_ASSINATURA_RESTRITA,
} from './authorization.js'
import type { ExecutionContext } from './context.js'

/** Quem escreve — papel e assinatura (RF-117). */

const ctx = (over: Partial<ExecutionContext> = {}): ExecutionContext => ({
  companyId: 'c1',
  userId: 'u1',
  role: 'owner',
  channel: 'app',
  requestId: 'r1',
  now: new Date('2026-11-16T12:00:00.000Z'),
  ...over,
})

const erroDe = (fn: () => void) => {
  try {
    fn()
    return undefined
  } catch (e) {
    return e
  }
}

describe('assinatura restrita so le — RF-117', () => {
  it('teste, ativa e atrasada escrevem; sem assinatura (ou nao lida) tambem', () => {
    for (const s of ['trial', 'active', 'overdue', null] as const) {
      expect(
        erroDe(() => assertCanWrite(ctx({ subscriptionStatus: s }))),
        String(s),
      ).toBeUndefined()
    }
    expect(erroDe(() => assertCanWrite(ctx()))).toBeUndefined()
  })

  it('restrita e cancelada nao lancam nada novo, com a mensagem de onde regularizar', () => {
    for (const s of ['restricted', 'cancelled'] as const) {
      const e = erroDe(() => assertCanWrite(ctx({ subscriptionStatus: s })))
      expect(isAppError(e) && e.code, s).toBe('FORBIDDEN')
      expect(isAppError(e) && e.message).toBe(MENSAGEM_ASSINATURA_RESTRITA)
    }
  })

  it('o que a restrita ainda faz (suporte, LGPD) so confere o papel', () => {
    expect(
      erroDe(() => assertPapelPodeEscrever(ctx({ subscriptionStatus: 'restricted' }))),
    ).toBeUndefined()
    const contador = erroDe(() => assertPapelPodeEscrever(ctx({ role: 'accountant' })))
    expect(isAppError(contador) && contador.code).toBe('FORBIDDEN')
  })

  it('contador continua so lendo, com a mensagem do papel', () => {
    const e = erroDe(() =>
      assertCanWrite(ctx({ role: 'accountant', subscriptionStatus: 'active' })),
    )
    expect(isAppError(e) && e.message).toBe('Seu perfil tem acesso somente de leitura.')
  })
})
