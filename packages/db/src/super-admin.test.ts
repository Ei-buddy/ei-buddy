import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createPlatformAdminAccess } from './platform-admin-repository.js'
import { createSessionIssuer, hashDoToken } from './session-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'
import { createUserDirectory } from './user-directory.js'

/**
 * Super Admin — NR-105, ADR-0007, DEC-020, RF-131.
 *
 * O que so o banco prova:
 *
 * - `platform_admins`/`platform_admin_access` negam tudo para o papel comum —
 *   mesmo desenho de `sessions`/`login_throttle` (0004).
 * - `auth_session_enter_company` recusa quem nao e Super Admin, recusa
 *   justificativa curta, e SO ENTAO grava o acesso e troca a sessao.
 * - `auth_session_exit_company` fecha o acesso e devolve a sessao ao estado
 *   sem empresa — e recusa quando a sessao nao esta em modo Super Admin.
 * - conceder/revogar exige que quem concede/revoga JA seja Super Admin.
 *
 * Como nas outras suites: pulada sem `DATABASE_URL`, assercoes pelo papel
 * COMUM — com a conexao de administrador, superusuario ignora RLS.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('super admin — NR-105', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string

  beforeAll(async () => {
    admin = postgres(MIGRATION_URL!, { max: 1, onnotice: () => undefined })
    await migrate(MIGRATION_URL!)
    aplicacao = await conectarComoAplicacao(admin, MIGRATION_URL!)
    sql = aplicacao.sql

    empresaA = randomUUID()
    empresaB = randomUUID()
    for (const [id, sufixo] of [
      [empresaA, 'A'],
      [empresaB, 'B'],
    ] as const) {
      const cnpj = cnpjDeTeste(sufixo === 'A' ? '8' : '9')
      await withTenant(
        sql,
        id,
        (tx) => tx`
          INSERT INTO companies (id, legal_name, cnpj, email, phone)
          VALUES (${id}, ${`Loja Super Admin ${sufixo}`}, ${cnpj}, ${`contato@${cnpj}.local`}, ${'41999990000'})
        `,
      )
    }
  })

  afterAll(async () => {
    await aplicacao?.encerrar()
    await admin?.end({ timeout: 5 })
  })

  const emissor = () => createSessionIssuer(sql)
  const daquiAUmaHora = () => new Date(Date.now() + 3_600_000)

  /** Usuario SEM vinculo nenhum — o caso normal de quem so e Super Admin. */
  async function criarUsuarioSemEmpresa(nome: string) {
    const [linha] = await admin<{ id: string }[]>`
      INSERT INTO users (name, email)
      VALUES (${nome}, ${`${randomUUID()}@plataforma.local`})
      RETURNING id
    `
    return linha!.id
  }

  async function criarUsuarioDaLoja(companyId: string, papel: 'owner' | 'staff' = 'owner') {
    return createUserDirectory(sql).createUserWithAccess({
      companyId,
      name: 'Dono da Loja',
      email: `dono-${randomUUID()}@loja.com`,
      phone: null,
      role: papel,
      createdAt: new Date(),
    })
  }

  async function tornarSuperAdmin(userId: string, concedidoPor: string) {
    await sql`SELECT platform_admin_grant(${userId}, ${concedidoPor})`
  }

  describe('platform_admins e platform_admin_access negam tudo ao papel comum', () => {
    it('SELECT direto em platform_admins devolve zero linhas', async () => {
      const linhas = await sql`SELECT * FROM platform_admins`
      expect(linhas).toHaveLength(0)
    })

    it('SELECT direto em platform_admin_access devolve zero linhas', async () => {
      const linhas = await sql`SELECT * FROM platform_admin_access`
      expect(linhas).toHaveLength(0)
    })

    it('INSERT direto em platform_admins e recusado', async () => {
      await expect(
        sql`INSERT INTO platform_admins (user_id, granted_by) VALUES (${randomUUID()}, ${randomUUID()})`,
      ).rejects.toThrow(/row-level security|permission denied/i)
    })
  })

  /**
   * A lista de usuarios da plataforma — NR-121.
   *
   * O que so o banco prova aqui: a funcao atravessa a politica de `users` (que
   * so mostra quem tem vinculo com a empresa do contexto) e mesmo assim exige
   * Super Admin para responder — os dois lados do `SECURITY DEFINER`.
   */
  describe('usuarios da plataforma', () => {
    const FILTRO = { page: 1, pageSize: 50 }

    it('recusa quem nao e Super Admin', async () => {
      const comum = await criarUsuarioSemEmpresa('Curioso')

      await expect(createPlatformAdminAccess(sql).listUsers(comum, FILTRO)).rejects.toThrow(
        /Somente Super Admin/i,
      )
    })

    it('traz quem nao tem vinculo com empresa nenhuma — RLS de users nao o esconde', async () => {
      const raiz = await criarUsuarioSemEmpresa('Raiz da Plataforma')
      await admin`INSERT INTO platform_admins (user_id, granted_by) VALUES (${raiz}, ${raiz})`
      const semLoja = await criarUsuarioSemEmpresa('So Existe na Plataforma')

      const r = await createPlatformAdminAccess(sql).listUsers(raiz, {
        ...FILTRO,
        q: 'So Existe na Plataforma',
      })

      expect(r.users.map((u) => u.userId)).toContain(semLoja)
      expect(r.users[0]?.companies).toEqual([])
    })

    it('mostra as lojas de cada pessoa, com o papel dela em cada uma', async () => {
      const raiz = (
        await admin<{ user_id: string }[]>`
          SELECT user_id FROM platform_admins WHERE revoked_at IS NULL LIMIT 1
        `
      )[0]!.user_id

      /* Usuario criado aqui, com nome unico: a busca e por nome/e-mail, e
         `createUserWithAccess` nao devolve o e-mail que gerou. */
      const nome = `Funcionaria da Loja ${randomUUID().slice(0, 8)}`
      const [linha] = await admin<{ id: string }[]>`
        INSERT INTO users (name, email)
        VALUES (${nome}, ${`${randomUUID()}@loja.local`})
        RETURNING id
      `
      await admin`
        INSERT INTO company_users (company_id, user_id, role)
        VALUES (${empresaA}, ${linha!.id}, ${'staff'})
      `

      const r = await createPlatformAdminAccess(sql).listUsers(raiz, { ...FILTRO, q: nome })

      expect(r.users[0]?.companies).toEqual([
        { companyId: empresaA, name: 'Loja Super Admin A', role: 'staff' },
      ])
    })

    it('marca quem ja e Super Admin, e o total ignora a pagina', async () => {
      const raiz = (
        await admin<{ user_id: string }[]>`
          SELECT user_id FROM platform_admins WHERE revoked_at IS NULL LIMIT 1
        `
      )[0]!.user_id

      const primeira = await createPlatformAdminAccess(sql).listUsers(raiz, {
        page: 1,
        pageSize: 1,
      })

      expect(primeira.users).toHaveLength(1)
      /* Sem o total real a tela nao sabe que existe pagina 2 — e a base de
         usuarios cresce justamente por fora desta tela. */
      expect(primeira.total).toBeGreaterThan(1)

      const doRaiz = await createPlatformAdminAccess(sql).listUsers(raiz, {
        ...FILTRO,
        q: 'Raiz da Plataforma',
      })
      expect(doRaiz.users[0]?.isPlatformAdmin).toBe(true)
    })
  })

  describe('conceder e revogar', () => {
    it('platform_admin_is comeca falso para qualquer usuario', async () => {
      const u = await criarUsuarioSemEmpresa('Ninguem Ainda')
      const [linha] = await sql<{ platform_admin_is: boolean }[]>`
        SELECT platform_admin_is(${u})
      `
      expect(linha!.platform_admin_is).toBe(false)
    })

    it('recusa conceder quando quem concede nao e Super Admin', async () => {
      const alvo = await criarUsuarioSemEmpresa('Alvo')
      const concedente = await criarUsuarioSemEmpresa('Concedente Comum')

      await expect(sql`SELECT platform_admin_grant(${alvo}, ${concedente})`).rejects.toThrow(
        /precisa ja ser Super Admin/i,
      )
    })

    it('um Super Admin concede a outro, e platform_admin_is passa a valer', async () => {
      const primeiro = await criarUsuarioSemEmpresa('Primeiro Admin')
      /* O bootstrap do primeiro e SEMPRE um INSERT direto (fora da funcao) —
         nao existe quem conceda antes do primeiro. */
      await admin`INSERT INTO platform_admins (user_id, granted_by) VALUES (${primeiro}, ${primeiro})`

      const segundo = await criarUsuarioSemEmpresa('Segundo Admin')
      await tornarSuperAdmin(segundo, primeiro)

      const [linha] = await sql<{ platform_admin_is: boolean }[]>`
        SELECT platform_admin_is(${segundo})
      `
      expect(linha!.platform_admin_is).toBe(true)
    })

    it('revoga, e platform_admin_is volta a falso', async () => {
      const primeiro = await criarUsuarioSemEmpresa('Primeiro Admin Rev')
      await admin`INSERT INTO platform_admins (user_id, granted_by) VALUES (${primeiro}, ${primeiro})`

      const alvo = await criarUsuarioSemEmpresa('Sera Revogado')
      await tornarSuperAdmin(alvo, primeiro)
      await sql`SELECT platform_admin_revoke(${alvo}, ${primeiro})`

      const [linha] = await sql<{ platform_admin_is: boolean }[]>`
        SELECT platform_admin_is(${alvo})
      `
      expect(linha!.platform_admin_is).toBe(false)
    })
  })

  describe('entrar e sair de uma empresa', () => {
    async function sessaoDeSuperAdmin() {
      const bootstrap = await criarUsuarioSemEmpresa(`Bootstrap ${randomUUID()}`)
      await admin`INSERT INTO platform_admins (user_id, granted_by) VALUES (${bootstrap}, ${bootstrap})`

      const admin_ = await criarUsuarioSemEmpresa('Super Admin de Teste')
      await tornarSuperAdmin(admin_, bootstrap)

      const token = await emissor().issue({ userId: admin_, companyId: null }, daquiAUmaHora())
      return { userId: admin_, token }
    }

    it('recusa entrar sem ser Super Admin', async () => {
      const usuarioComum = await criarUsuarioSemEmpresa('Usuario Qualquer')
      const token = await emissor().issue(
        { userId: usuarioComum, companyId: null },
        daquiAUmaHora(),
      )

      await expect(
        sql`SELECT auth_session_enter_company(${hashDoToken(token)}, ${empresaA}, ${'Investigando um chamado de suporte'})`,
      ).rejects.toThrow(/nao pertence a um Super Admin/i)
    })

    it('recusa justificativa curta demais', async () => {
      const { token } = await sessaoDeSuperAdmin()

      await expect(
        sql`SELECT auth_session_enter_company(${hashDoToken(token)}, ${empresaA}, ${'curta'})`,
      ).rejects.toThrow(/pelo menos 10 caracteres/i)
    })

    it('recusa empresa que nao existe', async () => {
      const { token } = await sessaoDeSuperAdmin()

      await expect(
        sql`SELECT auth_session_enter_company(${hashDoToken(token)}, ${randomUUID()}, ${'Empresa inventada para o teste'})`,
      ).rejects.toThrow(/Empresa nao encontrada/i)
    })

    it('entra na empresa: sessao passa a valer como owner, e o acesso fica gravado', async () => {
      const { userId, token } = await sessaoDeSuperAdmin()

      await sql`SELECT auth_session_enter_company(${hashDoToken(token)}, ${empresaA}, ${'Cliente pediu ajuda pelo chat de suporte'})`

      expect(await emissor().read(token)).toEqual({
        userId,
        companyId: empresaA,
        role: 'owner',
      })

      const [acesso] = await admin<
        { target_company_id: string; justification: string; ended_at: string | null }[]
      >`
        SELECT target_company_id, justification, ended_at
          FROM platform_admin_access
         WHERE admin_user_id = ${userId}
         ORDER BY started_at DESC
         LIMIT 1
      `
      expect(acesso?.target_company_id).toBe(empresaA)
      expect(acesso?.justification).toBe('Cliente pediu ajuda pelo chat de suporte')
      expect(acesso?.ended_at).toBeNull()
    })

    it('depois de entrar, a sessao le e escreve dado da empresa como qualquer owner', async () => {
      const { token } = await sessaoDeSuperAdmin()
      await sql`SELECT auth_session_enter_company(${hashDoToken(token)}, ${empresaB}, ${'Conferindo cadastro da empresa B'})`

      const claims = await emissor().read(token)
      if (claims === undefined || claims.companyId === null) throw new Error('sessao invalida')

      const linhas = await withTenant(
        sql,
        claims.companyId,
        (tx) => tx<{ legal_name: string }[]>`SELECT legal_name FROM companies`,
      )
      expect(linhas[0]?.legal_name).toBe('Loja Super Admin B')
    })

    it('entra em outra empresa sem sair antes: fecha o acesso anterior sozinho', async () => {
      const { userId, token } = await sessaoDeSuperAdmin()
      await sql`SELECT auth_session_enter_company(${hashDoToken(token)}, ${empresaA}, ${'Primeiro acesso, a empresa A'})`
      await sql`SELECT auth_session_enter_company(${hashDoToken(token)}, ${empresaB}, ${'Pulou direto para a empresa B'})`

      expect(await emissor().read(token)).toEqual({
        userId,
        companyId: empresaB,
        role: 'owner',
      })

      const acessos = await admin<{ target_company_id: string; ended_at: string | null }[]>`
        SELECT target_company_id, ended_at FROM platform_admin_access
         WHERE admin_user_id = ${userId}
         ORDER BY started_at
      `
      expect(acessos).toHaveLength(2)
      expect(acessos[0]).toMatchObject({ target_company_id: empresaA })
      expect(acessos[0]?.ended_at).not.toBeNull()
      expect(acessos[1]).toMatchObject({ target_company_id: empresaB })
      expect(acessos[1]?.ended_at).toBeNull()
    })

    it('sai: fecha o acesso e devolve a sessao ao estado sem empresa', async () => {
      const { userId, token } = await sessaoDeSuperAdmin()
      await sql`SELECT auth_session_enter_company(${hashDoToken(token)}, ${empresaA}, ${'Vai sair logo em seguida'})`

      await sql`SELECT auth_session_exit_company(${hashDoToken(token)})`

      expect(await emissor().read(token)).toEqual({ userId, companyId: null })

      const [acesso] = await admin<{ ended_at: string | null }[]>`
        SELECT ended_at FROM platform_admin_access
         WHERE admin_user_id = ${userId}
         ORDER BY started_at DESC
         LIMIT 1
      `
      expect(acesso?.ended_at).not.toBeNull()
    })

    it('recusa sair quando a sessao nao esta em modo Super Admin', async () => {
      const dono = await criarUsuarioDaLoja(empresaA)
      const token = await emissor().issue(
        { userId: dono.id, companyId: empresaA, role: 'owner' },
        daquiAUmaHora(),
      )

      await expect(sql`SELECT auth_session_exit_company(${hashDoToken(token)})`).rejects.toThrow(
        /nao esta em modo Super Admin/i,
      )
    })
  })

  describe('a visao geral da plataforma', () => {
    it('platform_admin_list_companies recusa quem nao e Super Admin', async () => {
      const usuarioComum = await criarUsuarioSemEmpresa('Sem Acesso a Visao Geral')

      await expect(
        sql`SELECT * FROM platform_admin_list_companies(${usuarioComum})`,
      ).rejects.toThrow(/Somente Super Admin/i)
    })

    it('platform_admin_list_companies devolve as empresas para um Super Admin', async () => {
      const { userId } = await sessaoDeAdminSemEmpresa()

      const empresas = await sql<{ id: string }[]>`
        SELECT id FROM platform_admin_list_companies(${userId})
      `
      const ids = empresas.map((e) => e.id)
      expect(ids).toContain(empresaA)
      expect(ids).toContain(empresaB)
    })

    async function sessaoDeAdminSemEmpresa() {
      const bootstrap = await criarUsuarioSemEmpresa(`Bootstrap Visao ${randomUUID()}`)
      await admin`INSERT INTO platform_admins (user_id, granted_by) VALUES (${bootstrap}, ${bootstrap})`
      return { userId: bootstrap }
    }
  })

  describe('o adapter TypeScript (createPlatformAdminAccess)', () => {
    /* As suites acima provam a funcao SQL isolada; esta prova que o mapeamento
       de campo (snake_case -> camelCase) do adapter bate com o que a funcao
       de verdade devolve — um erro de nome de coluna aqui nao apareceria nos
       testes de SQL puro, so no dia em que `core` recebesse `undefined` onde
       esperava uma string. */
    it('isPlatformAdmin, grant, listAdmins e listCompanies batem de ponta a ponta', async () => {
      const acesso = createPlatformAdminAccess(sql)

      const bootstrap = await criarUsuarioSemEmpresa(`Bootstrap Adapter ${randomUUID()}`)
      await admin`INSERT INTO platform_admins (user_id, granted_by) VALUES (${bootstrap}, ${bootstrap})`

      expect(await acesso.isPlatformAdmin(bootstrap)).toBe(true)

      const novo = await criarUsuarioSemEmpresa('Novo Via Adapter')
      expect(await acesso.isPlatformAdmin(novo)).toBe(false)
      await acesso.grant(novo, bootstrap)
      expect(await acesso.isPlatformAdmin(novo)).toBe(true)

      const admins = await acesso.listAdmins(bootstrap)
      expect(admins.some((a) => a.userId === novo)).toBe(true)

      const empresas = await acesso.listCompanies(bootstrap)
      expect(empresas.map((e) => e.id)).toContain(empresaA)
      expect(empresas[0]).toMatchObject({
        legalName: expect.any(String),
        cnpj: expect.any(String),
        isActive: expect.any(Boolean),
      })
    })

    it('enterCompany e exitCompany, pelo adapter, trocam a sessao de verdade', async () => {
      const acesso = createPlatformAdminAccess(sql)
      const bootstrap = await criarUsuarioSemEmpresa(`Bootstrap EntrarSair ${randomUUID()}`)
      await admin`INSERT INTO platform_admins (user_id, granted_by) VALUES (${bootstrap}, ${bootstrap})`

      const token = await emissor().issue({ userId: bootstrap, companyId: null }, daquiAUmaHora())

      await acesso.enterCompany(token, empresaA, 'Testando o adapter TypeScript de ponta a ponta')
      expect(await emissor().read(token)).toEqual({
        userId: bootstrap,
        companyId: empresaA,
        role: 'owner',
      })

      await acesso.exitCompany(token)
      expect(await emissor().read(token)).toEqual({ userId: bootstrap, companyId: null })
    })
  })
})
