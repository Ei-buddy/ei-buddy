import type { MembershipOutput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import type { SessionClaims, UserDirectory } from '../ports/identity.js'
import type { PlatformAdminAccess } from '../ports/platform-admin.js'
import type { CompanyRepository } from '../ports/registration-repositories.js'

export type ProfileDeps = {
  readonly users: UserDirectory
  /**
   * So para o caso do Super Admin — ADR-0007.
   *
   * Quem entrou numa empresa via `auth_session_enter_company` tem
   * `claims.companyId` preenchido mas NENHUM vinculo em `company_users`: o
   * nome da loja nao sai de `vinculos` porque nao ha vinculo nenhum para
   * achar. `findById` sob a MESMA politica de RLS (o `company_id` do
   * contexto ja aponta para a empresa certa) resolve sem precisar de um
   * caminho novo — RLS nao liga para COMO a pessoa chegou naquele tenant.
   */
  readonly companies: CompanyRepository
  /**
   * Para o perfil dizer se a conta e Super Admin — NR-122.
   *
   * A navegacao do app monta a secao da plataforma a partir deste campo, e
   * nao de uma rota administrativa chamada "para ver se responde": perguntar
   * por erro (403) e caro e faz a barra piscar a cada carregamento.
   */
  readonly platformAdmin: PlatformAdminAccess
}

/**
 * Quem esta usando o sistema, e em qual loja — NR-013, RF-119.
 *
 * ## Por que nao serve o `/auth/me`
 *
 * `SessionClaims` carrega apenas IDs: `userId`, `companyId`, `role`. E assim de
 * proposito — o token nao guarda nome, senao um lojista que renomeia a loja
 * continuaria vendo o nome antigo ate a sessao expirar.
 *
 * Mas a barra do topo precisa do NOME. Enquanto nao havia por onde busca-lo, a
 * tela mostrava "Marina Alves / Mercearia Sol Nascente" fixo no codigo: toda
 * loja via o nome da mesma pessoa inventada. Este caso de uso e o "chame a rota
 * do recurso" que o comentario de `/auth/me` ja mandava fazer.
 */
export type Profile = {
  readonly userId: string
  readonly userName: string
  /** Nulo enquanto a pessoa nao escolheu loja — US-059. */
  readonly activeCompanyId: string | null
  readonly companyName: string | null
  readonly role: MembershipOutput['role'] | null
  /** Todas as lojas a que ela tem acesso, para o seletor de loja. */
  readonly memberships: readonly MembershipOutput[]
  /**
   * Esta sessao esta "dentro" de uma empresa via Super Admin — ADR-0007.
   *
   * Derivado de `empresaSemVinculo`, e nao de uma consulta propria: quem
   * opera a PROPRIA loja sempre tem vinculo em `company_users`; chegar aqui
   * com empresa ativa e SEM vinculo so acontece por
   * `auth_session_enter_company`. O sinal ja estava disponivel de graca.
   */
  readonly isImpersonating: boolean
  /**
   * Acesso a plataforma inteira — ADR-0007.
   *
   * Eixo diferente de `role`: aquele e o papel DENTRO da loja ativa, este
   * atravessa todas. Um dono de loja pode ser Super Admin e continuar dono;
   * as duas coisas convivem na mesma sessao, e e por isso que a barra mostra
   * os dois blocos para ele.
   */
  readonly isPlatformAdmin: boolean
}

export async function loadProfile(deps: ProfileDeps, claims: SessionClaims): Promise<Profile> {
  const usuario = await deps.users.findById(claims.userId)

  if (usuario === undefined) {
    /*
     * Sessao valida apontando para usuario que sumiu.
     *
     * Acontece quando alguem e removido da empresa com a sessao aberta. 401 e
     * nao 404: o problema nao e "esse recurso nao existe", e sim "esta sessao
     * nao vale mais" — e a tela precisa mandar a pessoa para o login, nao
     * mostrar um erro que ela nao pode resolver.
     */
    throw AppError.unauthorized('Sua sessao nao vale mais. Entre de novo.')
  }

  const vinculos = await deps.users.listMemberships(usuario.id)

  /*
   * O nome da loja sai dos VINCULOS quando ha um, e nao de uma leitura de
   * `companies` — os vinculos ja vem com o nome, e ler `companies` de novo
   * seria uma segunda ida ao banco para um dado que ja esta na mao. A lista
   * inteira e necessaria de qualquer jeito: quem tem acesso a mais de uma
   * loja precisa do seletor (US-059). So quando NAO ha vinculo (`empresaSemVinculo`
   * abaixo) e que a leitura direta entra — ver o comentario em `ProfileDeps`.
   */
  const ativo =
    claims.companyId === null ? undefined : vinculos.find((v) => v.companyId === claims.companyId)

  /* Sessao com empresa mas sem vinculo: so acontece em modo Super Admin. */
  const empresaSemVinculo =
    claims.companyId !== null && ativo === undefined
      ? await deps.companies.findById(claims.companyId)
      : undefined

  return {
    userId: usuario.id,
    userName: usuario.name,
    activeCompanyId: claims.companyId,
    companyName: ativo?.companyName ?? empresaSemVinculo?.tradeName ?? null,
    /*
     * O papel vem do VINCULO e nao das claims quando os dois existem.
     *
     * Se o papel da pessoa mudou depois de a sessao ser emitida, o do vinculo e
     * o atual. As claims continuam mandando na autorizacao — trocar isso aqui
     * seria decidir permissao numa leitura de apresentacao —, mas o que a tela
     * MOSTRA deve ser o de agora.
     *
     * Sem vinculo (Super Admin), nao ha "o de agora" para buscar — so existe
     * o das claims mesmo, que e sempre `owner` enquanto ele estiver "dentro"
     * de uma empresa (ADR-0007).
     */
    role: ativo?.role ?? (claims.companyId === null ? null : claims.role),
    memberships: vinculos,
    isImpersonating: empresaSemVinculo !== undefined,
    isPlatformAdmin: await deps.platformAdmin.isPlatformAdmin(usuario.id),
  }
}
