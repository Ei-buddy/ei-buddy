import type { AppointmentOutput, UpdateAppointmentInput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { AppointmentRepository } from '../ports/appointment-repository.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { ReminderScheduler } from '../ports/reminder-scheduler.js'
import { reminderFireAt } from './create-appointment.js'

export type UpdateAppointmentDeps = {
  readonly appointments: AppointmentRepository
  readonly reminders: ReminderScheduler
  readonly audit?: AuditTrail
}

/**
 * Editar ou remarcar um compromisso — NR-152.
 *
 * O formulario vem inteiro, como no cadastro. Cancelado nao se edita: o
 * caminho e marcar de novo, e o cancelamento continua na trilha com o motivo.
 *
 * O lembrete e refeito do zero: o antigo e cancelado e, se ainda houver
 * antecedencia, um novo e agendado para o horario novo. Remarcar sem isso
 * deixaria o lembrete tocando na hora velha.
 */
export async function updateAppointment(
  deps: UpdateAppointmentDeps,
  ctx: ExecutionContext,
  id: string,
  input: UpdateAppointmentInput,
): Promise<AppointmentOutput> {
  assertCanWrite(ctx)

  const antes = await deps.appointments.findById(ctx.companyId, id)
  if (antes === undefined) throw AppError.notFound('Compromisso não encontrado.')
  if (antes.status === 'cancelled') {
    throw AppError.conflict('Compromisso cancelado não se edita. Marque um novo.')
  }

  const startsAt = new Date(input.startsAt)

  /* Mesma regra do cadastro: lembrete no passado nao toca, e dizer "ok" seria
     mentir. */
  if (input.reminderMinutesBefore !== undefined) {
    const fireAt = reminderFireAt(startsAt, input.reminderMinutesBefore)
    if (fireAt.getTime() <= ctx.now.getTime()) {
      throw AppError.validation(
        'O lembrete cairia no passado. Escolha uma antecedência menor ou outro horário.',
        [{ path: 'reminderMinutesBefore', message: 'Antecedencia maior que o tempo restante.' }],
      )
    }
  }

  const depois = await deps.appointments.update(ctx.companyId, id, {
    title: input.title,
    startsAt,
    ...(input.endsAt === undefined ? {} : { endsAt: new Date(input.endsAt) }),
    location: input.location,
    customerId: input.customerId,
    notes: input.notes,
    reminderMinutesBefore: input.reminderMinutesBefore,
  })

  await deps.reminders.cancel(ctx.companyId, id)
  if (input.reminderMinutesBefore !== undefined) {
    await deps.reminders.schedule({
      companyId: ctx.companyId,
      appointmentId: id,
      fireAt: reminderFireAt(startsAt, input.reminderMinutesBefore),
    })
  }

  await deps.audit?.record({
    companyId: ctx.companyId,
    entity: 'Appointment',
    entityId: id,
    action: 'updated',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: { title: antes.title, startsAt: antes.startsAt },
    after: { title: depois.title, startsAt: depois.startsAt },
  })

  return depois
}
