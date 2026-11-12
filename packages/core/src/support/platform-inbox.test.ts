import { describe, expect, it } from 'vitest'
import { supportInboxQuerySchema } from '@na-regua/contracts'
import { isAppError } from '../app-error.js'
import { InMemorySupportInbox } from './inbox-fakes.js'
import {
  closeSupportTicket,
  getSupportInboxTicket,
  listSupportInbox,
  replyAsSupport,
} from './platform-inbox.js'

/** Fila de chamados da plataforma — NR-215. */

const ADMIN = 'admin-1'
const LOJISTA = 'lojista-1'

function montar() {
  const inbox = new InMemorySupportInbox(new Set([ADMIN]))
  const msg = (id: string, author: 'cliente' | 'suporte', em: string) => ({
    id,
    author,
    authorName: author === 'cliente' ? 'Dona Maria' : 'Suporte EiBuddy',
    body: 'texto',
    attachment: null,
    createdAt: em,
  })
  const base = {
    companyId: 'emp-1',
    companyName: 'Mercadinho da Maria',
    category: 'tecnico' as const,
    createdAt: '2026-11-10T10:00:00.000Z',
  }
  inbox.cadastrar({
    ...base,
    id: 'ch-1',
    protocol: 'SUP-1',
    subject: 'Nota nao sai',
    status: 'waiting',
    updatedAt: '2026-11-10T12:00:00.000Z',
    messages: [msg('m1', 'cliente', '2026-11-10T10:00:00.000Z')],
  })
  inbox.cadastrar({
    ...base,
    id: 'ch-2',
    protocol: 'SUP-2',
    subject: 'Duvida no caixa',
    status: 'open',
    updatedAt: '2026-11-11T12:00:00.000Z',
    messages: [
      msg('m2', 'cliente', '2026-11-11T10:00:00.000Z'),
      msg('m3', 'suporte', '2026-11-11T12:00:00.000Z'),
    ],
  })
  inbox.cadastrar({
    ...base,
    id: 'ch-3',
    protocol: 'SUP-3',
    subject: 'Resolvido',
    status: 'closed',
    updatedAt: '2026-11-09T12:00:00.000Z',
    messages: [msg('m4', 'cliente', '2026-11-09T10:00:00.000Z')],
  })
  const deps = { access: { isPlatformAdmin: async (u: string) => u === ADMIN }, inbox }
  return { deps }
}

const q = (over: Record<string, unknown> = {}) => supportInboxQuerySchema.parse(over)
const erroDe = (p: Promise<unknown>) => p.then(() => undefined).catch((e: unknown) => e)

describe('fila de chamados da plataforma', () => {
  it('abre em "responder": so o que espera a equipe, com as contagens', async () => {
    const { deps } = montar()
    const r = await listSupportInbox(deps, ADMIN, q())
    expect(r.tickets.map((t) => t.protocol)).toEqual(['SUP-1'])
    expect(r.counts).toEqual({ toAnswer: 1, awaitingCustomer: 1, closed: 1 })
    expect(r.tickets[0]).toMatchObject({
      companyName: 'Mercadinho da Maria',
      lastAuthor: 'cliente',
    })
  })

  it('aguardando, encerrados e todos', async () => {
    const { deps } = montar()
    const de = async (situation: string) =>
      (await listSupportInbox(deps, ADMIN, q({ situation }))).tickets.map((t) => t.protocol)
    expect(await de('aguardando')).toEqual(['SUP-2'])
    expect(await de('encerrados')).toEqual(['SUP-3'])
    expect(await de('todos')).toEqual(['SUP-2', 'SUP-1', 'SUP-3'])
  })

  it('responder como suporte tira de "responder" e vai para "aguardando"', async () => {
    const { deps } = montar()
    const r = await replyAsSupport(deps, ADMIN, 'ch-1', { body: '  Ja vamos ver.  ' })
    expect(r.messages.at(-1)).toMatchObject({ author: 'suporte', body: 'Ja vamos ver.' })
    expect(r.status).toBe('open')
    const lista = await listSupportInbox(deps, ADMIN, q())
    expect(lista.counts).toEqual({ toAnswer: 0, awaitingCustomer: 2, closed: 1 })
  })

  it('responder um encerrado reabre', async () => {
    const { deps } = montar()
    expect((await replyAsSupport(deps, ADMIN, 'ch-3', { body: 'Voltando' })).status).toBe('open')
  })

  it('encerrar', async () => {
    const { deps } = montar()
    expect((await closeSupportTicket(deps, ADMIN, 'ch-1')).status).toBe('closed')
    expect((await listSupportInbox(deps, ADMIN, q())).counts.closed).toBe(2)
  })

  it('quem nao e Super Admin recebe 403 em tudo', async () => {
    const { deps } = montar()
    for (const p of [
      listSupportInbox(deps, LOJISTA, q()),
      getSupportInboxTicket(deps, LOJISTA, 'ch-1'),
      replyAsSupport(deps, LOJISTA, 'ch-1', { body: 'x' }),
      closeSupportTicket(deps, LOJISTA, 'ch-1'),
    ]) {
      const e = await erroDe(p)
      expect(isAppError(e) && e.code).toBe('FORBIDDEN')
    }
  })

  it('chamado inexistente e 404', async () => {
    const { deps } = montar()
    for (const p of [
      getSupportInboxTicket(deps, ADMIN, 'nada'),
      replyAsSupport(deps, ADMIN, 'nada', { body: 'x' }),
      closeSupportTicket(deps, ADMIN, 'nada'),
    ]) {
      const e = await erroDe(p)
      expect(isAppError(e) && e.code).toBe('NOT_FOUND')
    }
  })
})
