import { pedir, type Resultado } from './http'

/**
 * A fila de chamados da plataforma — NR-215.
 *
 * Achado do QA: "Suporte — como enxergaremos os chamados?". Aqui a equipe
 * EiBuddy (Super Admin) ve os chamados de todas as lojas, responde como
 * "Suporte EiBuddy" e encerra. A loja ve a resposta no proprio Suporte, como
 * mensagem nao lida.
 */

export type SituacaoDaFila = 'responder' | 'aguardando' | 'encerrados' | 'todos'

export const ABAS_DA_FILA: { valor: SituacaoDaFila; rotulo: string }[] = [
  { valor: 'responder', rotulo: 'Para responder' },
  { valor: 'aguardando', rotulo: 'Aguardando cliente' },
  { valor: 'encerrados', rotulo: 'Encerrados' },
  { valor: 'todos', rotulo: 'Todos' },
]

export const ROTULO_CATEGORIA: Record<string, string> = {
  financeiro: 'Financeiro',
  cadastro: 'Cadastro',
  vendas: 'Vendas',
  tecnico: 'Técnico',
  outro: 'Outro',
}

export type ChamadoDaFila = {
  id: string
  companyId: string
  companyName: string
  protocol: string
  subject: string
  category: string
  status: 'open' | 'waiting' | 'closed'
  createdAt: string
  updatedAt: string
  lastAuthor: 'cliente' | 'suporte' | null
  messagesCount: number
}

export type MensagemDoChamado = {
  id: string
  author: 'cliente' | 'suporte'
  authorName: string
  body: string
  attachment: string | null
  createdAt: string
}

export type ChamadoAberto = ChamadoDaFila & { messages: MensagemDoChamado[] }

export type ContagensDaFila = { toAnswer: number; awaitingCustomer: number; closed: number }

export type PaginaDaFila = {
  tickets: ChamadoDaFila[]
  total: number
  page: number
  pageSize: number
  counts: ContagensDaFila
}

/** A situacao de UM chamado na fila — a mesma regra do banco. */
export function situacaoDoChamado(c: Pick<ChamadoDaFila, 'status' | 'lastAuthor'>): SituacaoDaFila {
  if (c.status === 'closed') return 'encerrados'
  return c.lastAuthor === 'suporte' ? 'aguardando' : 'responder'
}

/** Quantos em cada aba — "Todos" e a soma. */
export function contagemDaAba(c: ContagensDaFila, aba: SituacaoDaFila): number {
  switch (aba) {
    case 'responder':
      return c.toAnswer
    case 'aguardando':
      return c.awaitingCustomer
    case 'encerrados':
      return c.closed
    case 'todos':
      return c.toAnswer + c.awaitingCustomer + c.closed
  }
}

export const carregarFila = (situacao: SituacaoDaFila, pagina = 1) =>
  pedir<PaginaDaFila>(
    `/api/admin/chamados?${new URLSearchParams({ situation: situacao, page: String(pagina) })}`,
  )

export const abrirChamado = (id: string): Promise<Resultado<ChamadoAberto>> =>
  pedir(`/api/admin/chamados/${encodeURIComponent(id)}`)

export const responderChamado = (id: string, texto: string): Promise<Resultado<ChamadoAberto>> =>
  pedir(`/api/admin/chamados/${encodeURIComponent(id)}/respostas`, {
    method: 'POST',
    body: JSON.stringify({ body: texto.trim() }),
  })

export const encerrarChamado = (id: string): Promise<Resultado<ChamadoAberto>> =>
  pedir(`/api/admin/chamados/${encodeURIComponent(id)}/encerrar`, { method: 'POST' })
