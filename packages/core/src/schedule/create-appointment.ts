import type { AppointmentOutput, CreateAppointmentInput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { AppointmentRepository } from '../ports/appointment-repository.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { ReminderScheduler } from '../ports/reminder-scheduler.js'

export type CreateAppointmentDeps = {
  readonly appointments: AppointmentRepository
  readonly reminders: ReminderScheduler
  /** Trilha — RF-123. Opcional para os testes de regra; a composicao entrega. */
  readonly audit?: AuditTrail
}

/**
 * Cria compromisso e agenda o lembrete — RF-089, RF-090, RF-091.
 *
 * O lembrete e agendado DEPOIS de salvar e fora da transacao: se a fila
 * estiver fora do ar, o compromisso ainda precisa existir. Perder o lembrete
 * incomoda; perder o compromisso e o que a agenda deveria impedir.
 */
export async function createAppointment(
  deps: CreateAppointmentDeps,
  ctx: ExecutionContext,
  input: CreateAppointmentInput,
): Promise<AppointmentOutput> {
  assertCanWrite(ctx)

  const startsAt = new Date(input.startsAt)

  /*
   * Compromisso no passado nao e recusado: o lojista anota depois do que ja
   * aconteceu, e "visita do fornecedor ontem" e registro legitimo. O que nao
   * faz sentido e LEMBRAR de algo que ja passou.
   */
  if (input.reminderMinutesBefore !== undefined) {
    const fireAt = reminderFireAt(startsAt, input.reminderMinutesBefore)
    if (fireAt.getTime() <= ctx.now.getTime()) {
      throw AppError.validation(
        'O lembrete cairia no passado. Escolha uma antecedencia menor ou outro horario.',
        [{ path: 'reminderMinutesBefore', message: 'Antecedencia maior que o tempo restante.' }],
      )
    }
  }

  const appointment = await deps.appointments.save({
    companyId: ctx.companyId,
    title: input.title,
    startsAt,
    ...(input.endsAt === undefined ? {} : { endsAt: new Date(input.endsAt) }),
    location: input.location,
    customerId: input.customerId,
    notes: input.notes,
    reminderMinutesBefore: input.reminderMinutesBefore,
    createdBy: ctx.userId,
    createdAt: ctx.now,
  })

  if (input.reminderMinutesBefore !== undefined) {
    await deps.reminders.schedule({
      companyId: ctx.companyId,
      appointmentId: appointment.id,
      fireAt: reminderFireAt(startsAt, input.reminderMinutesBefore),
    })
  }

  await deps.audit?.record({
    companyId: ctx.companyId,
    entity: 'Appointment',
    entityId: appointment.id,
    action: 'created',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: null,
    after: { title: appointment.title, startsAt: appointment.startsAt },
  })

  return appointment
}

/** Quando o lembrete dispara: o horario menos a antecedencia. */
export function reminderFireAt(startsAt: Date, minutesBefore: number): Date {
  return new Date(startsAt.getTime() - minutesBefore * 60_000)
}
