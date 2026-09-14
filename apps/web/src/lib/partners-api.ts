import { pedir, type Resultado } from './http'
import type { PixKeyType } from './auth-api'

/**
 * Conta de Parceiro — NR-115, ADR-0013.
 *
 * Fila de aprovacao (painel do Super Admin) e self-service (a propria
 * empresa le/reenvia a candidatura dela) — mesma separacao de
 * `apps/api/src/routes/partners.ts`.
 */

export type CandidaturaDeParceiro = {
  partnerId: string
  companyId: string
  companyName: string
  companyPhone: string
  companyEmail: string
  pixKey: string
  pixKeyType: PixKeyType
  message: string
  couponCode: string | null
  createdAt: string
}

export const listarParceirosPendentes = (): Promise<
  Resultado<{ applications: CandidaturaDeParceiro[] }>
> => pedir('/api/admin/parceiros')

export const aprovarParceiro = (
  partnerId: string,
  note?: string,
): Promise<Resultado<{ ok: true }>> =>
  pedir(`/api/admin/parceiros/${partnerId}/aprovar`, {
    method: 'POST',
    body: JSON.stringify(note === undefined ? {} : { note }),
  })

export const recusarParceiro = (
  partnerId: string,
  note?: string,
): Promise<Resultado<{ ok: true }>> =>
  pedir(`/api/admin/parceiros/${partnerId}/recusar`, {
    method: 'POST',
    body: JSON.stringify(note === undefined ? {} : { note }),
  })

export type MinhaCandidatura = {
  partnerId: string
  status: 'pending' | 'active' | 'rejected'
  pixKey: string
  pixKeyType: PixKeyType
  message: string
  reviewNote: string | null
  couponCode: string | null
  createdAt: string
  reviewedAt: string | null
}

export const buscarMinhaCandidatura = (): Promise<
  Resultado<{ application: MinhaCandidatura | null }>
> => pedir('/api/parceiros/mim')

export const reenviarCandidatura = (input: {
  pixKey: string
  pixKeyType: PixKeyType
  message: string
}): Promise<Resultado<{ ok: true }>> =>
  pedir('/api/parceiros/reenviar', { method: 'POST', body: JSON.stringify(input) })
