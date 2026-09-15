import { randomBytes } from 'node:crypto'
import type {
  CompanyOverview,
  EnterCompanyInput,
  GrantPlatformAdminInput,
  PlatformAdminOutput,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import type { UserId } from '../context.js'
import type {
  IdentityRegistrar,
  SessionClaims,
  SessionIssuer,
  UserDirectory,
} from '../ports/identity.js'
import type { PlatformAdminAccess } from '../ports/platform-admin.js'

/**
 * Casos de uso do Super Admin — ADR-0007, RF-131.
 *
 * "Entrar" e "sair" nao inventam regra nenhuma: conferem `isPlatformAdmin` e
 * repassam para a porta, que e quem sabe gravar o acesso e trocar a sessao.
 * A regra de negocio de verdade daqui e uma so, e ela se repete: **ninguem
 * chega perto de `platformAdmin.*` sem `isPlatformAdmin` confirmado antes**.
 */

export type PlatformAdminDeps = {
  readonly access: PlatformAdminAccess
  readonly sessions: SessionIssuer
  readonly users: UserDirectory
  readonly registrar: IdentityRegistrar
}

const MSG_NAO_E_ADMIN = 'Esta conta nao tem acesso de Super Admin.'

async function exigirSuperAdmin(deps: PlatformAdminDeps, userId: UserId): Promise<void> {
  if (!(await deps.access.isPlatformAdmin(userId))) {
    throw AppError.forbidden(MSG_NAO_E_ADMIN)
  }
}

/**
 * Entra numa empresa. Devolve os claims JA ATUALIZADOS — o token nao muda,
 * so o que ele significa passa a ser outro.
 */
export async function enterCompany(
  deps: PlatformAdminDeps,
  sessao: SessionClaims,
  token: string,
  input: EnterCompanyInput,
): Promise<SessionClaims> {
  await exigirSuperAdmin(deps, sessao.userId)
  await deps.access.enterCompany(token, input.companyId, input.justification)

  const claims = await deps.sessions.read(token)
  if (claims === undefined) throw AppError.unauthorized()
  return claims
}

/** Sai do modo Super Admin. Devolve os claims ja no estado sem empresa. */
export async function exitCompany(deps: PlatformAdminDeps, token: string): Promise<SessionClaims> {
  await deps.access.exitCompany(token)

  const claims = await deps.sessions.read(token)
  if (claims === undefined) throw AppError.unauthorized()
  return claims
}

export async function listCompanies(
  deps: PlatformAdminDeps,
  requestedBy: UserId,
): Promise<readonly CompanyOverview[]> {
  await exigirSuperAdmin(deps, requestedBy)
  return deps.access.listCompanies(requestedBy)
}

export async function listPlatformAdmins(
  deps: PlatformAdminDeps,
  requestedBy: UserId,
): Promise<readonly PlatformAdminOutput[]> {
  await exigirSuperAdmin(deps, requestedBy)
  return deps.access.listAdmins(requestedBy)
}

export type GrantResult = {
  readonly userId: UserId
  readonly created: boolean
  /**
   * So presente quando `created`. Nao ha envio de e-mail no projeto hoje
   * (ADR-0007, "o que fica em aberto") — quem concede repassa esta senha por
   * fora, e a pessoa troca no primeiro acesso. Aparece UMA vez, na resposta
   * desta chamada; o sistema nao a guarda em lugar nenhum depois disto.
   */
  readonly temporaryPassword?: string
}

/** 16 bytes ao acaso, legiveis o bastante para copiar e colar por telefone. */
function gerarSenhaTemporaria(): string {
  return randomBytes(12).toString('base64url')
}

/**
 * Concede Super Admin — a alguem que ja tem conta, ou a alguem novo.
 *
 * As duas saidas sao legitimas e a diferenca e so o que a resposta carrega:
 * quem ja existe (o dono de uma loja, por exemplo) so ganha a capacidade
 * nova; quem nao existe ganha conta E capacidade, com uma senha temporaria
 * que so aparece esta vez.
 */
export async function grantPlatformAdmin(
  deps: PlatformAdminDeps,
  grantedBy: UserId,
  input: GrantPlatformAdminInput,
): Promise<GrantResult> {
  await exigirSuperAdmin(deps, grantedBy)

  const existente = await deps.users.findByEmail(input.email)

  if (existente !== undefined) {
    await deps.access.grant(existente.id, grantedBy)
    return { userId: existente.id, created: false }
  }

  const senhaTemporaria = gerarSenhaTemporaria()
  const identidade = await deps.registrar.register(
    { identifier: input.email, secret: senhaTemporaria },
    { email: input.email, phone: null },
  )

  if (identidade === undefined) {
    throw AppError.conflict('Nao foi possivel criar a credencial para este e-mail.')
  }

  const usuario = await deps.users.createUserWithoutCompany({
    name: input.name ?? input.email,
    email: input.email,
    createdAt: new Date(),
  })

  await deps.users.attachSubject(usuario.id, identidade.subject)
  await deps.access.grant(usuario.id, grantedBy)

  return { userId: usuario.id, created: true, temporaryPassword: senhaTemporaria }
}

/**
 * Tira o acesso de Super Admin — ADR-0007.
 *
 * ## Por que existe, e por que demorou
 *
 * A funcao `platform_admin_revoke` estava no banco desde a migration 0008, e
 * nunca teve caminho ate a tela: dava para CONCEDER o maior privilegio do
 * sistema e nao dava para tirar. Socio que sai da empresa, conta comprometida,
 * acesso concedido por engano — em todos, a unica saida era `UPDATE` a mao no
 * banco de producao.
 *
 * ## Por que ninguem revoga a si mesmo
 *
 * E a guarda que impede o sistema de ficar sem dono. Sem ela, o unico Super
 * Admin restante consegue, num clique, deixar a plataforma sem ninguem que
 * possa administrar — e a volta e o script de bootstrap com acesso ao banco de
 * producao.
 *
 * Com ela, sempre sobra pelo menos um: para sair, peca a outro Super Admin que
 * revogue voce. Isso tambem e melhor governanca — a saida fica registrada como
 * decisao de outra pessoa, com `revoked_by` verdadeiro.
 */
export async function revokePlatformAdmin(
  deps: PlatformAdminDeps,
  requestedBy: UserId,
  userId: UserId,
): Promise<void> {
  await exigirSuperAdmin(deps, requestedBy)

  if (requestedBy === userId) {
    throw AppError.validation('Voce nao pode revogar o proprio acesso. Peca a outro Super Admin.')
  }

  if (!(await deps.access.isPlatformAdmin(userId))) {
    /* Nao e erro de autorizacao: quem pediu E Super Admin. O alvo e que nao
       tem o acesso — e dizer isso e melhor que um sucesso silencioso sobre
       uma revogacao que nao revogou nada. */
    throw AppError.notFound('Esta conta nao e Super Admin.')
  }

  await deps.access.revoke(userId, requestedBy)
}
