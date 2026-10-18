import { chamarApi } from './api'

/**
 * O quadro de CRM — NR-109.
 *
 * Este modulo era inteiro de mentira: `listarCards()` montava o quadro a
 * partir de contatos e pendencias de `mock-data`, e mover coluna era um
 * `await delay(...)` seguido de sucesso — nada era gravado.
 *
 * A tela do celular so LISTA e MOVE (ver `app/(app)/crm.tsx`) — nao ha
 * formulario de criacao nem comentario aqui, entao so essas duas acoes tem
 * chamada real. Se um dia a tela ganhar as outras, `criarCard`/`comentarCard`
 * do web (`apps/web/src/lib/crm-api.ts`) sao o modelo.
 *
 * `origem` (o card veio de Clientes, do Financeiro ou foi lancado no CRM) e
 * `responsaveis: string[]` do mock nao existem mais: nao ha sincronizacao
 * automatica com outros modulos neste recorte, e o formulario sempre
 * escolheu UMA pessoa — ver a migration 0011 em `packages/db`.
 */

export type ColunaId = 'afazer' | 'andamento' | 'concluido'

export const COLUNAS: { id: ColunaId; titulo: string; descricao: string }[] = [
  { id: 'afazer', titulo: 'A fazer', descricao: 'Entrou e ainda não foi tratado' },
  { id: 'andamento', titulo: 'Em andamento', descricao: 'Alguém está cuidando' },
  { id: 'concluido', titulo: 'Concluído', descricao: 'Resolvido' },
]

export type TipoCard = 'pendencia' | 'contato'

export type CardCrm = {
  id: string
  titulo: string
  descricao: string
  tipo: TipoCard
  coluna: ColunaId
  clienteId: string | null
  clienteNome: string | null
  data: string
  responsavelNome: string | null
  comentarios: Comentario[]
}

export type Comentario = { id: string; autor: string; data: string; texto: string }

type ResultadoCrm<T> = { ok: true; dados: T } | { ok: false; erro: string }

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
  authorName: string | null
  text: string
  createdAt: string
}

const paraComentario = (c: ComentarioDaApi): Comentario => ({
  id: c.id,
  autor: c.authorName ?? 'Alguém da equipe',
  data: c.createdAt,
  texto: c.text,
})

type CardDaApi = {
  id: string
  title: string
  description: string | null
  kind: TipoDaApi
  column: ColunaDaApi
  customerId: string | null
  customerName: string | null
  dueOn: string
  assigneeName: string | null
  comments: ComentarioDaApi[]
}

const paraCard = (c: CardDaApi): CardCrm => ({
  id: c.id,
  titulo: c.title,
  descricao: c.description ?? '',
  tipo: PARA_TIPO[c.kind],
  coluna: PARA_COLUNA[c.column],
  clienteId: c.customerId,
  clienteNome: c.customerName,
  data: c.dueOn,
  responsavelNome: c.assigneeName,
  comentarios: c.comments.map(paraComentario),
})

/* -------------------------------------------------------------------------- */
/* Leitura e acoes                                                            */
/* -------------------------------------------------------------------------- */

export async function listarCards(): Promise<ResultadoCrm<CardCrm[]>> {
  const r = await chamarApi<{ cards: CardDaApi[] }>('/crm/cards')
  return r.ok ? { ok: true, dados: r.dados.cards.map(paraCard) } : { ok: false, erro: r.message }
}

export async function moverCard(id: string, coluna: ColunaId): Promise<ResultadoCrm<CardCrm>> {
  const r = await chamarApi<CardDaApi>(`/crm/cards/${id}`, {
    method: 'PATCH',
    body: { column: DA_COLUNA[coluna] },
  })
  return r.ok ? { ok: true, dados: paraCard(r.dados) } : { ok: false, erro: r.message }
}

export type DadosCard = {
  titulo: string
  descricao: string
  tipo: TipoCard
  clienteId: string | null
  /** AAAA-MM-DD. */
  data: string
  responsavelId: string | null
}

export async function criarCard(dados: DadosCard): Promise<ResultadoCrm<CardCrm>> {
  const r = await chamarApi<CardDaApi>('/crm/cards', {
    method: 'POST',
    body: {
      title: dados.titulo.trim(),
      ...(dados.descricao.trim() === '' ? {} : { description: dados.descricao.trim() }),
      kind: DO_TIPO[dados.tipo],
      ...(dados.clienteId === null ? {} : { customerId: dados.clienteId }),
      dueOn: dados.data,
      ...(dados.responsavelId === null ? {} : { assigneeUserId: dados.responsavelId }),
    },
  })
  return r.ok ? { ok: true, dados: paraCard(r.dados) } : { ok: false, erro: r.message }
}

export async function comentarCard(id: string, texto: string): Promise<ResultadoCrm<Comentario>> {
  const r = await chamarApi<ComentarioDaApi>(`/crm/cards/${id}/comentarios`, {
    method: 'POST',
    body: { text: texto.trim() },
  })
  return r.ok ? { ok: true, dados: paraComentario(r.dados) } : { ok: false, erro: r.message }
}

export type MembroDaEquipe = { id: string; nome: string }

/** Quem pode ser responsavel por um card — a equipe da loja. */
export async function listarEquipe(): Promise<MembroDaEquipe[]> {
  const r = await chamarApi<{ members: { id: string; name: string }[] }>('/equipe')
  return r.ok ? r.dados.members.map((m) => ({ id: m.id, nome: m.name })) : []
}
