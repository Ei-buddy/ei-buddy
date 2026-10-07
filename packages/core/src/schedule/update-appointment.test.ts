import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ExecutionContext } from '../context.js'
import { cancelAppointment } from './cancel-appointment.js'
import { createAppointment } from './create-appointment.js'
import { InMemoryAppointmentRepository, InMemoryReminderScheduler } from './fakes.js'
import { updateAppointment } from './update-appointment.js'

/** Editar ou remarcar compromisso — NR-152. */

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

async function comCompromisso() {
  const d = {
    appointments: new InMemoryAppointmentRepository(),
    reminders: new InMemoryReminderScheduler(),
    audit: new InMemoryAuditTrail(),
  }
  const apt = await createAppointment(d, contexto(), {
    title: 'Entrega Padaria Sol',
    startsAt: '2026-09-03T14:00:00.000Z',
    location: 'Rua A, 10',
    reminderMinutesBefore: 60,
  })
  return { d, id: apt.id }
}

describe('editar compromisso — NR-152', () => {
  it('remarca e o lembrete vai junto para o horario novo', async () => {
    const { d, id } = await comCompromisso()

    const r = await updateAppointment(d, contexto(), id, {
      title: 'Entrega Padaria Sol',
      startsAt: '2026-09-04T10:00:00.000Z',
      reminderMinutesBefore: 30,
    })

    expect(r.startsAt).toBe('2026-09-04T10:00:00.000Z')
    expect(d.reminders.agendados.get(id)?.fireAt.toISOString()).toBe('2026-09-04T09:30:00.000Z')
  })

  it('o formulario vem inteiro: campo que nao veio fica vazio', async () => {
    const { d, id } = await comCompromisso()

    const r = await updateAppointment(d, contexto(), id, {
      title: 'Entrega',
      startsAt: '2026-09-03T14:00:00.000Z',
    })

    expect(r.location).toBeNull()
    expect(r.reminderMinutesBefore).toBeNull()
    expect(d.reminders.agendados.has(id)).toBe(false)
  })

  it('registra antes e depois na trilha', async () => {
    const { d, id } = await comCompromisso()

    await updateAppointment(d, contexto(), id, {
      title: 'Entrega remarcada',
      startsAt: '2026-09-05T14:00:00.000Z',
    })

    const ultimo = d.audit.daEmpresa('empresa-1').at(-1)
    expect(ultimo?.action).toBe('updated')
    expect(ultimo?.before).toMatchObject({ title: 'Entrega Padaria Sol' })
    expect(ultimo?.after).toMatchObject({ title: 'Entrega remarcada' })
  })

  it('cancelado nao se edita', async () => {
    const { d, id } = await comCompromisso()
    await cancelAppointment(d, contexto(), { appointmentId: id })

    const erro = await updateAppointment(d, contexto(), id, {
      title: 'X',
      startsAt: '2026-09-05T14:00:00.000Z',
    }).catch((e) => e)

    expect(isAppError(erro) && erro.code).toBe('CONFLICT')
  })

  it('lembrete no passado e recusado', async () => {
    const { d, id } = await comCompromisso()

    const erro = await updateAppointment(d, contexto(), id, {
      title: 'Entrega',
      startsAt: '2026-09-02T12:30:00.000Z',
      reminderMinutesBefore: 60,
    }).catch((e) => e)

    expect(isAppError(erro) && erro.code).toBe('VALIDATION_FAILED')
  })

  it('de outra empresa responde NOT_FOUND', async () => {
    const { d, id } = await comCompromisso()

    const erro = await updateAppointment(d, contexto({ companyId: 'empresa-2' }), id, {
      title: 'X',
      startsAt: '2026-09-05T14:00:00.000Z',
    }).catch((e) => e)

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })
})
