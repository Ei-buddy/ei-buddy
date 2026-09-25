import type { Role } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import { recordWhatsappConsent, type WhatsappConsentWriter } from './whatsapp-consent.js'
import { InMemoryCustomerRepository } from './fakes.js'

/** Consentimento de WhatsApp — RF-016. */

const AGORA = new Date('2026-09-24T13:00:00.000Z')

function contexto(sobrescreve: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: 'emp-1',
    userId: 'usr-1',
    role: 'owner' as Role,
    channel: 'app',
    requestId: 'req-1',
    now: AGORA,
    ...sobrescreve,
  }
}

/** Falso com a MESMA regra do SQL: uma decisao limpa a outra. */
function falso(existe = true): WhatsappConsentWriter {
  let optedInAt: Date | null = null
  let optedOutAt: Date | null = null

  return {
    async of() {
      return { optedInAt, optedOutAt }
    },
    async record(_c, _id, decisao, quando) {
      if (!existe) return false
      optedInAt = decisao === 'opt_in' ? quando : null
      optedOutAt = decisao === 'opt_out' ? quando : null
      return true
    },
  }
}

const deps = (consents: WhatsappConsentWriter) => ({
  consents,
  customers: new InMemoryCustomerRepository(),
})

describe('registrar consentimento — RF-016', () => {
  it('opt-in grava a data e deixa a recusa nula', async () => {
    const r = await recordWhatsappConsent(deps(falso()), contexto(), 'cli-1', 'opt_in')

    expect(r.optedInAt).toEqual(AGORA)
    expect(r.optedOutAt).toBeNull()
  })

  /*
   * As duas colunas descrevem a MESMA decisao em dois sentidos. Deixar as duas
   * preenchidas criaria um estado que ninguem sabe ler — e o envio consulta as
   * duas.
   */
  it('opt-out depois do opt-in limpa o aceite', async () => {
    const consents = falso()
    await recordWhatsappConsent(deps(consents), contexto(), 'cli-1', 'opt_in')

    const r = await recordWhatsappConsent(deps(consents), contexto(), 'cli-1', 'opt_out')

    expect(r.optedInAt).toBeNull()
    expect(r.optedOutAt).toEqual(AGORA)
  })

  it('cliente inexistente ou de outra loja responde NOT_FOUND', async () => {
    const erro = await recordWhatsappConsent(
      deps(falso(false)),
      contexto(),
      'cli-999',
      'opt_in',
    ).catch((e: unknown) => e)

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })
})
