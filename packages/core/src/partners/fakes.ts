import type { MyPartnerApplicationOutput, PendingPartnerApplication } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import type { PartnerApplicationRepository } from '../ports/partner-application-repository.js'

type Registro = MyPartnerApplicationOutput & { ownerCompanyId: string; ownerUserId: string }

/** Falso em memoria — mesmo padrao de `InMemoryWaitlist`/`InMemoryConnectionRequests`. */
export class InMemoryPartnerApplicationRepository implements PartnerApplicationRepository {
  private registros: Registro[] = []
  private proximoId = 1

  async submit(input: {
    ownerUserId: string
    ownerCompanyId: string
    pixKey: string
    pixKeyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP'
    message: string
    couponCode: string | undefined
  }): Promise<{ partnerId: string; couponCode: string }> {
    if (this.registros.some((r) => r.ownerCompanyId === input.ownerCompanyId)) {
      throw new Error(
        'duplicate key value violates unique constraint "partners_owner_company_unique"',
      )
    }

    const partnerId = `partner-${this.proximoId++}`
    const couponCode = (input.couponCode ?? `SUGERIDO${this.proximoId}`).toUpperCase()

    this.registros.push({
      partnerId,
      ownerCompanyId: input.ownerCompanyId,
      ownerUserId: input.ownerUserId,
      status: 'pending',
      pixKey: input.pixKey,
      pixKeyType: input.pixKeyType,
      message: input.message,
      reviewNote: null,
      couponCode,
      createdAt: new Date().toISOString(),
      reviewedAt: null,
    })

    return { partnerId, couponCode }
  }

  async couponCodeTaken(code: string): Promise<boolean> {
    return this.registros.some((r) => r.couponCode === code.trim().toUpperCase())
  }

  async resend(input: {
    ownerCompanyId: string
    pixKey: string
    pixKeyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP'
    message: string
  }): Promise<void> {
    const registro = this.registros.find((r) => r.ownerCompanyId === input.ownerCompanyId)
    if (registro === undefined)
      throw AppError.notFound('Nenhuma candidatura de Parceiro encontrada.')
    if (registro.status !== 'rejected') {
      throw new Error('So e possivel reenviar uma candidatura recusada.')
    }

    registro.status = 'pending'
    registro.pixKey = input.pixKey
    registro.pixKeyType = input.pixKeyType
    registro.message = input.message
    registro.reviewNote = null
    registro.reviewedAt = null
  }

  async mine(ownerCompanyId: string): Promise<MyPartnerApplicationOutput | undefined> {
    const {
      ownerCompanyId: _o,
      ownerUserId: _u,
      ...resto
    } = this.registros.find((r) => r.ownerCompanyId === ownerCompanyId) ?? {}
    return Object.keys(resto).length === 0 ? undefined : (resto as MyPartnerApplicationOutput)
  }

  async listPending(): Promise<readonly PendingPartnerApplication[]> {
    return this.registros
      .filter((r) => r.status === 'pending')
      .map((r) => ({
        partnerId: r.partnerId,
        companyId: r.ownerCompanyId,
        companyName: 'Empresa de Teste',
        companyPhone: '41999990000',
        companyEmail: 'teste@empresa.local',
        pixKey: r.pixKey,
        pixKeyType: r.pixKeyType,
        message: r.message,
        couponCode: r.couponCode,
        createdAt: r.createdAt,
      }))
  }

  async review(input: {
    reviewedBy: string
    partnerId: string
    decision: 'approve' | 'reject'
    note: string | undefined
  }): Promise<void> {
    const registro = this.registros.find((r) => r.partnerId === input.partnerId)
    if (registro === undefined) throw AppError.notFound('Candidatura nao encontrada.')
    if (registro.status !== 'pending') throw new Error('Esta candidatura ja foi revisada.')

    registro.status = input.decision === 'approve' ? 'active' : 'rejected'
    registro.reviewNote = input.note ?? null
    registro.reviewedAt = new Date().toISOString()
  }
}
