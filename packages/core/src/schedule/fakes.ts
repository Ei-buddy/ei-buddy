import type { AppointmentOutput } from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'
import type { AppointmentRepository, NewAppointment } from '../ports/appointment-repository.js'
import type { ReminderScheduler } from '../ports/reminder-scheduler.js'

/**
 * Implementacoes em memoria das portas, para teste.
 *
 * O README do repo diz que o adapter falso "implementa a mesma porta, inclusive
 * os caminhos de erro" — falso que so devolve sucesso esconde exatamente o que
 * precisa ser testado. Por isso o repositorio aqui aplica o filtro por empresa
 * de verdade: sem isso, um caso de uso que esquecesse o `companyId` passaria
 * no teste e vazaria dado em producao.
 */

export class InMemoryAppointmentRepository implements AppointmentRepository {
  private readonly registros = new Map<string, AppointmentOutput & { companyId: CompanyId }>()
  private sequencia = 0

  async save(appointment: NewAppointment): Promise<AppointmentOutput> {
    this.sequencia += 1
    const id = `apt-${this.sequencia}`

    const gravado = {
      id,
      companyId: appointment.companyId,
      title: appointment.title,
      startsAt: appointment.startsAt.toISOString(),
      /* `undefined` na entrada vira `null` na saida: "compromisso pontual" e
         um valor, e nao a ausencia de um campo. */
      endsAt: appointment.endsAt?.toISOString() ?? null,
      location: appointment.location ?? null,
      customerId: appointment.customerId ?? null,
      notes: appointment.notes ?? null,
      reminderMinutesBefore: appointment.reminderMinutesBefore ?? null,
      status: 'scheduled' as const,
      createdAt: appointment.createdAt.toISOString(),
    }

    this.registros.set(id, gravado)
    return this.semTenant(gravado)
  }

  async findById(companyId: CompanyId, id: string): Promise<AppointmentOutput | undefined> {
    const achado = this.registros.get(id)
    /* De outra empresa e o mesmo que inexistente — nunca 403. */
    if (!achado || achado.companyId !== companyId) return undefined
    return this.semTenant(achado)
  }

  async listBetween(
    companyId: CompanyId,
    from: Date,
    to: Date,
  ): Promise<readonly AppointmentOutput[]> {
    return [...this.registros.values()]
      .filter((a) => a.companyId === companyId)
      .filter((a) => a.status !== 'cancelled')
      .filter((a) => {
        const t = new Date(a.startsAt).getTime()
        return t >= from.getTime() && t <= to.getTime()
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map((a) => this.semTenant(a))
  }

  async cancel(
    companyId: CompanyId,
    id: string,
    _cancelledBy: UserId,
    _cancelledAt: Date,
    _reason?: string,
  ): Promise<AppointmentOutput> {
    const achado = this.registros.get(id)
    if (!achado || achado.companyId !== companyId) {
      throw new Error(`compromisso ${id} nao encontrado para a empresa ${companyId}`)
    }

    const cancelado = { ...achado, status: 'cancelled' as const }
    this.registros.set(id, cancelado)
    return this.semTenant(cancelado)
  }

  /** `companyId` nao sai do repositorio: e do contexto, nao da resposta. */
  async update(
    companyId: CompanyId,
    id: string,
    changes: Omit<NewAppointment, 'companyId' | 'createdBy' | 'createdAt'>,
  ): Promise<AppointmentOutput> {
    const achado = this.registros.get(id)
    if (!achado || achado.companyId !== companyId) {
      throw new Error(`compromisso ${id} nao encontrado para a empresa ${companyId}`)
    }
    const editado = {
      ...achado,
      title: changes.title,
      startsAt: changes.startsAt.toISOString(),
      endsAt: changes.endsAt?.toISOString() ?? null,
      location: changes.location ?? null,
      customerId: changes.customerId ?? null,
      notes: changes.notes ?? null,
      reminderMinutesBefore: changes.reminderMinutesBefore ?? null,
    }
    this.registros.set(id, editado)
    return this.semTenant(editado)
  }

  private semTenant(registro: AppointmentOutput & { companyId: CompanyId }): AppointmentOutput {
    const { companyId: _omitido, ...resto } = registro
    return resto
  }
}

export type LembreteAgendado = {
  readonly companyId: CompanyId
  readonly appointmentId: string
  readonly fireAt: Date
}

export class InMemoryReminderScheduler implements ReminderScheduler {
  readonly agendados = new Map<string, LembreteAgendado>()
  readonly cancelados: string[] = []
  /** Liga para simular fila fora do ar. */
  falharAoAgendar = false

  async schedule(input: LembreteAgendado): Promise<void> {
    if (this.falharAoAgendar) throw new Error('fila indisponivel')
    /* Idempotente por compromisso, como a porta promete. */
    this.agendados.set(input.appointmentId, input)
  }

  async cancel(_companyId: CompanyId, appointmentId: string): Promise<void> {
    this.agendados.delete(appointmentId)
    this.cancelados.push(appointmentId)
  }
}
