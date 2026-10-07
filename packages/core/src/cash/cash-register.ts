import type {
  CashMovementInput,
  CashMovementOutput,
  CashSessionOutput,
  CashSummary,
  CloseCashInput,
  OpenCashInput,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { CashRegister } from '../ports/cash-register.js'

/**
 * Abertura e fechamento de caixa — NR-157.
 *
 * O esperado na gaveta e troco inicial + vendas em DINHEIRO + suprimentos −
 * sangrias. As outras formas nao passam pela gaveta: entram no resumo so para
 * conferir com a maquininha. No fechamento, esperado e contado ficam gravados,
 * e a diferenca e o que o dono quer ver.
 */
export type CashDeps = {
  readonly cash: CashRegister
  readonly audit: AuditTrail
}

async function resumo(
  deps: CashDeps,
  ctx: ExecutionContext,
  session: CashSessionOutput,
): Promise<CashSummary> {
  const a = await deps.cash.activity(ctx.companyId, session, ctx.now)
  const soma = (k: 'deposit' | 'withdrawal') =>
    a.movements.filter((m) => m.kind === k).reduce((s, m) => s + m.amountCents, 0)
  const depositsCents = soma('deposit')
  const withdrawalsCents = soma('withdrawal')
  const dinheiro = a.salesByMethod.find((p) => p.method === 'cash')?.amountCents ?? 0
  return {
    session,
    movements: a.movements,
    salesByMethod: a.salesByMethod,
    salesCount: a.salesCount,
    depositsCents,
    withdrawalsCents,
    expectedCashCents: session.openingCents + dinheiro + depositsCents - withdrawalsCents,
  }
}

async function aberto(deps: CashDeps, ctx: ExecutionContext): Promise<CashSessionOutput> {
  const s = await deps.cash.findOpen(ctx.companyId)
  if (s === undefined) throw AppError.conflict('Nenhum caixa aberto. Abra o caixa primeiro.')
  return s
}

/** O caixa aberto agora, com o resumo — ou `null`. Leitura. */
export async function currentCash(
  deps: CashDeps,
  ctx: ExecutionContext,
): Promise<CashSummary | null> {
  const s = await deps.cash.findOpen(ctx.companyId)
  return s === undefined ? null : resumo(deps, ctx, s)
}

export async function openCash(
  deps: CashDeps,
  ctx: ExecutionContext,
  input: OpenCashInput,
): Promise<CashSummary> {
  assertCanWrite(ctx)

  const s = await deps.cash.open({
    companyId: ctx.companyId,
    openingCents: input.openingCents,
    notes: input.notes ?? null,
    openedBy: ctx.userId,
    openedAt: ctx.now,
  })
  if (s === 'ja_aberto') throw AppError.conflict('Ja existe um caixa aberto. Feche-o antes.')

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'CashSession',
    entityId: s.id,
    action: 'created',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: null,
    after: { openingCents: s.openingCents },
  })

  return resumo(deps, ctx, s)
}

/** Sangria ou suprimento — sempre com motivo. */
export async function addCashMovement(
  deps: CashDeps,
  ctx: ExecutionContext,
  input: CashMovementInput,
): Promise<CashMovementOutput> {
  assertCanWrite(ctx)

  const s = await aberto(deps, ctx)

  /* Sangria maior que a gaveta e dinheiro que nao existe: a conta do
     fechamento ficaria negativa sem ninguem ter errado a contagem. */
  if (input.kind === 'withdrawal') {
    const r = await resumo(deps, ctx, s)
    if (input.amountCents > r.expectedCashCents) {
      throw AppError.conflict('A sangria passa do que deve haver na gaveta.')
    }
  }

  const m = await deps.cash.addMovement(ctx.companyId, s.id, {
    ...input,
    createdBy: ctx.userId,
    createdAt: ctx.now,
  })

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'CashSession',
    entityId: s.id,
    action: 'updated',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: null,
    after: { kind: m.kind, amountCents: m.amountCents, reason: m.reason },
  })

  return m
}

export async function closeCash(
  deps: CashDeps,
  ctx: ExecutionContext,
  input: CloseCashInput,
): Promise<CashSummary> {
  assertCanWrite(ctx)

  const s = await aberto(deps, ctx)
  const r = await resumo(deps, ctx, s)

  const fechado = await deps.cash.close(ctx.companyId, s.id, {
    expectedCents: r.expectedCashCents,
    countedCents: input.countedCents,
    notes: input.notes ?? null,
    closedBy: ctx.userId,
    closedAt: ctx.now,
  })

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'CashSession',
    entityId: s.id,
    action: 'updated',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: { status: 'open' },
    after: {
      status: 'closed',
      expectedCents: r.expectedCashCents,
      countedCents: input.countedCents,
      differenceCents: input.countedCents - r.expectedCashCents,
    },
  })

  return { ...r, session: fechado }
}

/** Os ultimos caixas — leitura. */
export async function cashHistory(
  deps: CashDeps,
  ctx: ExecutionContext,
): Promise<readonly CashSessionOutput[]> {
  return deps.cash.list(ctx.companyId, 60)
}
