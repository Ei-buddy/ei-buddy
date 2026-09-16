import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import {
  FakeIdentityProvider,
  InMemoryPlatformAdminAccess,
  InMemorySessionIssuer,
  InMemoryUserDirectory,
} from './fakes.js'
import {
  enterCompany,
  exitCompany,
  grantPlatformAdmin,
  revokePlatformAdmin,
  listCompanies,
  listPlatformAdmins,
  listPlatformUsers,
  type PlatformAdminDeps,
} from './platform-admin.js'

/**
 * Casos de uso do Super Admin — ADR-0007, RF-131.
 *
 * O que se prova aqui: "core confere ANTES de repassar" — cada operacao
 * recusa quem nao e Super Admin sem sequer chamar a porta de verdade.
 */

function cenario() {
  const users = new InMemoryUserDirectory()
  const sessions = new InMemorySessionIssuer()
  const provider = new FakeIdentityProvider()
  const access = new InMemoryPlatformAdminAccess({
    aoEntrar: (token, companyId) => {
      const claims = sessions.claimsDe(token)
      if (claims === undefined) return
      sessions.sobrescreverClaims(token, { userId: claims.userId, companyId, role: 'owner' })
    },
    aoSair: (token) => {
      const claims = sessions.claimsDe(token)
      if (claims === undefined) return
      sessions.sobrescreverClaims(token, { userId: claims.userId, companyId: null })
    },
  })

  const deps: PlatformAdminDeps = { access, sessions, users, registrar: provider }
  return { deps, access, sessions, users, provider }
}

const EMPRESA = 'empresa-super-admin'

describe('entrar numa empresa — ADR-0007', () => {
  it('recusa quem nao e Super Admin', async () => {
    const { deps, sessions } = cenario()
    const token = await sessions.issue({ userId: 'usr-comum', companyId: null }, futuro())

    const erro = await pegaErro(() =>
      enterCompany(deps, { userId: 'usr-comum', companyId: null }, token, {
        companyId: EMPRESA,
        justification: 'Investigando um chamado de suporte',
      }),
    )

    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
  })

  it('Super Admin entra: a sessao passa a valer como owner da empresa', async () => {
    const { deps, sessions, access } = cenario()
    access.tornarSuperAdmin('usr-admin')
    access.adicionarEmpresa({
      id: EMPRESA,
      legalName: 'Loja X',
      tradeName: null,
      cnpj: '00000000000000',
      isActive: true,
      createdAt: new Date().toISOString(),
    })

    const token = await sessions.issue({ userId: 'usr-admin', companyId: null }, futuro())

    const claims = await enterCompany(deps, { userId: 'usr-admin', companyId: null }, token, {
      companyId: EMPRESA,
      justification: 'Cliente pediu ajuda no chat de suporte',
    })

    expect(claims).toEqual({ userId: 'usr-admin', companyId: EMPRESA, role: 'owner' })
    expect(access.acessosRegistrados()).toEqual([
      { token, companyId: EMPRESA, justification: 'Cliente pediu ajuda no chat de suporte' },
    ])
  })
})

describe('sair do modo Super Admin', () => {
  it('devolve a sessao ao estado sem empresa', async () => {
    const { deps, sessions, access } = cenario()
    access.tornarSuperAdmin('usr-admin')
    access.adicionarEmpresa({
      id: EMPRESA,
      legalName: 'Loja X',
      tradeName: null,
      cnpj: '00000000000000',
      isActive: true,
      createdAt: new Date().toISOString(),
    })
    const token = await sessions.issue({ userId: 'usr-admin', companyId: null }, futuro())
    await enterCompany(deps, { userId: 'usr-admin', companyId: null }, token, {
      companyId: EMPRESA,
      justification: 'Justificativa valida para o teste',
    })

    const claims = await exitCompany(deps, token)

    expect(claims).toEqual({ userId: 'usr-admin', companyId: null })
  })
})

describe('a visao geral da plataforma', () => {
  it('recusa listar empresas para quem nao e Super Admin', async () => {
    const { deps } = cenario()

    const erro = await pegaErro(() => listCompanies(deps, 'usr-comum'))
    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
  })

  it('recusa listar Super Admins para quem nao e um', async () => {
    const { deps } = cenario()

    const erro = await pegaErro(() => listPlatformAdmins(deps, 'usr-comum'))
    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
  })
})

describe('conceder Super Admin', () => {
  it('recusa quando quem concede nao e Super Admin', async () => {
    const { deps } = cenario()

    const erro = await pegaErro(() =>
      grantPlatformAdmin(deps, 'usr-comum', { email: 'daniel@exemplo.com' }),
    )
    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
  })

  it('quem ja tem conta so ganha a capacidade — sem senha temporaria', async () => {
    const { deps, access, users } = cenario()
    access.tornarSuperAdmin('usr-admin')
    const existente = users.adicionarUsuario({ name: 'Daniel', email: 'daniel@exemplo.com' })

    const resultado = await grantPlatformAdmin(deps, 'usr-admin', { email: 'daniel@exemplo.com' })

    expect(resultado).toEqual({ userId: existente.id, created: false })
    expect(await access.isPlatformAdmin(existente.id)).toBe(true)
  })

  it('e-mail novo: cria a conta, concede, e devolve a senha temporaria UMA vez', async () => {
    const { deps, access, users } = cenario()
    access.tornarSuperAdmin('usr-admin')

    const resultado = await grantPlatformAdmin(deps, 'usr-admin', {
      email: 'novo-admin@exemplo.com',
      name: 'Novo Admin',
    })

    expect(resultado.created).toBe(true)
    expect(resultado.temporaryPassword).toBeDefined()
    expect(resultado.temporaryPassword!.length).toBeGreaterThan(10)
    expect(await access.isPlatformAdmin(resultado.userId)).toBe(true)

    const criado = await users.findByEmail('novo-admin@exemplo.com')
    expect(criado?.name).toBe('Novo Admin')
  })
})

/**
 * Revogar Super Admin — ADR-0007.
 *
 * A funcao SQL existia desde a migration 0008 e nunca teve caminho ate a
 * tela: dava para conceder o maior privilegio do sistema e nao dava para
 * tirar. O que se prova aqui e a regra que impede o tiro no proprio pe.
 */
describe('revogar Super Admin', () => {
  it('quem nao e Super Admin nao revoga ninguem', async () => {
    const { deps, access } = cenario()
    access.tornarSuperAdmin('admin-1')

    const erro = await pegaErro(() => revokePlatformAdmin(deps, 'qualquer-um', 'admin-1'))

    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
    /* E o alvo continua Super Admin: a recusa nao pode ter efeito colateral. */
    expect(await access.isPlatformAdmin('admin-1')).toBe(true)
  })

  it('Super Admin revoga outro', async () => {
    const { deps, access } = cenario()
    access.tornarSuperAdmin('admin-1')
    access.tornarSuperAdmin('admin-2')

    await revokePlatformAdmin(deps, 'admin-1', 'admin-2')

    expect(await access.isPlatformAdmin('admin-2')).toBe(false)
    expect(await access.isPlatformAdmin('admin-1')).toBe(true)
  })

  it('ninguem revoga a si mesmo — e o que impede a plataforma ficar sem dono', async () => {
    const { deps, access } = cenario()
    access.tornarSuperAdmin('admin-1')

    const erro = await pegaErro(() => revokePlatformAdmin(deps, 'admin-1', 'admin-1'))

    /*
     * Sem esta guarda, o ultimo Super Admin restante deixa a plataforma sem
     * ninguem que possa administrar, e a volta e o script de bootstrap com
     * acesso ao banco de producao.
     */
    expect(isAppError(erro) && erro.code).toBe('VALIDATION_FAILED')
    expect(await access.isPlatformAdmin('admin-1')).toBe(true)
  })

  it('revogar quem nao e Super Admin avisa, em vez de fingir sucesso', async () => {
    const { deps, access } = cenario()
    access.tornarSuperAdmin('admin-1')

    const erro = await pegaErro(() => revokePlatformAdmin(deps, 'admin-1', 'nao-e-admin'))

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })
})

function futuro(): Date {
  return new Date(Date.now() + 3_600_000)
}

async function pegaErro(fn: () => Promise<unknown>) {
  try {
    await fn()
    return undefined
  } catch (e) {
    return e
  }
}

/**
 * A lista de usuarios da plataforma — NR-121.
 *
 * O que ela resolve: promover deixou de exigir saber o e-mail exato de cor.
 * O que ela NAO pode virar: uma lista que qualquer conta logada abre — quem
 * tem todos os e-mails da base tem metade de um ataque pronto.
 */
describe('usuarios da plataforma', () => {
  const PESSOA = {
    userId: 'usuario-1',
    name: 'Marta do Caixa',
    email: 'marta@loja.local',
    isActive: true,
    createdAt: '2026-09-01T12:00:00.000Z',
    lastAccessAt: '2026-09-15T09:00:00.000Z',
    companies: [{ companyId: EMPRESA, name: 'Mercearia Sol', role: 'staff' as const }],
  }

  const FILTRO = { page: 1, pageSize: 50 }

  it('o Super Admin ve quem tem conta, com as lojas de cada um', async () => {
    const { deps, access } = cenario()
    access.tornarSuperAdmin('admin-1')
    access.adicionarUsuario(PESSOA)

    const r = await listPlatformUsers(deps, 'admin-1', FILTRO)

    expect(r.total).toBe(1)
    expect(r.users[0]?.email).toBe('marta@loja.local')
    expect(r.users[0]?.companies[0]?.role).toBe('staff')
  })

  it('quem nao e Super Admin nao ve a base de usuarios', async () => {
    const { deps, access } = cenario()
    access.adicionarUsuario(PESSOA)

    const erro = await pegaErro(() => listPlatformUsers(deps, 'qualquer-um', FILTRO))

    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
  })

  it('diz quem ja e Super Admin — e o que a tela usa para escolher o perfil', async () => {
    const { deps, access } = cenario()
    access.tornarSuperAdmin('admin-1')
    access.adicionarUsuario(PESSOA)
    access.adicionarUsuario({ ...PESSOA, userId: 'admin-1', email: 'admin@plataforma.local' })

    const r = await listPlatformUsers(deps, 'admin-1', FILTRO)

    const porEmail = new Map(r.users.map((u) => [u.email, u.isPlatformAdmin]))
    expect(porEmail.get('admin@plataforma.local')).toBe(true)
    expect(porEmail.get('marta@loja.local')).toBe(false)
  })

  it('busca por nome ou e-mail', async () => {
    const { deps, access } = cenario()
    access.tornarSuperAdmin('admin-1')
    access.adicionarUsuario(PESSOA)
    access.adicionarUsuario({ ...PESSOA, userId: 'u-2', name: 'Joao', email: 'joao@loja.local' })

    const porNome = await listPlatformUsers(deps, 'admin-1', { ...FILTRO, q: 'marta' })
    const porEmail = await listPlatformUsers(deps, 'admin-1', { ...FILTRO, q: 'joao@' })

    expect(porNome.users).toHaveLength(1)
    expect(porEmail.users[0]?.name).toBe('Joao')
  })

  it('devolve o total real, e nao o tamanho da pagina', async () => {
    const { deps, access } = cenario()
    access.tornarSuperAdmin('admin-1')
    for (let i = 0; i < 5; i += 1) {
      access.adicionarUsuario({ ...PESSOA, userId: `u-${i}`, email: `u${i}@loja.local` })
    }

    const r = await listPlatformUsers(deps, 'admin-1', { page: 1, pageSize: 2 })

    expect(r.users).toHaveLength(2)
    expect(r.total).toBe(5)
  })
})
