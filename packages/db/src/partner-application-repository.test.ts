import { randomUUID } from 'node:crypto'
import { isAppError } from '@na-regua/core'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createPartnerApplicationRepository } from './partner-application-repository.js'
import { conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'
import { createUserDirectory } from './user-directory.js'

/**
 * Adapter TypeScript de `PartnerApplicationRepository` — NR-115.
 *
 * `partner-coupons.test.ts` ja prova as funcoes SQL de ponta a ponta; esta
 * suite prova so a TRADUCAO: forma de dado (snake_case -> camelCase) e erro
 * do Postgres -> `AppError` do tipo certo.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('adapter de PartnerApplicationRepository — NR-115', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao

  beforeAll(async () => {
    admin = postgres(MIGRATION_URL!, { max: 1, onnotice: () => undefined })
    await migrate(MIGRATION_URL!)
    aplicacao = await conectarComoAplicacao(admin, MIGRATION_URL!)
    sql = aplicacao.sql
  }, 30_000)

  afterAll(async () => {
    await aplicacao?.encerrar()
    await admin?.end({ timeout: 5 })
  })

  function cnpjDeTesteLocal(): string {
    const base12 = `${Math.floor(Math.random() * 9_000_000) + 1_000_000}${String(Date.now()).slice(-5)}`
    const digito = (nums: number[], pesos: number[]): number => {
      const resto = nums.reduce((acc, n, i) => acc + n * pesos[i]!, 0) % 11
      return resto < 2 ? 0 : 11 - resto
    }
    const base = base12.split('').map(Number)
    const d1 = digito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    const d2 = digito([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return `${base12}${d1}${d2}`
  }

  async function criarEmpresa(nome: string): Promise<string> {
    const id = randomUUID()
    const cnpj = cnpjDeTesteLocal()
    const nomeUnico = `${nome} ${randomUUID().slice(0, 8)}`
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nomeUnico}, ${cnpj}, ${`contato@${cnpj}.local`}, '41999990000')
      `,
    )
    return id
  }

  async function criarDono(companyId: string) {
    return createUserDirectory(sql).createUserWithAccess({
      companyId,
      name: 'Dono da Loja',
      email: `dono-${randomUUID()}@loja.local`,
      phone: null,
      role: 'owner',
      createdAt: new Date(),
    })
  }

  async function criarSuperAdmin(): Promise<string> {
    const [linha] = await admin<{ id: string }[]>`
      INSERT INTO users (name, email) VALUES ('Super Admin de Teste', ${`${randomUUID()}@plataforma.local`})
      RETURNING id
    `
    await admin`INSERT INTO platform_admins (user_id, granted_by) VALUES (${linha!.id}, ${linha!.id})`
    return linha!.id
  }

  function codigoUnico(): string {
    return `ZZ${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`
  }

  it('submit bate de ponta a ponta e traduz para camelCase', async () => {
    const repo = createPartnerApplicationRepository(sql)
    const empresa = await criarEmpresa('Adapter Submit')
    const dono = await criarDono(empresa)
    const codigo = codigoUnico()

    const resultado = await repo.submit({
      ownerUserId: dono.id,
      ownerCompanyId: empresa,
      pixKey: '41999990000',
      pixKeyType: 'PHONE',
      message: 'Quero divulgar o Buddy para meus clientes.',
      couponCode: codigo,
    })

    expect(resultado.couponCode).toBe(codigo)

    const minha = await repo.mine(empresa)
    expect(minha?.status).toBe('pending')
    expect(minha?.pixKeyType).toBe('PHONE')
    expect(minha?.couponCode).toBe(codigo)
  })

  it('PIX vazio vira AppError de validacao, nao erro cru do Postgres', async () => {
    const repo = createPartnerApplicationRepository(sql)
    const empresa = await criarEmpresa('Adapter Validacao')
    const dono = await criarDono(empresa)

    let erro: unknown
    try {
      await repo.submit({
        ownerUserId: dono.id,
        ownerCompanyId: empresa,
        pixKey: '',
        pixKeyType: 'PHONE',
        message: 'Motivo valido',
        couponCode: codigoUnico(),
      })
    } catch (e) {
      erro = e
    }

    expect(isAppError(erro) && erro.code).toBe('VALIDATION_FAILED')
  })

  it('empresa com candidatura duplicada vira AppError de conflito', async () => {
    const repo = createPartnerApplicationRepository(sql)
    const empresa = await criarEmpresa('Adapter Duplicada')
    const dono = await criarDono(empresa)

    await repo.submit({
      ownerUserId: dono.id,
      ownerCompanyId: empresa,
      pixKey: '41999990000',
      pixKeyType: 'PHONE',
      message: 'Primeira candidatura',
      couponCode: codigoUnico(),
    })

    let erro: unknown
    try {
      await repo.submit({
        ownerUserId: dono.id,
        ownerCompanyId: empresa,
        pixKey: '41999990000',
        pixKeyType: 'PHONE',
        message: 'Segunda candidatura',
        couponCode: codigoUnico(),
      })
    } catch (e) {
      erro = e
    }

    expect(isAppError(erro) && erro.code).toBe('CONFLICT')
  })

  it('reenvio antes de recusada vira AppError de conflito', async () => {
    const repo = createPartnerApplicationRepository(sql)
    const empresa = await criarEmpresa('Adapter Reenvio Cedo')
    const dono = await criarDono(empresa)

    await repo.submit({
      ownerUserId: dono.id,
      ownerCompanyId: empresa,
      pixKey: '41999990000',
      pixKeyType: 'PHONE',
      message: 'Motivo original',
      couponCode: codigoUnico(),
    })

    let erro: unknown
    try {
      await repo.resend({
        ownerCompanyId: empresa,
        pixKey: '41988887777',
        pixKeyType: 'PHONE',
        message: 'Motivo novo',
      })
    } catch (e) {
      erro = e
    }

    expect(isAppError(erro) && erro.code).toBe('CONFLICT')
  })

  it('listPending e review batem de ponta a ponta', async () => {
    const repo = createPartnerApplicationRepository(sql)
    const empresa = await criarEmpresa('Adapter Review')
    const dono = await criarDono(empresa)
    const superAdmin = await criarSuperAdmin()

    const { partnerId } = await repo.submit({
      ownerUserId: dono.id,
      ownerCompanyId: empresa,
      pixKey: '41999990000',
      pixKeyType: 'PHONE',
      message: 'Quero ser Parceiro',
      couponCode: codigoUnico(),
    })

    const fila = await repo.listPending(superAdmin)
    expect(fila.some((f) => f.partnerId === partnerId)).toBe(true)
    expect(fila.find((f) => f.partnerId === partnerId)?.companyId).toBe(empresa)

    await repo.review({ reviewedBy: superAdmin, partnerId, decision: 'approve', note: undefined })

    const minha = await repo.mine(empresa)
    expect(minha?.status).toBe('active')
  })

  it('empresa sem candidatura: mine devolve undefined, nao lanca', async () => {
    const repo = createPartnerApplicationRepository(sql)
    const empresa = await criarEmpresa('Adapter Sem Candidatura')

    const minha = await repo.mine(empresa)
    expect(minha).toBeUndefined()
  })
})
