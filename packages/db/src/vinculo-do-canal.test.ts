import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createPeerDirectory } from './peer-directory-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'
import { createUserContacts } from './user-contacts.js'

/**
 * Vinculo do canal WhatsApp — NR-113, RF-094, RF-095, ADR-0012.
 *
 * O que so o banco pode dizer: se a funcao acha o vinculo SEM tenant no
 * contexto, se ela respeita "so owner" e "a primeira empresa em ordem de
 * vinculo", e se ela nao devolve cadastro junto.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('vinculo do canal — NR-113', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let dona: string
  let primeiraLoja: string
  let segundaLoja: string

  async function criarEmpresa(nome: string, prefixo: string): Promise<string> {
    const id = randomUUID()
    const cnpj = cnpjDeTeste(prefixo)
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpj}, ${'contato@' + cnpj + '.local'}, ${'41999990000'})
      `,
    )
    return id
  }

  async function criarUsuario(telefone: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      randomUUID(),
      (tx) => tx`
        INSERT INTO users (id, name, email, phone)
        VALUES (${id}, ${nome}, ${`${id}@teste.local`}, ${telefone})
      `,
    )
    return id
  }

  async function vincular(
    empresa: string,
    usuario: string,
    papel: string,
    criadoEm: string,
  ): Promise<void> {
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO company_users (company_id, user_id, role, created_at)
        VALUES (${empresa}, ${usuario}, ${papel}, ${criadoEm})
      `,
    )
  }

  const TELEFONE = `4199${String(Date.now()).slice(-7)}`

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0028_vinculo_do_canal')

    admin = postgres(DATABASE_URL!, { max: 3, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    dona = await criarUsuario(TELEFONE, 'Dona Marta')

    /* A SEGUNDA loja tem nome alfabeticamente MENOR, de proposito: se a ordem
       fosse por nome — como em `auth_memberships` —, o chip colaria na loja
       errada. */
    primeiraLoja = await criarEmpresa('Zeta Mercearia', '8')
    segundaLoja = await criarEmpresa('Alfa Padaria', '9')

    await vincular(primeiraLoja, dona, 'owner', '2026-01-01T10:00:00.000Z')
    await vincular(segundaLoja, dona, 'owner', '2026-06-01T10:00:00.000Z')
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar?.()
    await admin?.end({ timeout: 5 })
  })

  it('acha o vinculo SEM tenant no contexto', async () => {
    const v = await createPeerDirectory(sql).porTelefone(TELEFONE)

    /* O webhook chega sem empresa; se isto exigisse tenant, o canal nao
       existiria. */
    expect(v?.userId).toBe(dona)
  })

  it('o chip cola na PRIMEIRA loja por ordem de vinculo, nao por nome', async () => {
    const v = await createPeerDirectory(sql).porTelefone(TELEFONE)

    /* Com ordem alfabetica, renomear uma loja mudaria qual delas o chip opera
       — sem ninguem tocar no canal. */
    expect(v?.companyId).toBe(primeiraLoja)
    expect(v?.companyId).not.toBe(segundaLoja)
  })

  it('numero desconhecido devolve undefined, e nao erro', async () => {
    /* RF-095: qualquer um pode mandar mensagem para o numero da loja, e isso e
       o caso comum — nao uma excecao. */
    expect(await createPeerDirectory(sql).porTelefone('41900000000')).toBeUndefined()
  })

  it('staff nao opera o canal', async () => {
    const telefone = `4198${String(Date.now()).slice(-7)}`
    const funcionario = await criarUsuario(telefone, 'Joao Balconista')
    await vincular(primeiraLoja, funcionario, 'staff', '2026-02-01T10:00:00.000Z')

    /* Ponto 4 da ADR-0012. O filtro esta na funcao SQL, e nao em quem chama,
       para nao haver um segundo lugar onde a regra possa ser esquecida. */
    expect(await createPeerDirectory(sql).porTelefone(telefone)).toBeUndefined()
  })

  it('vinculo desativado deixa de operar', async () => {
    const telefone = `4197${String(Date.now()).slice(-7)}`
    const exDono = await criarUsuario(telefone, 'Ex Dono')
    await vincular(primeiraLoja, exDono, 'owner', '2026-03-01T10:00:00.000Z')
    await withTenant(
      sql,
      primeiraLoja,
      (tx) => tx`
        UPDATE company_users SET is_active = false
         WHERE company_id = ${primeiraLoja} AND user_id = ${exDono}
      `,
    )

    /* Acesso revogado nao e vinculo — e quem saiu da sociedade nao pode
       continuar operando a loja pelo celular. */
    expect(await createPeerDirectory(sql).porTelefone(telefone)).toBeUndefined()
  })

  it('a funcao NAO devolve cadastro junto', async () => {
    const linhas = await sql`SELECT * FROM channel_owner_by_phone(${TELEFONE})`

    /* Retorno minimo: nome, e-mail e telefone fora. Devolver o cadastro
       transformaria isto num consultor de usuario por telefone. */
    expect(Object.keys(linhas[0] ?? {}).sort()).toEqual(['company_id', 'user_id'])
  })

  it('trocar o celular tira o numero antigo do canal — RF-132', async () => {
    const antigo = `4196${String(Date.now()).slice(-7)}`
    const novo = `4195${String(Date.now()).slice(-7)}`
    const donaNova = await criarUsuario(antigo, 'Dona Troca')
    await vincular(primeiraLoja, donaNova, 'owner', '2026-02-01T10:00:00.000Z')

    const contatos = createUserContacts(sql)
    expect((await contatos.contactOf(donaNova))?.phone).toBe(antigo)

    /* Pelo papel da APLICACAO, sem tenant: a funcao e SECURITY DEFINER. */
    await contatos.changePhone(donaNova, novo)

    expect(await createPeerDirectory(sql).porTelefone(antigo)).toBeUndefined()
    expect((await createPeerDirectory(sql).porTelefone(novo))?.userId).toBe(donaNova)
  })
})
