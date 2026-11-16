import { pedir, type Resultado } from './http'

/**
 * O quadro de CRM — NR-109.
 *
 * Este modulo era inteiro de mentira: `listarCards()` montava o quadro a
 * partir de contatos e pendencias de `mock-data`, e criar card, mover coluna
 * e comentar eram `await delay(...)` seguidos de sucesso — nada era gravado, e
 * o quadro voltava aos mesmos tres cartoes de exemplo a cada abertura.
 *
 * Os nomes em portugues e o formato do modelo ficaram — a traducao do que vem
 * da api acontece na BORDA, aqui embaixo (mesmo padrao de `suporte-api.ts`).
 *
 * DUAS COISAS QUE O MOCK TINHA E O BACKEND NAO TEM, DE PROPOSITO:
 *
 * - `origem` (o card veio de Clientes, do Financeiro ou foi lancado aqui):
 *   nao ha sincronizacao automatica com outros modulos neste recorte. Todo
 *   card hoje nasce no CRM, entao o campo deixou de existir — mante-lo so
 *   diria sempre a mesma coisa.
 * - `responsaveis: string[]`: o formulario sempre escolheu UMA pessoa. Virou
 *   `responsavelId`/`responsavelNome`, um par id+nome do jeito que
 *   `GET /equipe` devolve.
 */

export type ColunaId = 'afazer' | 'andamento' | 'concluido'

export const COLUNAS: { id: ColunaId; titulo: string; descricao: string }[] = [
  { id: 'afazer', titulo: 'A fazer', descricao: 'Entrou e ainda não foi tratado' },
  { id: 'andamento', titulo: 'Em andamento', descricao: 'Alguém está cuidando' },
  { id: 'concluido', titulo: 'Concluído', descricao: 'Resolvido' },
]

export type TipoCard = 'pendencia' | 'contato'

export type Comentario = {
  id: string
  autor: string
  data: string
  texto: string
}

export type CardCrm = {
  id: string
  titulo: string
  descricao: string
  tipo: TipoCard
  coluna: ColunaId
  clienteId: string | null
  clienteNome: string | null
  data: string
  responsavelId: string | null
  responsavelNome: string | null
  comentarios: Comentario[]
  criadoEm: string
}

/* -------------------------------------------------------------------------- */
/* Traducao na borda                                                          */
/* -------------------------------------------------------------------------- */

type ColunaDaApi = 'todo' | 'doing' | 'done'
type TipoDaApi = 'task' | 'contact'

const PARA_COLUNA: Record<ColunaDaApi, ColunaId> = {
  todo: 'afazer',
  doing: 'andamento',
  done: 'concluido',
}
const DA_COLUNA: Record<ColunaId, ColunaDaApi> = {
  afazer: 'todo',
  andamento: 'doing',
  concluido: 'done',
}
const PARA_TIPO: Record<TipoDaApi, TipoCard> = { task: 'pendencia', contact: 'contato' }
const DO_TIPO: Record<TipoCard, TipoDaApi> = { pendencia: 'task', contato: 'contact' }

type ComentarioDaApi = {
  id: string
  authorId: string | null
  authorName: string | null
  text: string
  createdAt: string
}

type CardDaApi = {
  id: string
  title: string
  description: string | null
  kind: TipoDaApi
  column: ColunaDaApi
  customerId: string | null
  customerName: string | null
  dueOn: string
  assigneeUserId: string | null
  assigneeName: string | null
  comments: ComentarioDaApi[]
  createdAt: string
}

const paraComentario = (c: ComentarioDaApi): Comentario => ({
  id: c.id,
  autor: c.authorName ?? 'Alguém da equipe',
  data: c.createdAt,
  texto: c.text,
})

const paraCard = (c: CardDaApi): CardCrm => ({
  id: c.id,
  titulo: c.title,
  descricao: c.description ?? '',
  tipo: PARA_TIPO[c.kind],
  coluna: PARA_COLUNA[c.column],
  clienteId: c.customerId,
  clienteNome: c.customerName,
  data: c.dueOn,
  responsavelId: c.assigneeUserId,
  responsavelNome: c.assigneeName,
  comentarios: c.comments.map(paraComentario),
  criadoEm: c.createdAt,
})

/* -------------------------------------------------------------------------- */
/* Leitura                                                                    */
/* -------------------------------------------------------------------------- */

export async function listarCards(): Promise<Resultado<CardCrm[]>> {
  const r = await pedir<{ cards: CardDaApi[] }>('/api/crm/cards')
  return r.ok ? { ok: true, dados: r.dados.cards.map(paraCard) } : r
}

/* -------------------------------------------------------------------------- */
/* Acoes                                                                      */
/* -------------------------------------------------------------------------- */

export type DadosCard = {
  titulo: string
  descricao: string
  tipo: TipoCard
  /**
   * O id de um cliente REAL, ou nulo. Nao ha campo para nome digitado sem
   * cadastro: o card so guarda cliente quando ele existe de verdade, do
   * contrario o vinculo nao teria onde ser salvo.
   */
  clienteId: string | null
  data: string
  responsavelId: string | null
}

export async function criarCard(dados: DadosCard): Promise<Resultado<CardCrm>> {
  const r = await pedir<CardDaApi>('/api/crm/cards', {
    method: 'POST',
    body: JSON.stringify({
      title: dados.titulo.trim(),
      ...(dados.descricao.trim() === '' ? {} : { description: dados.descricao.trim() }),
      kind: DO_TIPO[dados.tipo],
      ...(dados.clienteId === null ? {} : { customerId: dados.clienteId }),
      dueOn: dados.data,
      ...(dados.responsavelId === null ? {} : { assigneeUserId: dados.responsavelId }),
    }),
  })

  return r.ok ? { ok: true, dados: paraCard(r.dados) } : r
}

export async function moverCard(id: string, coluna: ColunaId): Promise<Resultado<CardCrm>> {
  const r = await pedir<CardDaApi>(`/api/crm/cards/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ column: DA_COLUNA[coluna] }),
  })

  return r.ok ? { ok: true, dados: paraCard(r.dados) } : r
}

/** Exclui o card e os comentarios dele — NR-213. */
export async function excluirCard(id: string): Promise<Resultado<null>> {
  const r = await pedir<unknown>(`/api/crm/cards/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return r.ok ? { ok: true, dados: null } : r
}

export async function comentarCard(id: string, texto: string): Promise<Resultado<Comentario>> {
  const r = await pedir<ComentarioDaApi>(`/api/crm/cards/${id}/comentarios`, {
    method: 'POST',
    body: JSON.stringify({ text: texto.trim() }),
  })

  return r.ok ? { ok: true, dados: paraComentario(r.dados) } : r
}
