import type {
  CompanyOverview,
  PlatformAdminOutput,
  PlatformUser,
  PlatformUserQuery,
  Role,
} from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'

/**
 * Porta do Super Admin — ADR-0007, RF-131.
 *
 * "Entrar como" e a troca de sessao auditada que a ADR escolhe em vez de rota
 * paralela ou papel com `BYPASSRLS`: depois de `enterCompany`, a sessao vale
 * como `owner` daquela empresa, e toda porta de negocio que ja existe passa a
 * funcionar sem saber que quem esta do outro lado e Super Admin.
 */
export type PlatformAdminAccess = {
  /** Se esta pessoa pode entrar em qualquer empresa. */
  isPlatformAdmin(userId: UserId): Promise<boolean>

  /**
   * Entra numa empresa: grava o acesso (RF-131) e troca a sessao para
   * `role: 'owner'` daquela empresa.
   *
   * Lanca quando: a sessao nao pertence a um Super Admin, a justificativa e
   * curta demais, ou a empresa nao existe. `core` confere `isPlatformAdmin`
   * ANTES de chamar isto — a checagem aqui dentro e defesa em profundidade,
   * nao a primeira linha.
   */
  enterCompany(token: string, companyId: CompanyId, justification: string): Promise<void>

  /**
   * Sai do modo Super Admin: fecha o acesso e devolve a sessao ao estado sem
   * empresa. Lanca se a sessao nao estiver em modo Super Admin.
   */
  exitCompany(token: string): Promise<void>

  /** Toda empresa cadastrada, para o painel do Super Admin. */
  listCompanies(requestedBy: UserId): Promise<readonly CompanyOverview[]>

  /** Concede Super Admin a quem ja e Super Admin concedendo. */
  grant(userId: UserId, grantedBy: UserId): Promise<void>

  /**
   * Tira o acesso de Super Admin.
   *
   * A linha nao e apagada: ganha `revoked_by`/`revoked_at`. Quem teve o maior
   * privilegio do sistema e quando o perdeu e exatamente o que uma auditoria
   * precisa saber depois — apagar destruiria a resposta.
   */
  revoke(userId: UserId, revokedBy: UserId): Promise<void>

  /** Quem e Super Admin hoje. */
  listAdmins(requestedBy: UserId): Promise<readonly PlatformAdminOutput[]>

  /**
   * Toda pessoa com conta, com as lojas onde atua — NR-121.
   *
   * Separado de `listAdmins` porque responde a outra pergunta: aquele diz
   * quem JA tem o acesso, este diz a quem ele pode ser dado. Uma lista so
   * obrigaria a tela de promocao a adivinhar quem existe.
   */
  listUsers(
    requestedBy: UserId,
    filtro: PlatformUserQuery,
  ): Promise<{ readonly users: readonly PlatformUser[]; readonly total: number }>
}

/** O papel que uma sessao de Super Admin sempre assume ao entrar numa empresa. */
export const PAPEL_AO_ENTRAR: Role = 'owner'
