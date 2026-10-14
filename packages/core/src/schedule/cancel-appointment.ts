import type { AppointmentOutput, CancelAppointmentInput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { AppointmentRepository } from '../ports/appointment-repository.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { ReminderScheduler } from '../ports/reminder-scheduler.js'

export type CancelAppointmentDeps = {
  readonly appointments: AppointmentRepository
  readonly reminders: ReminderScheduler
  /** Trilha — RF-123. Opcional para os testes de regra; a composicao entrega. */
  readonly audit?: AuditTrail
}

/**
 * Cancela o compromisso e o lembrete dele — RF-092.
 *
 * Cancela, nao apaga (RNF-040): o historico de que havia um compromisso e o
 * que permite entender depois por que a entrega nao aconteceu.
 */
export async function cancelAppointment(
  deps: CancelAppointmentDeps,
  ctx: ExecutionContext,
  input: CancelAppointmentInput,
): Promise<AppointmentOutput> {
  assertCanWrite(ctx)

  const existente = await deps.appointments.findById(ctx.companyId, input.appointmentId)

  /*
   * Compromisso de outra empresa cai aqui como inexistente, e responde 404 —
   * nunca 403. Um 403 confirmaria que o id existe em algum lugar, o que ja e
   * informacao demais. Ver apps/api/README.md#seguranca
   */
  if (!existente) {
    throw AppError.notFound('Compromisso não encontrado.')
  }

  if (existente.status === 'cancelled') {
    throw AppError.conflict('Este compromisso já foi cancelado.')
  }

  const cancelado = await deps.appointments.cancel(
    ctx.companyId,
    input.appointmentId,
    ctx.userId,
    ctx.now,
    input.reason,
  )

  /*
   * O lembrete cai junto. Cancelar compromisso e continuar avisando sobre ele
   * e pior que nao ter lembrete — a pessoa perde a confianca no aviso.
   */
  await deps.reminders.cancel(ctx.companyId, input.appointmentId)

  /* O motivo entra na trilha: e ele que responde "por que sumiu da agenda". */
  await deps.audit?.record({
    companyId: ctx.companyId,
    entity: 'Appointment',
    entityId: input.appointmentId,
    action: 'cancelled',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: { status: existente.status },
    after: { status: 'cancelled', reason: input.reason ?? null },
  })

  return cancelado
}
