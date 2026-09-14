import { AppError, type PartnerApplicationRepository } from '@na-regua/core'
import type {
  MyPartnerApplicationOutput,
  PendingPartnerApplication,
  PixKeyType,
} from '@na-regua/contracts'
import type { Sql } from 'postgres'

/**
 * Implementacao de `PartnerApplicationRepository` — NR-115, ADR-0013.
 *
 * Cada metodo e uma chamada a uma funcao `SECURITY DEFINER` da migration
 * 0014. Mesmo molde de `connection-repository.ts`/`platform-admin-repository.ts`:
 * nenhuma logica de autorizacao mora aqui — quem confere `platform_admin_is`
 * e a propria funcao (e, antes dela, `core`). O que este arquivo faz e
 * traduzir forma de dado e, so onde a mensagem do banco e o unico jeito de
 * comunicar uma recusa de VALIDACAO (nao uma recusa de autorizacao, que ja
 * foi barrada em `core` antes de chegar aqui), traduzir para `AppError` com o
 * texto que a funcao SQL ja escreve certo.
 */

const VIOLACAO_DE_UNICIDADE = '23505'

function ehErroDoPostgres(
  erro: unknown,
): erro is { code: string; message: string; constraint_name?: string } {
  return typeof erro === 'object' && erro !== null && 'code' in erro
}

type LinhaDeSubmit = { partner_id: string; coupon_id: string; coupon_code: string }
type LinhaDeMinha = {
  partner_id: string
  status: string
  pix_key: string
  pix_key_type: string
  message: string
  review_note: string | null
  coupon_code: string | null
  created_at: Date
  reviewed_at: Date | null
}
type LinhaDePendente = {
  partner_id: string
  company_id: string
  company_name: string
  company_phone: string
  company_email: string
  pix_key: string
  pix_key_type: string
  message: string
  coupon_code: string | null
  created_at: Date
}

const paraMinha = (l: LinhaDeMinha): MyPartnerApplicationOutput => ({
  partnerId: l.partner_id,
  status: l.status as MyPartnerApplicationOutput['status'],
  pixKey: l.pix_key,
  pixKeyType: l.pix_key_type as PixKeyType,
  message: l.message,
  reviewNote: l.review_note,
  couponCode: l.coupon_code,
  createdAt: l.created_at.toISOString(),
  reviewedAt: l.reviewed_at === null ? null : l.reviewed_at.toISOString(),
})

const paraPendente = (l: LinhaDePendente): PendingPartnerApplication => ({
  partnerId: l.partner_id,
  companyId: l.company_id,
  companyName: l.company_name,
  companyPhone: l.company_phone,
  companyEmail: l.company_email,
  pixKey: l.pix_key,
  pixKeyType: l.pix_key_type as PixKeyType,
  message: l.message,
  couponCode: l.coupon_code,
  createdAt: l.created_at.toISOString(),
})

/**
 * Traduz a mensagem de `RAISE EXCEPTION` da funcao SQL para `AppError`, so
 * quando o texto e uma recusa de VALIDACAO que a tela precisa mostrar — nao
 * uma recusa de autorizacao (essa ja foi barrada em `core` antes de chegar
 * aqui; se disparar mesmo assim e defesa em profundidade, e vira 500 comum,
 * mesmo criterio de `platform-admin-repository.ts`).
 */
function traduzirErroDeEscrita(erro: unknown): never {
  if (ehErroDoPostgres(erro)) {
    if (erro.code === VIOLACAO_DE_UNICIDADE) {
      if (erro.constraint_name === 'partners_owner_company_unique') {
        throw AppError.conflict('Esta empresa ja tem uma candidatura de Parceiro.')
      }
      if (erro.constraint_name === 'coupons_code_unique') {
        throw AppError.conflict('Este nome de cupom ja esta em uso. Escolha outro.')
      }
    }

    if (erro.message.includes('e obrigatoria') || erro.message.includes('Conte um pouco')) {
      throw AppError.validation(erro.message)
    }

    if (erro.message.includes('nao encontrada')) {
      throw AppError.notFound(erro.message)
    }

    if (
      erro.message.includes('So e possivel reenviar') ||
      erro.message.includes('ja foi revisada')
    ) {
      throw AppError.conflict(erro.message)
    }
  }

  throw erro
}

export function createPartnerApplicationRepository(sql: Sql): PartnerApplicationRepository {
  return {
    submit: async (input) => {
      try {
        const [linha] = await sql<LinhaDeSubmit[]>`
          SELECT * FROM partner_application_submit(
            ${input.ownerUserId}, ${input.ownerCompanyId},
            ${input.pixKey}, ${input.pixKeyType}, ${input.message},
            ${input.couponCode ?? null}
          )
        `
        return { partnerId: linha!.partner_id, couponCode: linha!.coupon_code }
      } catch (erro) {
        traduzirErroDeEscrita(erro)
      }
    },

    resend: async (input) => {
      try {
        await sql`
          SELECT partner_application_resend(
            ${input.ownerCompanyId}, ${input.pixKey}, ${input.message}
          )
        `
      } catch (erro) {
        traduzirErroDeEscrita(erro)
      }
    },

    mine: async (ownerCompanyId) => {
      const [linha] = await sql<LinhaDeMinha[]>`
        SELECT * FROM partner_application_mine(${ownerCompanyId})
      `
      return linha === undefined ? undefined : paraMinha(linha)
    },

    listPending: async (requestedBy) => {
      try {
        const linhas = await sql<LinhaDePendente[]>`
          SELECT * FROM partner_application_list_pending(${requestedBy})
        `
        return linhas.map(paraPendente)
      } catch (erro) {
        traduzirErroDeEscrita(erro)
      }
    },

    review: async (input) => {
      try {
        await sql`
          SELECT partner_application_review(
            ${input.reviewedBy}, ${input.partnerId}, ${input.decision}, ${input.note ?? null}
          )
        `
      } catch (erro) {
        traduzirErroDeEscrita(erro)
      }
    },
  }
}
