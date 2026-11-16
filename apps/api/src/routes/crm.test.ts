import type { CrmCardOutput, TeamMemberOutput } from '@na-regua/contracts'
import type { CrmRepository, TeamRepository } from '@na-regua/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import type { AuthenticatedPrincipal } from '../plugins/execution-context.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { registerCrmRoutes, type CrmRouteDeps } from './crm.js'

/**
 * Rotas do quadro de CRM e da equipe — NR-109.
 *
 * As regras tem teste em `core` (autorizacao, NOT_FOUND por empresa) e a
 * agregacao de comentario em `db`. Aqui se prova o que so a rota faz: o
 * codigo que sai, a forma que entra, e que mover coluna e comentar leem o id
 * do CAMINHO.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  companyId: 'empresa-1',
  userId: 'usuario-1',
  role: 'owner',
}

const AGORA = '2026-09-11T13:00:00.000Z'

const card = (over: Partial<CrmCardOutput> = {}): CrmCardOutput => ({
  id: 'crm-1',
  title: 'Retomar contato',
  description: null,
  kind: 'contact',
  column: 'todo',
  customerId: null,
  customerName: null,
  dueOn: '2026-09-15',
  assigneeUserId: null,
  assigneeName: null,
  comments: [],
  createdAt: AGORA,
  ...over,
})

function repositorios(
  overCrm: Partial<CrmRepository> = {},
  overTeam: Partial<TeamRepository> = {},
) {
  const chamadas: string[] = []

  const crm: CrmRepository = {
    create: async () => {
      chamadas.push('create')
      return card()
    },
    list: async () => {
      chamadas.push('list')
      return [card()]
    },
    findById: async () => {
      chamadas.push('findById')
      return card()
    },
    move: async () => {
      chamadas.push('move')
      return card({ column: 'done' })
    },
    delete: async () => {
      chamadas.push('delete')
      return true
    },
    addComment: async () => {
      chamadas.push('addComment')
      return {
        id: 'crmc-1',
        authorId: 'usuario-1',
        authorName: 'Marina Alves',
        text: 'Ok.',
        createdAt: AGORA,
      }
    },
    ...overCrm,
  }

  const membros: TeamMemberOutput[] = [{ id: 'usuario-1', name: 'Marina Alves' }]
  const team: TeamRepository = {
    list: async () => {
      chamadas.push('team.list')
      return membros
    },
    ...overTeam,
  }

  return { crm, team, chamadas }
}

async function buildApp(
  overCrm: Partial<CrmRepository> = {},
  overTeam: Partial<TeamRepository> = {},
) {
  const { crm, team, chamadas } = repositorios(overCrm, overTeam)
  const deps: CrmRouteDeps = { crm, team }

  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  await registerRateLimit(app)
  app.addHook('onRequest', async (request) => {
    request.principal = PRINCIPAL
  })
  registerCrmRoutes(app, deps)

  return { app, chamadas }
}

let app: FastifyInstance

afterEach(async () => {
  await app?.close()
})

describe('o quadro — GET /crm/cards', () => {
  it('devolve os cards da empresa', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'GET', url: '/crm/cards' })

    expect(r.statusCode).toBe(200)
    expect(r.json().cards).toHaveLength(1)
  })
})

describe('criar card — POST /crm/cards', () => {
  it('cria com 201', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/crm/cards',
      payload: { title: 'Retomar contato', kind: 'contact', dueOn: '2026-09-15' },
    })

    expect(r.statusCode).toBe(201)
    expect(c.chamadas).toContain('create')
  })

  it('recusa titulo curto demais', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/crm/cards',
      payload: { title: 'A', kind: 'contact', dueOn: '2026-09-15' },
    })

    expect(r.statusCode).toBe(400)
  })

  it('recusa kind fora do conjunto fechado', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/crm/cards',
      payload: { title: 'Retomar contato', kind: 'lead', dueOn: '2026-09-15' },
    })

    expect(r.statusCode).toBe(400)
  })
})

describe('mover — PATCH /crm/cards/:id', () => {
  it('move e devolve a coluna nova', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'PATCH',
      url: '/crm/cards/crm-1',
      payload: { column: 'done' },
    })

    expect(r.statusCode).toBe(200)
    expect(r.json().column).toBe('done')
  })

  it('card inexistente responde 404', async () => {
    const c = await buildApp({
      findById: async () => undefined,
    })
    app = c.app

    const r = await app.inject({
      method: 'PATCH',
      url: '/crm/cards/nao-existe',
      payload: { column: 'done' },
    })

    expect(r.statusCode).toBe(404)
  })
})

describe('excluir — DELETE /crm/cards/:id — NR-213', () => {
  it('apaga e responde 204', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'DELETE', url: '/crm/cards/crm-1' })

    expect(r.statusCode).toBe(204)
    expect(c.chamadas).toEqual(['findById', 'delete'])
  })

  it('card inexistente responde 404 e nada e apagado', async () => {
    const c = await buildApp({ findById: async () => undefined })
    app = c.app

    const r = await app.inject({ method: 'DELETE', url: '/crm/cards/nao-existe' })

    expect(r.statusCode).toBe(404)
    expect(c.chamadas).not.toContain('delete')
  })
})

describe('comentar — POST /crm/cards/:id/comentarios', () => {
  it('usa o id do CAMINHO, e ignora qualquer id do corpo', async () => {
    const c = await buildApp({
      findById: async () => card(),
      addComment: async (input) => {
        expect(input.cardId).toBe('crm-do-caminho')
        return {
          id: 'crmc-1',
          authorId: 'usuario-1',
          authorName: 'Marina Alves',
          text: input.text,
          createdAt: AGORA,
        }
      },
    })
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/crm/cards/crm-do-caminho/comentarios',
      payload: { text: 'Mandei o catalogo.' },
    })

    expect(r.statusCode).toBe(201)
  })

  it('card inexistente responde 404', async () => {
    const c = await buildApp({ findById: async () => undefined })
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/crm/cards/nao-existe/comentarios',
      payload: { text: 'Ok.' },
    })

    expect(r.statusCode).toBe(404)
  })

  it('recusa comentario vazio', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/crm/cards/crm-1/comentarios',
      payload: { text: '' },
    })

    expect(r.statusCode).toBe(400)
  })
})

describe('a equipe — GET /equipe', () => {
  it('devolve quem esta na loja, para o seletor de responsavel', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'GET', url: '/equipe' })

    expect(r.statusCode).toBe(200)
    expect(r.json().members).toEqual([{ id: 'usuario-1', name: 'Marina Alves' }])
  })
})
