import { podeEscrever as doContrato, subscriptionStatusSchema } from '@na-regua/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Assinatura, EstadoDaAssinatura } from './assinatura-api'

/* `./api` puxa o armazenamento do aparelho, que nao existe no Node. */
vi.mock('./api', () => ({ chamarApi: vi.fn() }))

const { chamarApi } = await import('./api')
const {
  carregarAssinatura,
  contarPorGrupo,
  dataQueImporta,
  ESTADOS_DA_ASSINATURA,
  estaNoGrupo,
  podeEscrever,
  resumoDaAssinatura,
  SEM_ASSINATURA,
} = await import('./assinatura-api')

const assinatura = (over: Partial<Assinatura>): Assinatura => ({
  companyId: 'c1',
  planCode: 'plano-unico',
  status: 'active',
  trialEndsAt: null,
  currentPeriodEndsAt: null,
  couponId: null,
  restrictedAt: null,
  cancelledAt: null,
  nextDueDate: null,
  ...over,
})

describe('podeEscrever (NR-216)', () => {
  it('tem os mesmos cinco estados do contrato', () => {
    expect([...ESTADOS_DA_ASSINATURA]).toEqual(subscriptionStatusSchema.options)
  })

  it('responde igual ao contrato em todos os estados', () => {
    for (const s of subscriptionStatusSchema.options) {
      expect(podeEscrever(s), s).toBe(doContrato(s))
    }
  })

  it('atrasada ainda escreve; sem assinatura tambem', () => {
    expect(podeEscrever('overdue')).toBe(true)
    expect(podeEscrever(null)).toBe(true)
    expect(podeEscrever('restricted')).toBe(false)
  })
})

describe('resumoDaAssinatura', () => {
  it('sem assinatura: liberado, e diz que a cobranca nao comecou', () => {
    expect(resumoDaAssinatura(SEM_ASSINATURA)).toMatchObject({
      rotulo: 'Liberado',
      tom: 'positive',
    })
  })

  it('atrasada mostra o vencimento sem andar um dia por causa do fuso', () => {
    const r = resumoDaAssinatura({
      status: 'overdue',
      canWrite: true,
      subscription: assinatura({ status: 'overdue', nextDueDate: '2026-11-05' }),
    })
    expect(r.rotulo).toBe('Pagamento atrasado')
    expect(r.detalhe).toContain('05/11/2026')
    expect(r.tom).toBe('warning')
  })

  it('restrita diz desde quando e que os dados continuam salvos', () => {
    const r = resumoDaAssinatura({
      status: 'restricted',
      canWrite: false,
      subscription: assinatura({ status: 'restricted', restrictedAt: '2026-11-10T15:00:00.000Z' }),
    })
    expect(r).toMatchObject({ rotulo: 'Acesso restrito', tom: 'negative' })
    expect(r.detalhe).toContain('10/11/2026')
    expect(r.detalhe).toContain('dados continuam salvos')
  })

  it('cada estado tem um rotulo', () => {
    for (const s of ESTADOS_DA_ASSINATURA) {
      const r = resumoDaAssinatura({
        status: s,
        canWrite: podeEscrever(s),
        subscription: assinatura({ status: s }),
      })
      expect(r.rotulo.length, s).toBeGreaterThan(0)
    }
  })
})

describe('grupos da plataforma', () => {
  const estados: (EstadoDaAssinatura | null)[] = [
    'overdue',
    'restricted',
    'trial',
    'active',
    'active',
    'cancelled',
    null,
    null,
  ]

  it('inadimplentes = atrasada + restrita', () => {
    expect(estaNoGrupo('overdue', 'inadimplentes')).toBe(true)
    expect(estaNoGrupo('restricted', 'inadimplentes')).toBe(true)
    expect(estaNoGrupo('active', 'inadimplentes')).toBe(false)
    expect(estaNoGrupo(null, 'inadimplentes')).toBe(false)
  })

  it('conta cada grupo', () => {
    expect(contarPorGrupo(estados)).toEqual({
      todas: 8,
      inadimplentes: 2,
      trial: 1,
      active: 2,
      cancelled: 1,
      sem: 2,
    })
  })

  it('a data que importa muda com o estado', () => {
    const base = { trialEndsAt: null, nextDueDate: '2026-11-05', restrictedAt: null }
    expect(dataQueImporta({ ...base, subscriptionStatus: 'overdue' })).toBe('venceu em 05/11/2026')
    expect(dataQueImporta({ ...base, subscriptionStatus: 'active' })).toBe('vence em 05/11/2026')
    expect(dataQueImporta({ ...base, subscriptionStatus: null })).toBeNull()
  })
})

describe('carregarAssinatura', () => {
  beforeEach(() => vi.mocked(chamarApi).mockReset())

  it('le GET /assinatura e devolve a situacao', async () => {
    vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: SEM_ASSINATURA } as never)
    expect(await carregarAssinatura()).toEqual({ ok: true, dados: SEM_ASSINATURA })
    expect(chamarApi).toHaveBeenCalledWith('/assinatura')
  })

  it('repassa a mensagem do servidor quando falha', async () => {
    vi.mocked(chamarApi).mockResolvedValue({ ok: false, message: 'Sem conexão.' } as never)
    expect(await carregarAssinatura()).toEqual({ ok: false, erro: 'Sem conexão.' })
  })
})
