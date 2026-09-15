import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ExecutionContext } from '../context.js'
import { InMemoryCompanyRepository } from '../registration/fakes.js'
import {
  FakeIdentityProvider,
  InMemoryLoginThrottle,
  InMemoryPlatformAdminAccess,
  InMemorySessionIssuer,
  InMemoryUserDirectory,
  TENTATIVAS_ATE_DESACELERAR,
} from './fakes.js'
import { inviteUser } from './invite-user.js'
import { DURACAO_DA_SESSAO_HORAS, login, logout, selectCompany, type LoginMeta } from './login.js'
import { loadProfile } from './profile.js'

const AGORA = new Date('2026-09-03T12:00:00.000Z')

function meta(over: Partial<LoginMeta> = {}): LoginMeta {
  return { requestId: 'req-1', origin: '203.0.113.7', channel: 'app', now: AGORA, ...over }
}

function contexto(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: 'empresa-1',
    userId: 'usr-1',
    role: 'owner',
    channel: 'app',
    requestId: 'req-1',
    now: AGORA,
    ...over,
  }
}

function cenario() {
  const provider = new FakeIdentityProvider()
  const users = new InMemoryUserDirectory()
  const sessions = new InMemorySessionIssuer()
  const throttle = new InMemoryLoginThrottle()
  const audit = new InMemoryAuditTrail()
  const companies = new InMemoryCompanyRepository()
  const platformAdmin = new InMemoryPlatformAdminAccess({
    aoEntrar: () => undefined,
    aoSair: () => undefined,
  })
  return {
    deps: { provider, users, sessions, throttle, audit, platformAdmin, companies },
    provider,
    users,
    sessions,
    throttle,
    audit,
    platformAdmin,
    companies,
  }
}

/** Uma pessoa, uma loja, credencial que funciona. */
function comUmaLoja() {
  const c = cenario()
  const u = c.users.adicionarUsuario({ name: 'Ana', email: 'ana@loja.com', subject: 'sub-ana' })
  c.users.adicionarVinculo({ companyId: 'empresa-1', userId: u.id, role: 'owner' })
  c.provider.registrar('ana@loja.com', 'senha-certa', { subject: 'sub-ana', email: 'ana@loja.com' })
  return { ...c, usuario: u }
}

const credencial = { identifier: 'ana@loja.com', secret: 'senha-certa' }

async function pegaErro(fn: () => Promise<unknown>) {
  try {
    await fn()
    return undefined
  } catch (e) {
    return e
  }
}

/**
 * Dono de loja que TAMBEM e Super Admin — ADR-0007.
 *
 * O modelo pressupunha que as duas coisas nunca coexistiam, e o login so
 * conferia `isPlatformAdmin` para quem nao tinha loja. Mas nao ha caminho no
 * produto para criar conta sem loja: o cadastro sempre cria empresa. Na
 * pratica, TODO Super Admin e dono de alguma coisa — e a sessao dizia que
 * nao, enquanto a api o autorizava normalmente.
 */
describe('login de quem e dono E Super Admin — ADR-0007', () => {
  it('a sessao diz que e Super Admin, mesmo tendo loja', async () => {
    const c = comUmaLoja()
    c.platformAdmin.tornarSuperAdmin(c.usuario.id)

    const s = await login(c.deps, credencial, meta())

    /* Antes vinha `false` aqui, e a tela nunca oferecia o painel. */
    expect(s.isPlatformAdmin).toBe(true)
    /* E continua entrando na propria loja: uma coisa nao tira a outra. */
    expect(s.activeCompanyId).toBe('empresa-1')
  })

  it('quem tem loja e NAO e Super Admin continua marcado como nao', async () => {
    const c = comUmaLoja()

    const s = await login(c.deps, credencial, meta())

    expect(s.isPlatformAdmin).toBe(false)
  })

  it('escolher a propria loja nao apaga o acesso ao painel', async () => {
    const c = cenario()
    const u = c.users.adicionarUsuario({ name: 'Dono', email: 'dono@loja.com', subject: 'sub-d' })
    c.users.adicionarVinculo({ companyId: 'empresa-1', userId: u.id, role: 'owner' })
    c.users.adicionarVinculo({ companyId: 'empresa-2', userId: u.id, role: 'owner' })
    c.provider.registrar('dono@loja.com', 'senha-certa', {
      subject: 'sub-d',
      email: 'dono@loja.com',
    })
    c.platformAdmin.tornarSuperAdmin(u.id)

    const s = await login(c.deps, { identifier: 'dono@loja.com', secret: 'senha-certa' }, meta())
    const escolhida = await selectCompany(
      c.deps,
      { userId: u.id, companyId: null },
      { companyId: 'empresa-1', token: s.token },
      meta(),
    )

    /* `false` fixo aqui fazia a tela perder o caminho do painel logo depois
       de a pessoa entrar na propria loja. */
    expect(escolhida.isPlatformAdmin).toBe(true)
  })
})

describe('login — RF-119', () => {
  it('entra direto na loja quando existe uma so', async () => {
    const { deps, usuario } = comUmaLoja()

    const s = await login(deps, credencial, meta())

    expect(s.activeCompanyId).toBe('empresa-1')
    expect(s.userId).toBe(usuario.id)
    expect(s.memberships).toHaveLength(1)
  })

  it('a sessao emitida carrega empresa e papel', async () => {
    const { deps, sessions, usuario } = comUmaLoja()

    const s = await login(deps, credencial, meta())

    expect(sessions.claimsDe(s.token)).toEqual({
      userId: usuario.id,
      companyId: 'empresa-1',
      role: 'owner',
    })
  })

  it('a sessao expira em doze horas', async () => {
    const { deps, sessions } = comUmaLoja()

    const s = await login(deps, credencial, meta())

    expect(sessions.expiracaoDe(s.token)!.getTime()).toBe(
      AGORA.getTime() + DURACAO_DA_SESSAO_HORAS * 3_600_000,
    )
  })

  /* US-059: "escolho qual empresa operar". Sem empresa ativa, e o tipo da
     sessao diz que sem empresa nao ha papel. */
  it('nao escolhe loja por conta propria quando ha varias', async () => {
    const { deps, users, sessions, provider } = cenario()
    const u = users.adicionarUsuario({ name: 'Contador', email: 'c@x.com', subject: 'sub-c' })
    users.adicionarVinculo({ companyId: 'empresa-1', userId: u.id, role: 'accountant' })
    users.adicionarVinculo({ companyId: 'empresa-2', userId: u.id, role: 'accountant' })
    provider.registrar('c@x.com', 'ok', { subject: 'sub-c', email: 'c@x.com' })

    const s = await login(deps, { identifier: 'c@x.com', secret: 'ok' }, meta())

    expect(s.activeCompanyId).toBeNull()
    expect(s.memberships).toHaveLength(2)
    expect(sessions.claimsDe(s.token)).toEqual({ userId: u.id, companyId: null })
  })

  it('so lista os vinculos ativos', async () => {
    const { deps, users, provider } = cenario()
    const u = users.adicionarUsuario({ name: 'Bia', email: 'b@x.com', subject: 'sub-b' })
    users.adicionarVinculo({ companyId: 'empresa-1', userId: u.id, role: 'staff' })
    users.adicionarVinculo({ companyId: 'empresa-2', userId: u.id, role: 'staff' })
    users.revogar('empresa-2', u.id)
    provider.registrar('b@x.com', 'ok', { subject: 'sub-b', email: 'b@x.com' })

    const s = await login(deps, { identifier: 'b@x.com', secret: 'ok' }, meta())

    expect(s.memberships.map((m) => m.companyId)).toEqual(['empresa-1'])
    expect(s.activeCompanyId).toBe('empresa-1')
  })

  it('registra a entrada na auditoria da loja', async () => {
    const { deps, audit, usuario } = comUmaLoja()

    await login(deps, credencial, meta())

    const [entrada] = audit.daEmpresa('empresa-1')
    expect(entrada!.entityId).toBe(usuario.id)
    expect(entrada!.action).toBe('session_started')
  })

  /* Sem empresa escolhida nao existe empresa sob a qual gravar, e inventar uma
     quebraria o isolamento da propria trilha. */
  it('nao audita entrada enquanto a loja nao foi escolhida', async () => {
    const { deps, users, provider, audit } = cenario()
    const u = users.adicionarUsuario({ name: 'Contador', email: 'c@x.com', subject: 'sub-c' })
    users.adicionarVinculo({ companyId: 'empresa-1', userId: u.id, role: 'accountant' })
    users.adicionarVinculo({ companyId: 'empresa-2', userId: u.id, role: 'accountant' })
    provider.registrar('c@x.com', 'ok', { subject: 'sub-c', email: 'c@x.com' })

    await login(deps, { identifier: 'c@x.com', secret: 'ok' }, meta())

    expect(audit.daEmpresa('empresa-1')).toHaveLength(0)
    expect(audit.daEmpresa('empresa-2')).toHaveLength(0)
  })

  /*
   * O convidado nasce em `users` sem `subject`, porque o provedor so conhece a
   * pessoa quando ela entra. Sem este caminho, todo convidado receberia falha
   * de login na estreia.
   */
  it('amarra o subject no primeiro login de quem foi convidado', async () => {
    const { deps, users, provider } = cenario()
    const u = users.adicionarUsuario({ name: 'Novo', email: 'novo@x.com', subject: null })
    users.adicionarVinculo({ companyId: 'empresa-1', userId: u.id, role: 'staff' })
    provider.registrar('novo@x.com', 'ok', { subject: 'sub-novo', email: 'novo@x.com' })

    const s = await login(deps, { identifier: 'novo@x.com', secret: 'ok' }, meta())

    expect(s.activeCompanyId).toBe('empresa-1')
    expect(users.subjectDe(u.id)).toBe('sub-novo')
  })

  it('acha por telefone quando o provedor confirma o telefone', async () => {
    const { deps, users, provider } = cenario()
    const u = users.adicionarUsuario({ name: 'Ze', phone: '41988887777', subject: null })
    users.adicionarVinculo({ companyId: 'empresa-1', userId: u.id, role: 'owner' })
    provider.registrar('41988887777', '123456', { subject: 'sub-ze', phone: '41988887777' })

    const s = await login(deps, { identifier: '41988887777', secret: '123456' }, meta())

    expect(s.userId).toBe(u.id)
  })
})

describe('nao revelar existencia de usuario — RF-120', () => {
  const MENSAGEM = 'E-mail, telefone ou senha incorretos.'

  /*
   * O ponto todo da RF-120: as quatro situacoes sao diferentes para nos e a
   * MESMA para quem esta do outro lado. Qualquer diferenca de redacao aqui e
   * um oraculo de enumeracao.
   */
  it('responde a mesma coisa para senha errada, usuario inexistente, conta desativada e sem loja', async () => {
    const mensagens: string[] = []

    // 1. senha errada
    const a = comUmaLoja()
    mensagens.push(
      String(
        (
          (await pegaErro(() =>
            login(a.deps, { ...credencial, secret: 'errada' }, meta()),
          )) as Error
        ).message,
      ),
    )

    // 2. credencial valida no provedor, sem usuario nosso
    const b = cenario()
    b.provider.registrar('fantasma@x.com', 'ok', { subject: 'sub-f', email: 'fantasma@x.com' })
    mensagens.push(
      String(
        (
          (await pegaErro(() =>
            login(b.deps, { identifier: 'fantasma@x.com', secret: 'ok' }, meta()),
          )) as Error
        ).message,
      ),
    )

    // 3. conta desativada
    const c = cenario()
    const inativo = c.users.adicionarUsuario({
      name: 'Ex',
      email: 'ex@x.com',
      subject: 'sub-ex',
      isActive: false,
    })
    c.users.adicionarVinculo({ companyId: 'empresa-1', userId: inativo.id, role: 'staff' })
    c.provider.registrar('ex@x.com', 'ok', { subject: 'sub-ex', email: 'ex@x.com' })
    mensagens.push(
      String(
        (
          (await pegaErro(() =>
            login(c.deps, { identifier: 'ex@x.com', secret: 'ok' }, meta()),
          )) as Error
        ).message,
      ),
    )

    // 4. usuario sem nenhuma loja ativa
    const d = cenario()
    const solto = d.users.adicionarUsuario({ name: 'Solto', email: 's@x.com', subject: 'sub-s' })
    d.users.adicionarVinculo({ companyId: 'empresa-1', userId: solto.id, role: 'staff' })
    d.users.revogar('empresa-1', solto.id)
    d.provider.registrar('s@x.com', 'ok', { subject: 'sub-s', email: 's@x.com' })
    mensagens.push(
      String(
        (
          (await pegaErro(() =>
            login(d.deps, { identifier: 's@x.com', secret: 'ok' }, meta()),
          )) as Error
        ).message,
      ),
    )

    expect(mensagens).toEqual([MENSAGEM, MENSAGEM, MENSAGEM, MENSAGEM])
  })

  it('toda falha de login responde UNAUTHORIZED', async () => {
    const { deps } = comUmaLoja()

    const erro = await pegaErro(() => login(deps, { ...credencial, secret: 'errada' }, meta()))

    expect(isAppError(erro) && erro.code).toBe('UNAUTHORIZED')
  })

  /*
   * A ordem das operacoes E a protecao. Procurar o usuario primeiro e so
   * chamar o provedor quando ele existe responde muito mais rapido para
   * identificador desconhecido, e esse tempo e a resposta.
   */
  it('chama o provedor mesmo para identificador desconhecido', async () => {
    const { deps, provider } = comUmaLoja()

    await pegaErro(() => login(deps, { identifier: 'ninguem@x.com', secret: 'x' }, meta()))

    expect(provider.chamadas).toBe(1)
  })

  it('conta a falha por identificador e por origem', async () => {
    const { deps, throttle } = comUmaLoja()

    await pegaErro(() => login(deps, { ...credencial, secret: 'errada' }, meta()))

    expect(throttle.falhasDe('login:id:ana@loja.com')).toBe(1)
    expect(throttle.falhasDe('login:origem:203.0.113.7')).toBe(1)
  })

  it('desacelera depois de tentativas repetidas', async () => {
    const { deps } = comUmaLoja()

    for (let i = 0; i < TENTATIVAS_ATE_DESACELERAR; i += 1) {
      await pegaErro(() => login(deps, { ...credencial, secret: 'errada' }, meta()))
    }

    const erro = await pegaErro(() => login(deps, credencial, meta()))

    expect(isAppError(erro) && erro.code).toBe('RATE_LIMITED')
  })

  it('a recusa por excesso diz quanto esperar', async () => {
    const { deps, throttle } = comUmaLoja()
    throttle.travar('login:id:ana@loja.com', 45)

    const erro = await pegaErro(() => login(deps, credencial, meta()))

    expect(isAppError(erro) && erro.message).toContain('45 segundos')
  })

  /*
   * Uma senha em mil contas e o ataque que a contagem por identificador nao
   * ve, porque cada conta recebe uma tentativa so.
   */
  it('desacelera por origem mesmo variando o identificador', async () => {
    const { deps, throttle } = comUmaLoja()
    throttle.travar('login:origem:203.0.113.7', 30)

    const erro = await pegaErro(() =>
      login(deps, { identifier: 'outro@x.com', secret: 'x' }, meta()),
    )

    expect(isAppError(erro) && erro.code).toBe('RATE_LIMITED')
  })

  /* Senao a pessoa se tranca fora sozinha depois de errar e acertar. */
  it('login certo zera o contador', async () => {
    const { deps, throttle } = comUmaLoja()
    await pegaErro(() => login(deps, { ...credencial, secret: 'errada' }, meta()))

    await login(deps, credencial, meta())

    expect(throttle.falhasDe('login:id:ana@loja.com')).toBe(0)
    expect(throttle.falhasDe('login:origem:203.0.113.7')).toBe(0)
  })

  it('nao chega ao provedor quando ja esta desacelerado', async () => {
    const { deps, provider, throttle } = comUmaLoja()
    throttle.travar('login:id:ana@loja.com', 60)

    await pegaErro(() => login(deps, credencial, meta()))

    expect(provider.chamadas).toBe(0)
  })
})

describe('escolher a loja — RF-119', () => {
  async function comDuasLojas() {
    const c = cenario()
    const u = c.users.adicionarUsuario({ name: 'Contador', email: 'c@x.com', subject: 'sub-c' })
    c.users.adicionarVinculo({ companyId: 'empresa-1', userId: u.id, role: 'accountant' })
    c.users.adicionarVinculo({ companyId: 'empresa-2', userId: u.id, role: 'staff' })
    c.provider.registrar('c@x.com', 'ok', { subject: 'sub-c', email: 'c@x.com' })
    const s = await login(c.deps, { identifier: 'c@x.com', secret: 'ok' }, meta())
    /* O TOKEN vem junto: `selectCompany` revoga o que foi apresentado, e um
       teste que inventasse um token aqui provaria a revogacao do token errado. */
    return { ...c, usuario: u, sessao: (await c.sessions.read(s.token))!, token: s.token }
  }

  it('emite sessao com a empresa e o papel daquela loja', async () => {
    const { deps, sessions, usuario, sessao, token } = await comDuasLojas()

    const s = await selectCompany(deps, sessao, { companyId: 'empresa-2' }, meta(), token)

    expect(s.activeCompanyId).toBe('empresa-2')
    expect(sessions.claimsDe(s.token)).toEqual({
      userId: usuario.id,
      companyId: 'empresa-2',
      role: 'staff',
    })
  })

  /*
   * Conferido contra o banco AGORA, e nao contra a lista que o login devolveu:
   * entre um e outro o acesso pode ter sido revogado, e confiar na lista antiga
   * deixaria uma janela de doze horas para quem foi desligado.
   */
  it('recusa loja cujo acesso foi revogado depois do login', async () => {
    const { deps, users, usuario, sessao, token } = await comDuasLojas()
    users.revogar('empresa-2', usuario.id)

    const erro = await pegaErro(() =>
      selectCompany(deps, sessao, { companyId: 'empresa-2' }, meta(), token),
    )

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })

  /* 403 confirmaria que a loja existe para quem chutou um id. */
  it('responde NOT_FOUND para loja de que a pessoa nunca fez parte', async () => {
    const { deps, sessao, token } = await comDuasLojas()

    const erro = await pegaErro(() =>
      selectCompany(deps, sessao, { companyId: 'empresa-alheia' }, meta(), token),
    )

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })

  it('registra a entrada na loja escolhida', async () => {
    const { deps, audit, sessao, token } = await comDuasLojas()

    await selectCompany(deps, sessao, { companyId: 'empresa-2' }, meta(), token)

    expect(audit.daEmpresa('empresa-2')).toHaveLength(1)
  })

  /*
   * O token de antes deixava de ser usado e continuava VALIDO pelas doze horas
   * restantes. Quem opera cinco lojas e troca durante o dia acumulava uma
   * credencial viva por troca, nenhuma delas na mao de ninguem.
   */
  it('revoga o token apresentado depois de emitir o novo', async () => {
    const { deps, sessions, sessao, token } = await comDuasLojas()

    const s = await selectCompany(deps, sessao, { companyId: 'empresa-2' }, meta(), token)

    expect(await sessions.read(token)).toBeUndefined()
    /* E o novo vale — revogar o velho nao pode levar o novo junto. */
    expect(await sessions.read(s.token)).not.toBeUndefined()
  })

  /* Falhar na escolha nao pode deslogar: a pessoa fica com o token que tinha. */
  it('nao revoga o token quando a loja e recusada', async () => {
    const { deps, sessions, sessao, token } = await comDuasLojas()

    await pegaErro(() => selectCompany(deps, sessao, { companyId: 'nao-existe' }, meta(), token))

    expect(await sessions.read(token)).not.toBeUndefined()
  })
})

describe('sair — RF-119', () => {
  async function logada() {
    const c = cenario()
    const u = c.users.adicionarUsuario({ name: 'Ana', email: 'ana@loja.com', subject: 'sub-a' })
    c.users.adicionarVinculo({ companyId: 'empresa-1', userId: u.id, role: 'owner' })
    c.provider.registrar('ana@loja.com', 'ok', { subject: 'sub-a', email: 'ana@loja.com' })
    const s = await login(c.deps, { identifier: 'ana@loja.com', secret: 'ok' }, meta())
    return { ...c, usuario: u, token: s.token, sessao: (await c.sessions.read(s.token))! }
  }

  /*
   * O comportamento que faltava. Os clientes apagavam o token do proprio
   * armazenamento e o servidor continuava aceitando ele — quem tivesse copiado
   * o token seguia dentro depois de a pessoa clicar em "Sair".
   */
  it('o token para de valer', async () => {
    const { deps, sessions, sessao, token } = await logada()

    await logout(deps, sessao, token, meta())

    expect(await sessions.read(token)).toBeUndefined()
  })

  it('registra a saida na trilha da empresa ativa', async () => {
    const { deps, audit, sessao, token } = await logada()

    await logout(deps, sessao, token, meta())

    const eventos = audit.daEmpresa('empresa-1')
    /* Entrada e saida: o login ja registrou a primeira. */
    expect(eventos).toHaveLength(2)
    /* O verbo mora em `action` desde a NR-087. Antes era `updated` com o nome
       real escondido em `after.event` — e "o que foi alterado neste usuario"
       devolvia logins. */
    expect(eventos.at(-1)?.action).toBe('session_ended')
    expect(eventos.at(-1)?.after).toMatchObject({ requestId: 'req-1' })
  })

  /*
   * Sessao sem loja escolhida nao tem empresa sob a qual gravar, e inventar uma
   * quebraria o isolamento da propria trilha. O token, ainda assim, para de
   * valer — que e o que "sair" promete.
   */
  it('sem loja escolhida, revoga sem registrar na trilha', async () => {
    const c = cenario()
    const u = c.users.adicionarUsuario({ name: 'Contador', email: 'c@x.com', subject: 'sub-c' })
    c.users.adicionarVinculo({ companyId: 'empresa-1', userId: u.id, role: 'accountant' })
    c.users.adicionarVinculo({ companyId: 'empresa-2', userId: u.id, role: 'staff' })
    c.provider.registrar('c@x.com', 'ok', { subject: 'sub-c', email: 'c@x.com' })

    const s = await login(c.deps, { identifier: 'c@x.com', secret: 'ok' }, meta())
    const claims = (await c.sessions.read(s.token))!
    expect(claims.companyId).toBeNull()

    await logout(c.deps, claims, s.token, meta())

    expect(await c.sessions.read(s.token)).toBeUndefined()
    expect(c.audit.daEmpresa('empresa-1')).toHaveLength(0)
  })

  /* Sair duas vezes e sair: o segundo clique nao pode virar erro. */
  it('e idempotente', async () => {
    const { deps, sessao, token } = await logada()

    await logout(deps, sessao, token, meta())
    await logout(deps, sessao, token, meta())

    expect(true).toBe(true)
  })
})

describe('convidar usuario — RF-005', () => {
  function comOwner() {
    const c = cenario()
    const dono = c.users.adicionarUsuario({ name: 'Dona', email: 'dona@x.com', subject: 'sub-d' })
    c.users.adicionarVinculo({ companyId: 'empresa-1', userId: dono.id, role: 'owner' })
    return { ...c, ctx: contexto({ userId: dono.id }) }
  }

  const convite = { name: 'Novo Funcionario', email: 'novo@x.com', role: 'staff' as const }

  it('cria a pessoa e o vinculo', async () => {
    const { deps, users, ctx } = comOwner()

    const r = await inviteUser(deps, ctx, convite)

    expect(r.created).toBe(true)
    expect(await users.findMembership('empresa-1', r.userId)).toMatchObject({ role: 'staff' })
  })

  it('nasce sem subject — quem prova a identidade e o provedor, no primeiro login', async () => {
    const { deps, users, ctx } = comOwner()

    const r = await inviteUser(deps, ctx, convite)

    expect(users.subjectDe(r.userId)).toBeNull()
  })

  /*
   * O contador que atende cinco lojas e uma pessoa so. Criar uma linha por
   * loja daria a ele cinco identidades e cinco historicos de auditoria.
   */
  it('da vinculo novo a quem ja existe, sem criar outra pessoa', async () => {
    const { deps, users, ctx } = comOwner()
    const antes = users.quantosUsuarios()
    users.adicionarUsuario({ name: 'Contador', email: 'contador@x.com', subject: 'sub-c' })

    const r = await inviteUser(deps, ctx, {
      name: 'Contador',
      email: 'contador@x.com',
      role: 'accountant',
    })

    expect(r.created).toBe(false)
    expect(users.quantosUsuarios()).toBe(antes + 1)
  })

  it('acha quem ja existe mesmo com caixa diferente no e-mail', async () => {
    const { deps, users, ctx } = comOwner()
    users.adicionarUsuario({ name: 'Contador', email: 'contador@x.com', subject: 'sub-c' })

    const r = await inviteUser(deps, ctx, {
      name: 'Contador',
      email: 'CONTADOR@x.com',
      role: 'accountant',
    })

    expect(r.created).toBe(false)
  })

  it('recusa convidar quem ja tem acesso a esta loja', async () => {
    const { deps, ctx } = comOwner()
    await inviteUser(deps, ctx, convite)

    const erro = await pegaErro(() => inviteUser(deps, ctx, convite))

    expect(isAppError(erro) && erro.code).toBe('CONFLICT')
  })

  it('recusa dar acesso a conta desativada', async () => {
    const { deps, users, ctx } = comOwner()
    users.adicionarUsuario({ name: 'Ex', email: 'ex@x.com', isActive: false })

    const erro = await pegaErro(() =>
      inviteUser(deps, ctx, { name: 'Ex', email: 'ex@x.com', role: 'staff' }),
    )

    expect(isAppError(erro) && erro.code).toBe('CONFLICT')
  })

  it('registra o convite na auditoria sem guardar o contato', async () => {
    const { deps, audit, ctx } = comOwner()

    const r = await inviteUser(deps, ctx, convite)

    const [entrada] = audit.daEmpresa('empresa-1')
    expect(entrada!.entityId).toBe(r.userId)
    expect(entrada!.action).toBe('access_granted')
    expect(entrada!.after).toEqual({ role: 'staff', userCreated: true })
    /* A trilha e imutavel (RF-124) e a exclusao da LGPD nao alcanca o que nao
       pode ser apagado. Contato pessoal ali seria copia intocavel. */
    expect(JSON.stringify(entrada!.after)).not.toContain('novo@x.com')
  })

  /*
   * Defeito encontrado ao implementar o repositorio: a porta tinha
   * `insertUser` e `insertMembership` separados. Usuario gravado sem vinculo
   * nao entra — login com zero vinculos responde falha — e ainda ocupa o
   * e-mail no indice unico, o que faz a segunda tentativa de convite responder
   * "esta pessoa ja existe". O convite viraria impossivel pela tela.
   */
  it('nao deixa pessoa sem acesso quando o vinculo falha', async () => {
    const { deps, users, ctx } = comOwner()
    const antes = users.quantosUsuarios()
    users.falharAoDarAcesso = true

    await pegaErro(() => inviteUser(deps, ctx, convite))

    expect(users.quantosUsuarios()).toBe(antes)
    expect(await users.findByEmail('novo@x.com')).toBeUndefined()
  })

  it('staff nao convida — operar a loja nao e decidir quem entra nela', async () => {
    const { deps, ctx } = comOwner()

    const erro = await pegaErro(() => inviteUser(deps, { ...ctx, role: 'staff' }, convite))

    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
  })

  it('accountant nao convida', async () => {
    const { deps, ctx } = comOwner()

    const erro = await pegaErro(() => inviteUser(deps, { ...ctx, role: 'accountant' }, convite))

    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
  })

  /*
   * ADR-0002: convidar cria credencial nova, e criar credencial a partir de um
   * canal que o SIM swap entrega e escalada de privilegio — quem roubou o
   * numero convidaria a si mesmo como owner.
   */
  it('recusa convite pelo WhatsApp mesmo sendo o owner', async () => {
    const { deps, ctx } = comOwner()

    const erro = await pegaErro(() => inviteUser(deps, { ...ctx, channel: 'whatsapp' }, convite))

    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
    expect(isAppError(erro) && erro.message).toContain('aplicativo')
  })

  it('a recusa por canal diz qual operacao foi barrada', async () => {
    const { deps, ctx } = comOwner()

    const erro = await pegaErro(() => inviteUser(deps, { ...ctx, channel: 'whatsapp' }, convite))

    expect(isAppError(erro) && erro.message).toContain('Convidar usuario')
  })

  it('aceita convite por api e por job — sao canais fortes', async () => {
    const { deps, ctx } = comOwner()

    const r = await inviteUser(deps, { ...ctx, channel: 'api' }, convite)

    expect(r.created).toBe(true)
  })
})

describe('perfil de quem esta logado — NR-013, RF-119', () => {
  it('devolve o nome da pessoa e o da loja ativa', async () => {
    const c = comUmaLoja()

    const perfil = await loadProfile(c.deps, {
      userId: c.usuario.id,
      companyId: 'empresa-1',
      role: 'owner',
    })

    /* Os dois nomes juntos: e o que a barra do topo mostra, e antes disto ela
       mostrava "Marina Alves / Mercearia Sol Nascente" fixo no codigo. */
    expect(perfil.userName).toBe('Ana')
    expect(perfil.companyName).not.toBeNull()
    expect(perfil.activeCompanyId).toBe('empresa-1')
  })

  it('sessao sem loja escolhida devolve nome sem loja, e nao erro', async () => {
    const c = comUmaLoja()

    const perfil = await loadProfile(c.deps, { userId: c.usuario.id, companyId: null })

    /* Estado legitimo de quem tem acesso a mais de uma loja e ainda nao
       escolheu (US-059). A tela mostra o nome e pede a escolha. */
    expect(perfil.userName).toBe('Ana')
    expect(perfil.companyName).toBeNull()
    expect(perfil.role).toBeNull()
  })

  it('devolve todas as lojas, para o seletor', async () => {
    const c = comUmaLoja()
    c.users.adicionarVinculo({ companyId: 'empresa-2', userId: c.usuario.id, role: 'staff' })

    const perfil = await loadProfile(c.deps, {
      userId: c.usuario.id,
      companyId: 'empresa-1',
      role: 'owner',
    })

    expect(perfil.memberships).toHaveLength(2)
  })

  it('Super Admin sem vinculo: nome da empresa vem de companies, e isImpersonating e verdadeiro', async () => {
    const c = cenario()
    const superAdmin = c.users.adicionarUsuario({
      name: 'Super Admin',
      email: 'sa@plataforma.local',
    })
    c.companies.registros.set('empresa-x', {
      id: 'empresa-x',
      legalName: 'Loja X LTDA',
      tradeName: 'Loja X',
      cnpj: '00000000000000',
      email: 'x@x.com',
      phone: '41999990000',
      stateRegistration: null,
      municipalRegistration: null,
      businessSegment: null,
      address: {
        zipCode: null,
        street: null,
        number: null,
        complement: null,
        district: null,
        city: null,
        state: null,
      },
      createdAt: new Date().toISOString(),
    })

    const perfil = await loadProfile(c.deps, {
      userId: superAdmin.id,
      companyId: 'empresa-x',
      role: 'owner',
    })

    expect(perfil.companyName).toBe('Loja X')
    expect(perfil.role).toBe('owner')
    expect(perfil.isImpersonating).toBe(true)
  })

  it('dono de verdade da propria loja: isImpersonating e falso', async () => {
    const c = comUmaLoja()

    const perfil = await loadProfile(c.deps, {
      userId: c.usuario.id,
      companyId: 'empresa-1',
      role: 'owner',
    })

    expect(perfil.isImpersonating).toBe(false)
  })

  it('sessao apontando para usuario que sumiu e 401, e nao 404', async () => {
    const c = cenario()

    const erro = await pegaErro(() =>
      loadProfile(c.deps, { userId: 'usr-que-nao-existe', companyId: null }),
    )

    /* O problema nao e "esse recurso nao existe", e sim "esta sessao nao vale
       mais" — a tela precisa mandar para o login, e nao mostrar um erro que a
       pessoa nao pode resolver. */
    expect(isAppError(erro) && erro.code).toBe('UNAUTHORIZED')
  })
})
