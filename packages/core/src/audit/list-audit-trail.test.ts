import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import type { Role } from '@na-regua/contracts'
import type { ExecutionContext } from '../context.js'
import { InMemoryAuditQueries } from './fakes.js'
import { listAuditActors, listAuditTrail } from './list-audit-trail.js'

/**
 * Consultar a trilha — US-061.
 *
 * A trilha existia so pela metade: dezesseis pontos gravavam e nada lia. O que
 * se prova aqui e o terceiro criterio da historia, que ate agora nao tinha
 * como acontecer — e quem pode fazer a pergunta.
 */

const EMPRESA = 'empresa-1'
const OUTRA = 'empresa-2'

function ctx(role: Role, companyId = EMPRESA): ExecutionContext {
  return {
    companyId,
    userId: 'dono-1',
    role,
    channel: 'app',
    requestId: 'req-1',
    now: new Date('2026-09-15T12:00:00.000Z'),
  } as ExecutionContext
}

function entrada(over: Partial<Parameters<InMemoryAuditQueries['adicionar']>[0]> = {}) {
  return {
    companyId: EMPRESA,
    id: `log-${Math.random().toString(36).slice(2, 8)}`,
    entity: 'Sale',
    entityId: 'venda-1',
    action: 'created' as const,
    actorId: 'func-1',
    actorName: 'Funcionario Um',
    channel: 'app',
    occurredAt: '2026-09-15T10:00:00.000Z',
    before: null,
    after: { total: 1000 },
    ...over,
  }
}

const FILTRO = { page: 1, pageSize: 50 }

function cenario() {
  const auditQueries = new InMemoryAuditQueries()
  return { deps: { auditQueries }, auditQueries }
}

describe('consultar a trilha de auditoria — US-061', () => {
  it('o dono ve a trilha da loja dele', async () => {
    const c = cenario()
    c.auditQueries.adicionar(entrada())

    const r = await listAuditTrail(c.deps, ctx('owner'), FILTRO)

    expect(r.entries).toHaveLength(1)
    expect(r.total).toBe(1)
  })

  it('mostra o NOME de quem fez, e nao so o identificador', async () => {
    const c = cenario()
    c.auditQueries.adicionar(entrada({ actorName: 'Marta do Caixa' }))

    const r = await listAuditTrail(c.deps, ctx('owner'), FILTRO)

    /* O terceiro criterio da US-061 em uma linha: "vejo o usuario humano que
       confirmou, nao 'sistema'". Um UUID na tela e a mesma frustracao. */
    expect(r.entries[0]?.actorName).toBe('Marta do Caixa')
  })

  it('funcionario nao ve a trilha — seria o auditado lendo a auditoria', async () => {
    const c = cenario()
    c.auditQueries.adicionar(entrada())

    const erro = await pegaErro(() => listAuditTrail(c.deps, ctx('staff'), FILTRO))

    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
  })

  it('contador tambem nao — o acesso dele e o dado contabil, nao quem operou', async () => {
    const c = cenario()

    const erro = await pegaErro(() => listAuditTrail(c.deps, ctx('accountant'), FILTRO))

    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
  })

  it('a trilha de outra loja nao aparece', async () => {
    const c = cenario()
    c.auditQueries.adicionar(entrada({ companyId: OUTRA }))

    const r = await listAuditTrail(c.deps, ctx('owner'), FILTRO)

    expect(r.entries).toEqual([])
  })

  it('filtra por quem fez — "o que o fulano andou mexendo"', async () => {
    const c = cenario()
    c.auditQueries.adicionar(entrada({ actorId: 'func-1' }))
    c.auditQueries.adicionar(entrada({ actorId: 'func-2' }))

    const r = await listAuditTrail(c.deps, ctx('owner'), { ...FILTRO, actorId: 'func-2' })

    expect(r.entries).toHaveLength(1)
    expect(r.entries[0]?.actorId).toBe('func-2')
  })

  it('filtra por entidade e por acao', async () => {
    const c = cenario()
    c.auditQueries.adicionar(entrada({ entity: 'Sale', action: 'created' }))
    c.auditQueries.adicionar(entrada({ entity: 'Product', action: 'updated' }))

    const porEntidade = await listAuditTrail(c.deps, ctx('owner'), { ...FILTRO, entity: 'Product' })
    const porAcao = await listAuditTrail(c.deps, ctx('owner'), { ...FILTRO, action: 'created' })

    expect(porEntidade.entries[0]?.entity).toBe('Product')
    expect(porAcao.entries[0]?.action).toBe('created')
  })

  it('devolve o total real, e nao o tamanho da pagina', async () => {
    const c = cenario()
    for (let i = 0; i < 5; i += 1) c.auditQueries.adicionar(entrada())

    const r = await listAuditTrail(c.deps, ctx('owner'), { page: 1, pageSize: 2 })

    /* Sem isso a tela nao sabe se existe pagina 2 — e paginacao que mente
       sobre o tamanho esconde justamente o registro que se procura. */
    expect(r.entries).toHaveLength(2)
    expect(r.total).toBe(5)
    expect(r.pageSize).toBe(2)
  })
})

/**
 * A lista de quem agiu — a tela abre por ela (US-061).
 *
 * Mostrar a trilha inteira de cara e ilegivel numa loja com movimento: quem
 * audita comeca por "quem", e so depois olha o que aquela pessoa fez.
 */
describe('quem agiu na loja', () => {
  it('agrupa por pessoa, com quantas acoes cada uma tem', async () => {
    const c = cenario()
    c.auditQueries.adicionar(entrada({ actorId: 'func-1', actorName: 'Marta' }))
    c.auditQueries.adicionar(entrada({ actorId: 'func-1', actorName: 'Marta' }))
    c.auditQueries.adicionar(entrada({ actorId: 'func-2', actorName: 'Joao' }))

    const r = await listAuditActors(c.deps, ctx('owner'))

    expect(r.actors).toHaveLength(2)
    expect(r.actors.find((a) => a.actorId === 'func-1')?.entries).toBe(2)
  })

  it('quem mexeu por ultimo aparece primeiro', async () => {
    const c = cenario()
    c.auditQueries.adicionar(entrada({ actorId: 'antigo', occurredAt: '2026-09-01T10:00:00.000Z' }))
    c.auditQueries.adicionar(
      entrada({ actorId: 'recente', occurredAt: '2026-09-15T10:00:00.000Z' }),
    )

    const r = await listAuditActors(c.deps, ctx('owner'))

    expect(r.actors[0]?.actorId).toBe('recente')
  })

  it('funcionario nao ve nem a lista de quem agiu', async () => {
    const c = cenario()
    c.auditQueries.adicionar(entrada())

    const erro = await pegaErro(() => listAuditActors(c.deps, ctx('staff')))

    /* A lista sozinha ja e auditoria: "Marta: 340 acoes" diz o movimento da
       colega sem mostrar uma linha sequer. */
    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
  })

  it('so conta a loja do contexto', async () => {
    const c = cenario()
    c.auditQueries.adicionar(entrada({ companyId: OUTRA, actorId: 'de-fora' }))

    const r = await listAuditActors(c.deps, ctx('owner'))

    expect(r.actors).toEqual([])
  })
})

async function pegaErro(fn: () => Promise<unknown>) {
  try {
    await fn()
    return undefined
  } catch (e) {
    return e
  }
}
