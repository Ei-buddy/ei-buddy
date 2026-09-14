import type {
  MyPartnerApplicationOutput,
  PendingPartnerApplication,
  PixKeyType,
} from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'

/**
 * Porta da candidatura de Parceiro — NR-115, ADR-0013.
 *
 * `partners`/`coupon_redemptions` sao cross-tenant no banco (mesmo desenho de
 * `company_connections`), entao esta porta nao e um repositorio CRUD comum —
 * cada metodo mapeia direto para uma funcao `SECURITY DEFINER` da migration
 * 0014. `core` nao sabe disso; so ve os metodos.
 */
export type PartnerApplicationRepository = {
  /**
   * Cria a candidatura (pending) e o cupom dela, inativo — chamado de dentro
   * do cadastro (`signup`). Lanca se PIX/mensagem faltarem ou o codigo do
   * cupom ja existir.
   */
  submit(input: {
    ownerUserId: UserId
    ownerCompanyId: CompanyId
    pixKey: string
    pixKeyType: PixKeyType
    message: string
    /**
     * Ausente = sugerido a partir do nome da empresa (RF-03 do prompt de
     * conta de parceiro). O adapter resolve a sugestao antes de submeter —
     * `core` nao sabe do algoritmo de sugestao, so que pode nao vir codigo.
     */
    couponCode: string | undefined
  }): Promise<{ partnerId: string; couponCode: string }>

  /** Reabre uma candidatura RECUSADA para pending. Lanca em qualquer outro estado. */
  resend(input: {
    ownerCompanyId: CompanyId
    pixKey: string
    pixKeyType: PixKeyType
    message: string
  }): Promise<void>

  /** A candidatura desta empresa, se houver. */
  mine(ownerCompanyId: CompanyId): Promise<MyPartnerApplicationOutput | undefined>

  /**
   * Fila de aprovacao.
   *
   * `requestedBy` viaja ate a funcao SQL, que confere `platform_admin_is` de
   * novo (defesa em profundidade, mesmo padrao de `company_connections_*`) —
   * mas quem barra ANTES, com `AppError.forbidden` legivel, e o caso de uso em
   * `core` (ver `review-partner-application.ts`). Chegar ate aqui sem ser
   * Super Admin ja seria um bug de outra camada.
   */
  listPending(requestedBy: UserId): Promise<readonly PendingPartnerApplication[]>

  /** Aprova ou recusa. Aprovar ativa o cupom junto (mesma transacao no banco). */
  review(input: {
    reviewedBy: UserId
    partnerId: string
    decision: 'approve' | 'reject'
    note: string | undefined
  }): Promise<void>
}
