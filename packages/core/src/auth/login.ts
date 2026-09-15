import type { LoginInput, SelectCompanyInput, SessionOutput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { CompanyId, Channel, UserId } from '../context.js'
import type {
  IdentityProvider,
  LoginThrottle,
  SessionClaims,
  SessionIssuer,
  UserDirectory,
} from '../ports/identity.js'
import type { PlatformAdminAccess } from '../ports/platform-admin.js'

export type AuthDeps = {
  readonly provider: IdentityProvider
  readonly users: UserDirectory
  readonly sessions: SessionIssuer
  readonly throttle: LoginThrottle
  readonly audit: AuditTrail
  readonly platformAdmin: PlatformAdminAccess
}

/**
 * O que a borda sabe e o caso de uso nao descobre sozinho.
 *
 * Nao e `ExecutionContext`: no login nao existe principal ainda, e e
 * justamente ele que o login produz. Reaproveitar `ExecutionContext` aqui
 * exigiria inventar um `companyId` e um `role` antes de saber quais sao — o
 * tipo de contexto falso que depois alguem confunde com o de verdade.
 */
export type LoginMeta = {
  readonly requestId: string
  /** Para desacelerar por origem, e nao so por identificador — RF-120. */
  readonly origin: string
  readonly channel: Channel
  readonly now: Date
}

/** Quanto tempo a sessao vale. */
export const DURACAO_DA_SESSAO_HORAS = 12

/**
 * A MESMA mensagem para todas as falhas de login — RF-120.
 *
 * Credencial errada, usuario que nao existe, usuario desativado e usuario sem
 * nenhuma loja ativa respondem isto, palavra por palavra. Qualquer diferenca
 * entre elas e um oraculo: quem quer descobrir se um e-mail esta cadastrado
 * manda um login com senha errada e le a resposta.
 */
const FALHA_DE_LOGIN = 'E-mail, telefone ou senha incorretos.'

/**
 * Autentica e devolve a sessao — RF-119, RF-120.
 *
 * ## A ordem das operacoes e a protecao
 *
 * O provedor e chamado **antes** de olharmos nossas tabelas, e isso e
 * deliberado. O caminho intuitivo — procurar o usuario primeiro e so chamar o
 * provedor se ele existir — responde muito mais rapido para e-mail
 * desconhecido, porque nao paga a verificacao da credencial. Esse tempo e a
 * resposta: da para enumerar a base cronometrando.
 *
 * Chamando o provedor sempre, todo login errado custa o mesmo trabalho.
 *
 * ## Zero, uma ou varias lojas
 *
 * Nenhuma loja ativa responde `FALHA_DE_LOGIN`, e nao "voce nao tem empresa":
 * a segunda confirma que a conta existe.
 *
 * Uma loja ja entra nela — obrigar a escolher entre uma opcao e cerimonia.
 *
 * Varias devolvem sessao com `activeCompanyId` nulo, e nenhuma rota de negocio
 * funciona ate `selectCompany`. E o "escolho qual empresa operar" da US-059, e
 * o motivo de o tipo da sessao ser uniao: sem empresa nao ha papel.
 */
export async function login(
  deps: AuthDeps,
  input: LoginInput,
  meta: LoginMeta,
): Promise<SessionOutput> {
  await recusaSeDesacelerado(deps, [chaveDeIdentificador(input.identifier), chaveDeOrigem(meta)])

  const identidade = await deps.provider.verify(input)

  if (identidade === undefined) {
    await registraFalha(deps, input, meta)
    throw AppError.unauthorized(FALHA_DE_LOGIN)
  }

  const usuario = await resolveUsuario(deps, identidade)

  /* Usuario desativado cai aqui junto com usuario inexistente. Sao situacoes
     diferentes para nos e a mesma para quem esta do outro lado. */
  if (usuario === undefined || !usuario.isActive) {
    await registraFalha(deps, input, meta)
    throw AppError.unauthorized(FALHA_DE_LOGIN)
  }

  const vinculos = await deps.users.listMemberships(usuario.id)

  /*
   * Conferido SEMPRE, e nao so para quem nao tem loja — ADR-0007.
   *
   * Antes esta checagem so rodava no ramo `vinculos.length === 0`, apoiada na
   * ideia de que "o modelo nao deixa a mesma pessoa ser as duas coisas". A
   * premissa nao se sustenta: nao existe caminho nenhum no produto para criar
   * uma conta SEM loja — o cadastro sempre cria empresa, e o convite sempre
   * cria vinculo. Ou seja, o Super Admin sem loja que a regra pressupunha nao
   * tem como nascer.
   *
   * O efeito pratico era pior que teorico: quem era dono de loja E Super Admin
   * recebia `isPlatformAdmin: false` no login e nunca era levado ao painel,
   * embora a api o autorizasse normalmente — as rotas de `/admin` consultam a
   * tabela a cada requisicao. A sessao dizia uma coisa e a autorizacao dizia
   * outra.
   *
   * O custo e uma consulta indexada por login. Barato para o que compra.
   */
  const ehSuperAdmin = await deps.platformAdmin.isPlatformAdmin(usuario.id)

  if (vinculos.length === 0 && !ehSuperAdmin) {
    await registraFalha(deps, input, meta)
    throw AppError.unauthorized(FALHA_DE_LOGIN)
  }

  await deps.throttle.clear(chaveDeIdentificador(input.identifier))
  await deps.throttle.clear(chaveDeOrigem(meta))

  const unico = vinculos.length === 1 ? vinculos[0]! : undefined

  const claims: SessionClaims =
    unico === undefined
      ? { userId: usuario.id, companyId: null }
      : { userId: usuario.id, companyId: unico.companyId, role: unico.role }

  const expiraEm = new Date(meta.now.getTime() + DURACAO_DA_SESSAO_HORAS * 3_600_000)
  const token = await deps.sessions.issue(claims, expiraEm)

  if (unico !== undefined) {
    await registraEntrada(deps, unico.companyId, usuario.id, meta)
  }

  return {
    token,
    expiresAt: expiraEm.toISOString(),
    userId: usuario.id,
    userName: usuario.name,
    memberships: [...vinculos],
    activeCompanyId: unico?.companyId ?? null,
    isPlatformAdmin: ehSuperAdmin,
  }
}

/**
 * Escolhe a loja a operar e emite a sessao definitiva — RF-119.
 *
 * O vinculo e conferido **agora**, contra o banco, e nao contra a lista que o
 * login devolveu. Entre o login e a escolha o acesso pode ter sido revogado, e
 * confiar na lista de antes deixaria uma janela de doze horas em que quem foi
 * desligado ainda entra.
 *
 * ## O token anterior e REVOGADO
 *
 * Antes de haver onde revogar, cada escolha de loja deixava o token velho vivo
 * pelas doze horas restantes. Quem opera cinco lojas e troca durante o dia
 * acumulava uma credencial valida por troca, nenhuma delas na mao de ninguem —
 * e a de `companyId: null` continuava podendo escolher loja de novo.
 *
 * Revoga o token que foi APRESENTADO, e nenhum outro: sessao de outro aparelho
 * tem token proprio e nao e afetada. Trocar de loja no celular nao pode
 * deslogar o computador.
 */
export async function selectCompany(
  deps: AuthDeps,
  sessao: SessionClaims,
  input: SelectCompanyInput,
  meta: LoginMeta,
  tokenAnterior: string,
): Promise<SessionOutput> {
  const vinculo = await deps.users.findMembership(input.companyId, sessao.userId)

  /* NOT_FOUND e nao FORBIDDEN: 403 confirmaria que a loja existe para quem
     chutou um id — a mesma regra de recurso de outro tenant. */
  if (vinculo === undefined) throw AppError.notFound('Loja não encontrada.')

  const vinculos = await deps.users.listMemberships(sessao.userId)
  const usuario = await deps.users.findById(sessao.userId)

  /* Conta desativada entre o login e a escolha da loja: o token continua
     valido por doze horas, e sem esta conferencia ele ainda escolheria loja. */
  if (usuario === undefined || !usuario.isActive) {
    throw AppError.unauthorized('Sua conta não está mais ativa.')
  }

  const expiraEm = new Date(meta.now.getTime() + DURACAO_DA_SESSAO_HORAS * 3_600_000)
  const token = await deps.sessions.issue(
    { userId: sessao.userId, companyId: vinculo.companyId, role: vinculo.role },
    expiraEm,
  )

  /*
   * DEPOIS de emitir o novo, nunca antes: se a emissao falhar entre os dois
   * passos, a pessoa fica com o token antigo — que ainda funciona — em vez de
   * com nenhum. Revogar primeiro trocaria uma falha recuperavel por um logout
   * que ninguem pediu.
   */
  await deps.sessions.revoke(tokenAnterior)

  await registraEntrada(deps, vinculo.companyId, sessao.userId, meta)

  return {
    token,
    expiresAt: expiraEm.toISOString(),
    userId: sessao.userId,
    userName: usuario.name,
    memberships: [...vinculos],
    activeCompanyId: vinculo.companyId,
    /* Escolher uma loja propria nao deixa de ser Super Admin: as duas coisas
       coexistem, e dizer `false` aqui faria a tela perder o caminho do painel
       logo depois de a pessoa entrar na propria loja. */
    isPlatformAdmin: await deps.platformAdmin.isPlatformAdmin(sessao.userId),
  }
}

/**
 * Sair — RF-119.
 *
 * ## Sair nao encerrava nada
 *
 * Os dois clientes apagavam o token do proprio armazenamento: o web limpava o
 * cookie, o mobile apagava o `SecureStore`. O servidor nunca soube, e o token
 * continuava valido pelas doze horas restantes. Quem tivesse copiado o token —
 * aparelho emprestado, navegador de balcao compartilhado, extrato de um log
 * antigo — seguia dentro depois de a pessoa clicar em "Sair".
 *
 * Nao dava para consertar antes desta tarefa: com o emissor em memoria, o unico
 * jeito de invalidar um token era reiniciar o processo, que invalidava todos.
 *
 * ## Nao devolve nada, e nao falha
 *
 * Do ponto de vista de quem clicou, sair sempre da certo. O cliente navega para
 * o login de qualquer jeito — e e melhor que ele o faca do que ficar preso numa
 * tela pedindo para tentar sair de novo.
 *
 * ## A trilha so registra quando ha empresa
 *
 * Mesma razao de `registraEntrada`: a auditoria e organizada sob a empresa, e
 * sessao sem loja escolhida nao tem uma sob a qual gravar. Inventar uma
 * quebraria o isolamento da propria trilha.
 */
export async function logout(
  deps: AuthDeps,
  sessao: SessionClaims,
  token: string,
  meta: LoginMeta,
): Promise<void> {
  await deps.sessions.revoke(token)

  if (sessao.companyId === null) return

  await deps.audit.record({
    companyId: sessao.companyId,
    entity: 'User',
    entityId: sessao.userId,
    action: 'session_ended',
    actorId: sessao.userId,
    channel: meta.channel,
    occurredAt: meta.now,
    before: null,
    after: { requestId: meta.requestId },
  })
}

/**
 * Acha o usuario local pela identidade externa.
 *
 * Duas passadas, e a segunda e o primeiro login de quem foi convidado: o
 * convite criou a linha em `users` com o e-mail, sem `subject` — so quando a
 * pessoa entra pela primeira vez existe `subject` para guardar. Sem esse
 * caminho, todo convidado receberia `FALHA_DE_LOGIN` na estreia.
 */
async function resolveUsuario(
  deps: AuthDeps,
  identidade: { subject: string; email: string | null; phone: string | null },
) {
  const porSubject = await deps.users.findBySubject(identidade.subject)
  if (porSubject !== undefined) return porSubject

  const porContato =
    (identidade.email === null ? undefined : await deps.users.findByEmail(identidade.email)) ??
    (identidade.phone === null ? undefined : await deps.users.findByPhone(identidade.phone))

  if (porContato === undefined) return undefined

  await deps.users.attachSubject(porContato.id, identidade.subject)
  return porContato
}

async function recusaSeDesacelerado(deps: AuthDeps, chaves: readonly string[]): Promise<void> {
  for (const chave of chaves) {
    const segundos = await deps.throttle.retryAfter(chave)
    if (segundos !== undefined) {
      throw AppError.rateLimited(
        `Muitas tentativas. Tente de novo em ${segundos} ${segundos === 1 ? 'segundo' : 'segundos'}.`,
      )
    }
  }
}

async function registraFalha(deps: AuthDeps, input: LoginInput, meta: LoginMeta): Promise<void> {
  await deps.throttle.registerFailure(chaveDeIdentificador(input.identifier), meta.now)
  await deps.throttle.registerFailure(chaveDeOrigem(meta), meta.now)
}

/**
 * Contamos por identificador **e** por origem, e as duas contas existem por
 * motivos opostos.
 *
 * Por identificador barra quem tenta mil senhas numa conta. Por origem barra
 * quem tenta uma senha em mil contas — o ataque que a contagem por
 * identificador nao ve, porque cada conta recebe uma tentativa so.
 *
 * O preco de contar por identificador e conhecido: da para trancar alguem fora
 * de proposito, errando a senha dele. E aceitavel porque o bloqueio e por
 * tempo e nao permanente, e o contrario — nao desacelerar — entrega a base a
 * forca bruta.
 */
function chaveDeIdentificador(identifier: string): string {
  return `login:id:${identifier.toLowerCase()}`
}

function chaveDeOrigem(meta: LoginMeta): string {
  return `login:origem:${meta.origin}`
}

/**
 * Entrada auditada sob a EMPRESA, que e como a auditoria e organizada.
 *
 * Por isso o registro sai aqui e nao no comeco do login: enquanto a loja nao
 * esta escolhida nao existe empresa sob a qual gravar, e inventar uma
 * quebraria o isolamento da propria trilha. Tentativa recusada nao vai para a
 * trilha por motivo pior: gravariamos `company_id` de quem falhou o login,
 * que e justamente o que ainda nao se sabe.
 */
async function registraEntrada(
  deps: AuthDeps,
  companyId: CompanyId,
  userId: UserId,
  meta: LoginMeta,
): Promise<void> {
  await deps.audit.record({
    companyId,
    entity: 'User',
    entityId: userId,
    action: 'session_started',
    actorId: userId,
    channel: meta.channel,
    occurredAt: meta.now,
    before: null,
    after: { requestId: meta.requestId },
  })
}
