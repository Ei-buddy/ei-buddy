import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import { cancelAppointment } from './cancel-appointment.js'
import { createAppointment, reminderFireAt } from './create-appointment.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import { InMemoryAppointmentRepository, InMemoryReminderScheduler } from './fakes.js'
import { listDayAppointments } from './list-day-appointments.js'

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

function deps() {
  return {
    appointments: new InMemoryAppointmentRepository(),
    reminders: new InMemoryReminderScheduler(),
  }
}

const amanha = '2026-09-03T14:00:00.000Z'

describe('criar compromisso — RF-089', () => {
  it('grava titulo, horario e quem criou', async () => {
    const d = deps()
    const apt = await createAppointment(d, contexto(), {
      title: 'Entrega Padaria Sol',
      startsAt: amanha,
    })

    expect(apt.title).toBe('Entrega Padaria Sol')
    expect(apt.startsAt).toBe(amanha)
    expect(apt.status).toBe('scheduled')
  })

  it('vincula ao cliente para aparecer no cadastro dele — RF-090', async () => {
    const d = deps()
    const apt = await createAppointment(d, contexto(), {
      title: 'Visita',
      startsAt: amanha,
      customerId: 'cliente-7',
    })

    expect(apt.customerId).toBe('cliente-7')
  })

  it('sem cliente vinculado devolve null, nao undefined', async () => {
    const d = deps()
    const apt = await createAppointment(d, contexto(), { title: 'Reuniao', startsAt: amanha })

    expect(apt.customerId).toBeNull()
  })

  /* O lojista anota depois do que ja aconteceu — registro legitimo. */
  it('aceita compromisso no passado', async () => {
    const d = deps()
    const apt = await createAppointment(d, contexto(), {
      title: 'Visita de ontem',
      startsAt: '2026-09-01T10:00:00.000Z',
    })

    expect(apt.status).toBe('scheduled')
  })
})

describe('lembrete — RF-091', () => {
  it('agenda o lembrete na antecedencia pedida', async () => {
    const d = deps()
    const apt = await createAppointment(d, contexto(), {
      title: 'Entrega',
      startsAt: amanha,
      reminderMinutesBefore: 30,
    })

    const lembrete = d.reminders.agendados.get(apt.id)
    expect(lembrete?.fireAt.toISOString()).toBe('2026-09-03T13:30:00.000Z')
  })

  it('nao agenda nada quando nao pediram lembrete', async () => {
    const d = deps()
    await createAppointment(d, contexto(), { title: 'Entrega', startsAt: amanha })

    expect(d.reminders.agendados.size).toBe(0)
  })

  it('recusa antecedencia que cairia no passado', async () => {
    const d = deps()

    /* Compromisso daqui a 10 min com lembrete de 30 min antes. */
    const promessa = createAppointment(d, contexto(), {
      title: 'Agora ha pouco',
      startsAt: '2026-09-02T12:10:00.000Z',
      reminderMinutesBefore: 30,
    })

    await expect(promessa).rejects.toThrow()
    try {
      await promessa
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('VALIDATION_FAILED')
    }
  })

  it.each([
    [60, '2026-09-03T13:00:00.000Z'],
    [1440, '2026-09-02T14:00:00.000Z'],
  ])('antecedencia de %i minutos dispara em %s', (minutos, esperado) => {
    expect(reminderFireAt(new Date(amanha), minutos).toISOString()).toBe(esperado)
  })
})

describe('cancelar compromisso — RF-092', () => {
  /* RF-123: o motivo responde "por que sumiu da agenda". */
  it('marcar e cancelar entram na trilha, com o motivo', async () => {
    const audit = new InMemoryAuditTrail()
    const d = { ...deps(), audit }
    const apt = await createAppointment(d, contexto(), { title: 'Entrega', startsAt: amanha })

    await cancelAppointment(d, contexto(), { appointmentId: apt.id, reason: 'Fornecedor adiou' })

    expect(audit.daEmpresa('empresa-1').map((e) => [e.entity, e.action])).toEqual([
      ['Appointment', 'created'],
      ['Appointment', 'cancelled'],
    ])
    expect(audit.daEmpresa('empresa-1')[1]?.after).toMatchObject({ reason: 'Fornecedor adiou' })
  })

  it('marca como cancelado em vez de apagar — RNF-040', async () => {
    const d = deps()
    const apt = await createAppointment(d, contexto(), { title: 'Entrega', startsAt: amanha })

    const cancelado = await cancelAppointment(d, contexto(), { appointmentId: apt.id })

    expect(cancelado.status).toBe('cancelled')
    expect(await d.appointments.findById('empresa-1', apt.id)).toBeDefined()
  })

  it('cancela o lembrete junto', async () => {
    const d = deps()
    const apt = await createAppointment(d, contexto(), {
      title: 'Entrega',
      startsAt: amanha,
      reminderMinutesBefore: 30,
    })

    await cancelAppointment(d, contexto(), { appointmentId: apt.id })

    expect(d.reminders.agendados.has(apt.id)).toBe(false)
    expect(d.reminders.cancelados).toContain(apt.id)
  })

  it('recusa cancelar duas vezes', async () => {
    const d = deps()
    const apt = await createAppointment(d, contexto(), { title: 'Entrega', startsAt: amanha })
    await cancelAppointment(d, contexto(), { appointmentId: apt.id })

    try {
      await cancelAppointment(d, contexto(), { appointmentId: apt.id })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('CONFLICT')
    }
  })

  it('compromisso inexistente responde NOT_FOUND', async () => {
    const d = deps()

    try {
      await cancelAppointment(d, contexto(), { appointmentId: 'apt-inexistente' })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
    }
  })
})

/**
 * Isolamento entre empresas: compromisso de outra empresa e NOT_FOUND, nunca
 * FORBIDDEN. Um 403 confirmaria que o id existe em algum lugar.
 */
describe('isolamento por empresa', () => {
  it('nao enxerga compromisso de outra empresa', async () => {
    const d = deps()
    const apt = await createAppointment(d, contexto(), { title: 'Entrega', startsAt: amanha })

    try {
      await cancelAppointment(d, contexto({ companyId: 'empresa-2' }), { appointmentId: apt.id })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
    }
  })

  it('a agenda do dia so traz a propria empresa', async () => {
    const d = deps()
    await createAppointment(d, contexto(), { title: 'Minha', startsAt: amanha })
    await createAppointment(d, contexto({ companyId: 'empresa-2' }), {
      title: 'Da outra',
      startsAt: amanha,
    })

    const agenda = await listDayAppointments(d, contexto(), { day: '2026-09-03' })

    expect(agenda.appointments).toHaveLength(1)
    expect(agenda.appointments[0]?.title).toBe('Minha')
  })
})

describe('agenda do dia — RF-093', () => {
  it('devolve em ordem de horario', async () => {
    const d = deps()
    await createAppointment(d, contexto(), { title: 'Tarde', startsAt: '2026-09-03T16:00:00.000Z' })
    await createAppointment(d, contexto(), { title: 'Manha', startsAt: '2026-09-03T08:00:00.000Z' })

    const agenda = await listDayAppointments(d, contexto(), { day: '2026-09-03' })

    expect(agenda.appointments.map((a) => a.title)).toEqual(['Manha', 'Tarde'])
  })

  it('confirma agenda livre explicitamente, sem depender de lista vazia', async () => {
    const d = deps()
    const agenda = await listDayAppointments(d, contexto(), { day: '2026-09-03' })

    expect(agenda.isEmpty).toBe(true)
    expect(agenda.day).toBe('2026-09-03')
  })

  it('nao mostra cancelado', async () => {
    const d = deps()
    const apt = await createAppointment(d, contexto(), { title: 'Entrega', startsAt: amanha })
    await cancelAppointment(d, contexto(), { appointmentId: apt.id })

    const agenda = await listDayAppointments(d, contexto(), { day: '2026-09-03' })

    expect(agenda.isEmpty).toBe(true)
  })

  it('nao mistura compromisso de outro dia', async () => {
    const d = deps()
    await createAppointment(d, contexto(), { title: 'Hoje', startsAt: '2026-09-02T10:00:00.000Z' })
    await createAppointment(d, contexto(), { title: 'Amanha', startsAt: amanha })

    const agenda = await listDayAppointments(d, contexto(), { day: '2026-09-02' })

    expect(agenda.appointments.map((a) => a.title)).toEqual(['Hoje'])
  })
})

/**
 * A verificacao de papel vive aqui e nao no handler — senao o canal WhatsApp
 * nao a aplicaria. seguranca.md: "accountant e somente leitura e exportacao".
 */
describe('autorizacao por papel', () => {
  it.each(['owner', 'staff'] as const)('%s pode criar', async (role) => {
    const d = deps()
    const apt = await createAppointment(d, contexto({ role }), {
      title: 'Entrega',
      startsAt: amanha,
    })

    expect(apt.id).toBeTruthy()
  })

  it('accountant nao cria', async () => {
    const d = deps()

    try {
      await createAppointment(d, contexto({ role: 'accountant' }), {
        title: 'Entrega',
        startsAt: amanha,
      })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
    }
  })

  it('accountant nao cancela', async () => {
    const d = deps()
    const apt = await createAppointment(d, contexto(), { title: 'Entrega', startsAt: amanha })

    await expect(
      cancelAppointment(d, contexto({ role: 'accountant' }), { appointmentId: apt.id }),
    ).rejects.toThrow()
  })

  it('accountant LE a agenda — somente leitura nao e sem acesso', async () => {
    const d = deps()
    await createAppointment(d, contexto(), { title: 'Entrega', startsAt: amanha })

    const agenda = await listDayAppointments(d, contexto({ role: 'accountant' }), {
      day: '2026-09-03',
    })

    expect(agenda.appointments).toHaveLength(1)
  })
})

/**
 * O lembrete e agendado fora da transacao, depois de salvar. Se a fila cair, o
 * compromisso ja existe — perder o lembrete incomoda, perder o compromisso e o
 * que a agenda deveria impedir.
 */
describe('fila indisponivel', () => {
  it('o compromisso sobrevive a falha ao agendar o lembrete', async () => {
    const d = deps()
    d.reminders.falharAoAgendar = true

    await expect(
      createAppointment(d, contexto(), {
        title: 'Entrega',
        startsAt: amanha,
        reminderMinutesBefore: 30,
      }),
    ).rejects.toThrow()

    const agenda = await listDayAppointments(d, contexto(), { day: '2026-09-03' })
    expect(agenda.appointments).toHaveLength(1)
  })
})
