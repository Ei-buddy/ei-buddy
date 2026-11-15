import type { TicketDetail } from '@na-regua/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '../context.js'
import type { SupportTicketAlert } from '../ports/support-alert.js'
import type { SupportRepository } from '../ports/support-repository.js'
import { openTicket } from './tickets.js'

/** Abrir chamado e avisar a equipe — NR-080, DEC-029. */

const AGORA = '2026-11-15T12:00:00.000Z'

const CTX: ExecutionContext = {
  companyId: 'empresa-1',
  userId: 'usuario-1',
  role: 'owner',
  channel: 'app',
  requestId: 'req-1',
  now: new Date(AGORA),
}

const aberto: TicketDetail = {
  id: 'ch-1',
  protocol: '2026-0007',
  subject: 'A nota nao sai',
  category: 'tecnico',
  status: 'open',
  createdAt: AGORA,
  updatedAt: AGORA,
  unread: 0,
  messages: [],
}

function deps(alerta?: SupportTicketAlert) {
  const support = {
    open: vi.fn(async () => aberto),
  } as unknown as SupportRepository
  return {
    support,
    quemEscreve: async () => 'Dona Marina',
    ...(alerta === undefined ? {} : { alerta }),
  }
}

const ENTRADA = { subject: 'A nota nao sai', category: 'tecnico' as const, body: 'Da erro de CSC.' }

describe('openTicket e o aviso a equipe (DEC-029)', () => {
  it('avisa com loja, protocolo, assunto, quem escreveu e a mensagem', async () => {
    const chamadoAberto = vi.fn(async () => undefined)
    const r = await openTicket(deps({ chamadoAberto }), CTX, ENTRADA)

    expect(r.protocol).toBe('2026-0007')
    expect(chamadoAberto).toHaveBeenCalledWith({
      companyId: 'empresa-1',
      ticketId: 'ch-1',
      protocol: '2026-0007',
      subject: 'A nota nao sai',
      category: 'tecnico',
      authorName: 'Dona Marina',
      body: 'Da erro de CSC.',
    })
  })

  it('aviso que falha nao derruba o chamado', async () => {
    const chamadoAberto = vi.fn(async () => {
      throw new Error('SMTP fora do ar')
    })
    const r = await openTicket(deps({ chamadoAberto }), CTX, ENTRADA)
    expect(r.id).toBe('ch-1')
    expect(chamadoAberto).toHaveBeenCalledOnce()
  })

  it('sem aviso configurado, abre normalmente', async () => {
    const r = await openTicket(deps(), CTX, ENTRADA)
    expect(r.id).toBe('ch-1')
  })
})
