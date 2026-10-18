import type {
  OpenTicketInput,
  ReplyToTicketInput,
  TicketDetail,
  TicketListOutput,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { SupportRepository } from '../ports/support-repository.js'

export type SupportDeps = {
  readonly support: SupportRepository
  /** O nome de quem escreve, para a conversa dizer quem falou. */
  readonly quemEscreve: (ctx: ExecutionContext) => Promise<string>
}

/**
 * Chamados de suporte — NR-080, US-062.
 *
 * A tela existia inteira sobre `lib/mock-data`: o lojista abria um chamado, via
 * a confirmacao com protocolo, e nada era gravado. O badge de "resposta nova"
 * contava mensagens de uma conversa inventada.
 */

/**
 * A lista, com os dois numeros que as telas precisam.
 *
 * Leitura: sem `assertCanWrite`. Qualquer pessoa da loja pode ver os chamados
 * dela — inclusive o `accountant`, que e quem mais abre chamado sobre nota.
 *
 * `open` e `unread` sao somados AQUI e nao no banco. Nao e economia: sao dois
 * numeros derivados da mesma lista que ja veio, e uma segunda consulta para
 * conta-los poderia responder sobre um estado diferente do que a tela mostra —
 * "3 em aberto" acima de uma lista com quatro.
 */
export async function listTickets(
  deps: SupportDeps,
  ctx: ExecutionContext,
): Promise<TicketListOutput> {
  const tickets = await deps.support.list(ctx.companyId)

  return {
    tickets: [...tickets],
    open: tickets.filter((t) => t.status !== 'closed').length,
    unread: tickets.reduce((soma, t) => soma + t.unread, 0),
  }
}

export async function getTicket(
  deps: SupportDeps,
  ctx: ExecutionContext,
  ticketId: string,
): Promise<TicketDetail> {
  const chamado = await deps.support.findById(ctx.companyId, ticketId)

  if (chamado === undefined) {
    throw AppError.notFound('Chamado não encontrado.')
  }

  return chamado
}

/**
 * Abrir chamado — US-062.
 *
 * `assertCanWrite` porque abrir chamado CRIA um registro que a equipe vai
 * atender. Nao e leitura, e um papel somente-leitura nao deveria conseguir
 * gerar trabalho para outra pessoa.
 */
export async function openTicket(
  deps: SupportDeps,
  ctx: ExecutionContext,
  input: OpenTicketInput,
): Promise<TicketDetail> {
  assertCanWrite(ctx)

  return deps.support.open({
    companyId: ctx.companyId,
    subject: input.subject,
    category: input.category,
    body: input.body,
    attachment: input.attachment ?? null,
    authorName: await deps.quemEscreve(ctx),
    createdBy: ctx.userId,
    createdAt: ctx.now,
  })
}

export async function replyToTicket(
  deps: SupportDeps,
  ctx: ExecutionContext,
  input: ReplyToTicketInput,
): Promise<TicketDetail> {
  assertCanWrite(ctx)

  const chamado = await deps.support.reply({
    companyId: ctx.companyId,
    ticketId: input.ticketId,
    body: input.body,
    attachment: input.attachment ?? null,
    authorName: await deps.quemEscreve(ctx),
    createdAt: ctx.now,
  })

  if (chamado === undefined) {
    throw AppError.notFound('Chamado não encontrado.')
  }

  return chamado
}

/**
 * Marca lido ao abrir o detalhe — e devolve o chamado JA sem as nao lidas.
 *
 * Marcar e devolver na mesma chamada, e nao em duas: a tela abre o detalhe uma
 * vez so, e duas idas fariam o badge piscar — ele apagaria depois que a
 * conversa ja apareceu.
 *
 * Sem `assertCanWrite`: marcar como lido e consequencia de LER, e exigir papel
 * de escrita faria o `accountant` abrir o chamado e o badge nunca apagar.
 */
export async function readTicket(
  deps: SupportDeps,
  ctx: ExecutionContext,
  ticketId: string,
): Promise<TicketDetail> {
  const chamado = await getTicket(deps, ctx, ticketId)

  await deps.support.markRead(ctx.companyId, ticketId, ctx.now)

  return { ...chamado, unread: 0 }
}
