import { chamarApi } from './api'

/**
 * A trilha de auditoria — RNF-031, as mesmas rotas do web.
 *
 * Quem agiu na loja e o que fez: a tela abre pelas pessoas e desce para a
 * trilha de cada uma.
 */

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string }

export type AcaoDaTrilha =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'cancelled'
  | 'access_granted'
  | 'anonymized'
  | 'data_export'
  | 'session_started'
  | 'session_ended'

export type RegistroDaTrilha = {
  id: string
  entity: string
  entityId: string
  action: AcaoDaTrilha
  actorId: string
  actorName: string | null
  channel: string
  occurredAt: string
}

export type PessoaDaTrilha = {
  actorId: string
  actorName: string | null
  entries: number
  lastActionAt: string
}

export const ROTULO_ACAO: Record<AcaoDaTrilha, string> = {
  created: 'Criou',
  updated: 'Alterou',
  deleted: 'Excluiu',
  cancelled: 'Cancelou',
  access_granted: 'Deu acesso',
  anonymized: 'Anonimizou',
  data_export: 'Exportou os dados',
  session_started: 'Entrou',
  session_ended: 'Saiu',
}

export const ROTULO_ENTIDADE: Record<string, string> = {
  Account: 'Plano de contas',
  BankStatement: 'Extrato bancário',
  Company: 'Empresa',
  Customer: 'Cliente',
  FixedCost: 'Custo fixo',
  VariableCost: 'Custo variável',
  Payable: 'Conta a pagar',
  Product: 'Produto',
  CrmCard: 'CRM',
  Appointment: 'Agenda',
  Receivable: 'Conta a receber',
  Sale: 'Venda',
  User: 'Acesso de usuário',
}

export const ROTULO_CANAL: Record<string, string> = {
  app: 'App ou site',
  whatsapp: 'WhatsApp',
  api: 'Integração',
  job: 'Automático',
}

export async function listarPessoasDaTrilha(): Promise<Resultado<PessoaDaTrilha[]>> {
  const r = await chamarApi<{ actors: PessoaDaTrilha[] }>('/auditoria/pessoas')
  return r.ok ? { ok: true, dados: r.dados.actors } : { ok: false, erro: r.message }
}

export async function listarTrilha(filtro: {
  actorId: string
  page: number
}): Promise<Resultado<{ entries: RegistroDaTrilha[]; total: number }>> {
  const query = new URLSearchParams({
    actorId: filtro.actorId,
    page: String(filtro.page),
    pageSize: '30',
  })
  const r = await chamarApi<{ entries: RegistroDaTrilha[]; total: number }>(
    `/auditoria?${query.toString()}`,
  )
  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}
