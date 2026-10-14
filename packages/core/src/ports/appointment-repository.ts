import type { AppointmentOutput } from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'

/**
 * Porta do repositorio de compromissos.
 *
 * Declarada aqui, implementada por `db` — a seta aponta para dentro: quem
 * define o contrato e o nucleo, nao a tecnologia de persistencia. E o que
 * permite testar o caso de uso com um repositorio em memoria, sem Postgres.
 *
 * `companyId` aparece em toda assinatura por decisao, nao por descuido: o
 * isolamento entre empresas nao pode depender de o chamador lembrar de
 * filtrar. Quem implementa aplica o filtro; quem chama nao tem como esquecer.
 */

export type NewAppointment = {
  readonly companyId: CompanyId
  readonly title: string
  /** Sempre UTC. O fuso e coisa de exibicao. */
  readonly startsAt: Date
  /** Ausente = compromisso pontual, sem duracao. Nunca antes de `startsAt`. */
  readonly endsAt?: Date | undefined
  readonly location?: string | undefined
  readonly customerId?: string | undefined
  readonly notes?: string | undefined
  readonly reminderMinutesBefore?: number | undefined
  readonly createdBy: UserId
  readonly createdAt: Date
}

export type AppointmentRepository = {
  save(appointment: NewAppointment): Promise<AppointmentOutput>

  /** Devolve `undefined` quando nao existe OU e de outra empresa. */
  findById(companyId: CompanyId, id: string): Promise<AppointmentOutput | undefined>

  /** Editar ou remarcar — NR-152. Substitui os campos do formulario. */
  update(
    companyId: CompanyId,
    id: string,
    changes: Omit<NewAppointment, 'companyId' | 'createdBy' | 'createdAt'>,
  ): Promise<AppointmentOutput>

  /**
   * Compromissos que comecam dentro do intervalo, em ordem de horario.
   * Cancelados ficam de fora — RF-093 pede a agenda do dia, nao o historico.
   */
  listBetween(companyId: CompanyId, from: Date, to: Date): Promise<readonly AppointmentOutput[]>

  /** Marca como cancelado. Nao apaga — RNF-040. */
  cancel(
    companyId: CompanyId,
    id: string,
    cancelledBy: UserId,
    cancelledAt: Date,
    reason?: string,
  ): Promise<AppointmentOutput>
}
