import { pedir, type Resultado } from './http'

/**
 * Trilha de auditoria contra a api — US-061.
 *
 * Tipos locais, e nao importados de `@na-regua/contracts`: o bundler do Next
 * nao resolve os imports `.js` do codigo-fonte daquele pacote em tempo de
 * execucao (mesma razao de `lib/legal.ts`).
 */

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
  /** Nulo quando quem agiu nao existe mais — a acao continua valendo. */
  actorName: string | null
  channel: string
  occurredAt: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

export type PaginaDaTrilha = {
  entries: RegistroDaTrilha[]
  total: number
  page: number
  pageSize: number
}

export type FiltroDaTrilha = {
  entity?: string
  actorId?: string
  action?: AcaoDaTrilha
  /** Instantes ISO — a tela converte o dia local antes de chamar. */
  from?: string
  to?: string
  page: number
  pageSize: number
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

/**
 * As entidades que hoje gravam na trilha.
 *
 * Nome do glossario (o que esta no banco) para o nome que o lojista usa. Uma
 * entidade nova que comece a gravar e nao esteja aqui aparece pelo nome
 * tecnico — feio, mas visivel, que e melhor que sumir da tela.
 */
export const ROTULO_ENTIDADE: Record<string, string> = {
  Account: 'Plano de contas',
  BankStatement: 'Extrato bancário',
  Company: 'Empresa',
  Customer: 'Cliente',
  FixedCost: 'Custo fixo',
  Payable: 'Conta a pagar',
  Product: 'Estoque',
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

export function listarTrilha(filtro: FiltroDaTrilha): Promise<Resultado<PaginaDaTrilha>> {
  const params = new URLSearchParams()
  for (const [chave, valor] of Object.entries(filtro)) {
    if (valor !== undefined && valor !== '') params.set(chave, String(valor))
  }
  return pedir(`/api/auditoria?${params.toString()}`)
}
