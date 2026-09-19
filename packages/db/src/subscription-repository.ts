import type { Subscription, SubscriptionStatus } from '@na-regua/contracts'
import type { SubscriptionRepository } from '@na-regua/core'
import type { Sql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Implementacao da `SubscriptionRepository` — NR-063, RF-110 a RF-118.
 *
 * Nenhuma migration nova: `subscriptions` existe desde a `0007`, com a
 * `UNIQUE (company_id)` e o CHECK dos cinco estados. E por isso que nada aqui
 * recebe um id de assinatura — a empresa JA e a chave.
 *
 * Cada metodo abre a propria transacao com `withTenant`, como na agenda. Nao
 * ha `UnitOfWork`: nenhuma operacao daqui grava em duas tabelas de uma vez.
 * Quando o ciclo de cobranca entrar (`subscription_cycles`), ai sim.
 */

type Linha = {
  company_id: string
  plan_code: string
  status: string
  trial_ends_at: Date | null
  current_period_ends_at: Date | null
  coupon_id: string | null
  restricted_at: Date | null
  cancelled_at: Date | null
  next_due_date: Date | string | null
}

/** `timestamptz` volta como `Date` no driver; o contrato pede texto ISO. */
const iso = (v: Date | null): string | null => (v === null ? null : v.toISOString())

/**
 * `next_due_date` e `date`, e nao `timestamptz`.
 *
 * O driver pode devolver `Date` ou string conforme a versao. Passar por
 * `toISOString()` traria o fuso junto e um vencimento de dia 05 viraria dia 04
 * para quem esta em Brasilia — o mesmo problema que `due-date.ts` inteiro
 * existe para evitar. Por isso o corte e nos dez primeiros caracteres.
 */
const dia = (v: Date | string | null): string | null => {
  if (v === null) return null
  return typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10)
}

const paraSaida = (l: Linha): Subscription => ({
  companyId: l.company_id,
  planCode: l.plan_code,
  status: l.status as SubscriptionStatus,
  trialEndsAt: iso(l.trial_ends_at),
  currentPeriodEndsAt: iso(l.current_period_ends_at),
  couponId: l.coupon_id,
  restrictedAt: iso(l.restricted_at),
  cancelledAt: iso(l.cancelled_at),
  nextDueDate: dia(l.next_due_date),
})

const COLUNAS = `company_id, plan_code, status, trial_ends_at, current_period_ends_at,
                 coupon_id, restricted_at, cancelled_at, next_due_date`

export function createSubscriptionRepository(sql: Sql): SubscriptionRepository {
  return {
    findByCompany: async (companyId) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`
          SELECT ${tx.unsafe(COLUNAS)}
            FROM subscriptions
           WHERE company_id = ${companyId}
             AND deleted_at IS NULL
        `,
      )
      return linha === undefined ? undefined : paraSaida(linha)
    },

    startTrial: async (entry) => {
      const [linha] = await withTenant(
        sql,
        entry.companyId,
        (tx) => tx<Linha[]>`
          INSERT INTO subscriptions (company_id, plan_code, status, trial_ends_at, created_at, updated_at)
          VALUES (${entry.companyId}, ${entry.planCode}, 'trial', ${entry.trialEndsAt},
                  ${entry.createdAt}, ${entry.createdAt})
          /*
           * A idempotencia mora no BANCO, e nao num SELECT antes do INSERT.
           * Duas requisicoes simultaneas passariam as duas pelo SELECT e
           * tentariam inserir as duas; aqui a "UNIQUE (company_id)" decide, e
           * a perdedora recebe a linha que ja existe em vez de um erro.
           *
           * "DO UPDATE" de um campo para si mesmo, e nao "DO NOTHING", porque
           * "DO NOTHING" nao devolve linha no RETURNING — e quem chamou ficaria
           * sem a assinatura justamente no caso que o conflito existe para
           * tratar.
           */
          ON CONFLICT (company_id) DO UPDATE SET plan_code = subscriptions.plan_code
          RETURNING ${tx.unsafe(COLUNAS)}
        `,
      )

      /* O RETURNING de um upsert sempre traz linha. Se nao trouxe, algo mudou
         no schema e falhar alto e melhor que devolver uma assinatura inventada
         para quem vai decidir acesso com ela. */
      if (linha === undefined) {
        throw new Error('Nao foi possivel iniciar o periodo de teste desta empresa.')
      }
      return paraSaida(linha)
    },

    updateStatus: async (entry) => {
      await withTenant(
        sql,
        entry.companyId,
        (tx) => tx`
          UPDATE subscriptions
             SET status = ${entry.status},
                 /* Gravados mesmo quando nulos: voltar de "restricted" para
                    "active" (RF-118) tem de LIMPAR a marca do bloqueio, ou a
                    tela continuaria dizendo desde quando a loja esta travada. */
                 restricted_at = ${entry.restrictedAt},
                 cancelled_at = ${entry.cancelledAt},
                 updated_at = ${entry.updatedAt}
           WHERE company_id = ${entry.companyId}
             AND deleted_at IS NULL
        `,
      )
    },
  }
}
