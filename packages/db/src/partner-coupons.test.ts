import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'
import { createUserDirectory } from './user-directory.js'

/**
 * Conta de Parceiro e esquema de cupons — NR-114, ADR-0013.
 *
 * O que so o banco prova:
 *
 * - `partners`/`coupons`/`coupon_redemptions` negam tudo ao papel comum —
 *   mesmo desenho de `company_connections`/`platform_admin_access`.
 * - `partner_application_submit` cria a candidatura pending e o cupom dela,
 *   inativo. `partner_application_review` so deixa Super Admin aprovar ou
 *   recusar, e so aprovar ativa o cupom.
 * - `partner_application_resend` so reabre candidatura recusada.
 * - `coupon_lookup` nunca expoe PIX nem mensagem.
 * - `coupon_redemption_record` recusa cupom inativo/revogado/expirado/
 *   proprio, so deixa uma empresa resgatar uma vez na vida, e credita mes
 *   gratis cumulativo no caso de cupom de lojista.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('conta de parceiro e cupons — NR-114', () => {
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

  function codigoUnico(): string {
    return `ZZ${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`
  }

  /*
   * Sufixo aleatorio no nome, sempre — nao so no CNPJ. `partner_application_submit`
   * copia o nome da empresa para `partners.name`, e essa coluna tem unique
   * index HERDADO da 0007 (`partners_name_unique`) sem escopo nenhum. Rodar a
   * suite duas vezes contra o mesmo banco de dev com nomes literais fixos
   * ('Sera Aprovada' etc.) colide na segunda rodada — mesma classe de bug ja
   * documentada nesta trilha para termos de busca (`termoUnico`).
   */
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
    const id = linha!.id
    await admin`INSERT INTO platform_admins (user_id, granted_by) VALUES (${id}, ${id})`
    return id
  }

  describe('partners/coupons/coupon_redemptions negam tudo ao papel comum', () => {
    it('SELECT direto em partners devolve zero linhas', async () => {
      expect(await sql`SELECT * FROM partners`).toHaveLength(0)
    })

    it('INSERT direto em partners e recusado', async () => {
      await expect(sql`INSERT INTO partners (name) VALUES ('Tentativa Direta')`).rejects.toThrow(
        /row-level security|permission denied/i,
      )
    })

    it('SELECT direto em coupons devolve zero linhas', async () => {
      expect(await sql`SELECT * FROM coupons`).toHaveLength(0)
    })

    it('SELECT direto em coupon_redemptions devolve zero linhas', async () => {
      expect(await sql`SELECT * FROM coupon_redemptions`).toHaveLength(0)
    })
  })

  describe('partner_application_submit e review', () => {
    it('cria a candidatura pending e o cupom inativo', async () => {
      const empresa = await criarEmpresa('Candidata a Parceira')
      const dono = await criarDono(empresa)
      const codigo = codigoUnico()

      const [resultado] = await sql`
        SELECT * FROM partner_application_submit(${dono.id}, ${empresa}, '11999998888', 'PHONE', 'Quero divulgar o Buddy para meus clientes.', ${codigo})
      `

      expect(resultado?.coupon_code).toBe(codigo)

      const [minha] = await sql`SELECT * FROM partner_application_mine(${empresa})`
      expect(minha?.status).toBe('pending')
      expect(minha?.coupon_code).toBe(codigo)

      const [cupom] = await sql`SELECT active FROM coupon_lookup(${codigo})`
      expect(cupom?.active).toBe(false)
    })

    it('recusa PIX vazio', async () => {
      const empresa = await criarEmpresa('Sem PIX')
      const dono = await criarDono(empresa)

      await expect(
        sql`SELECT * FROM partner_application_submit(${dono.id}, ${empresa}, '', 'PHONE', 'Motivo qualquer', ${codigoUnico()})`,
      ).rejects.toThrow(/chave pix e obrigatoria/i)
    })

    it('recusa mensagem vazia', async () => {
      const empresa = await criarEmpresa('Sem Mensagem')
      const dono = await criarDono(empresa)

      await expect(
        sql`SELECT * FROM partner_application_submit(${dono.id}, ${empresa}, '11999998888', 'PHONE', '   ', ${codigoUnico()})`,
      ).rejects.toThrow(/motivo do pedido/i)
    })

    it('so Super Admin pode listar pendentes', async () => {
      const empresa = await criarEmpresa('Sem Ser Admin')
      const dono = await criarDono(empresa)

      await expect(sql`SELECT * FROM partner_application_list_pending(${dono.id})`).rejects.toThrow(
        /apenas super admin/i,
      )
    })

    it('Super Admin aprova: ativa o parceiro e o cupom junto', async () => {
      const empresa = await criarEmpresa('Sera Aprovada')
      const dono = await criarDono(empresa)
      const codigo = codigoUnico()
      const [linha] = await sql<{ partner_id: string }[]>`
        SELECT * FROM partner_application_submit(${dono.id}, ${empresa}, '11999998888', 'PHONE', 'Motivo', ${codigo})
      `
      const partnerId = linha!.partner_id
      const superAdmin = await criarSuperAdmin()

      const pendentes = await sql`SELECT * FROM partner_application_list_pending(${superAdmin})`
      expect(pendentes.map((p) => p.partner_id)).toContain(partnerId)

      await sql`SELECT partner_application_review(${superAdmin}, ${partnerId}, 'approve', 'Tudo certo')`

      const [minha] = await sql`SELECT * FROM partner_application_mine(${empresa})`
      expect(minha?.status).toBe('active')

      const [cupom] = await sql`SELECT active FROM coupon_lookup(${codigo})`
      expect(cupom?.active).toBe(true)
    })

    it('Super Admin recusa: cupom nunca ativa', async () => {
      const empresa = await criarEmpresa('Sera Recusada')
      const dono = await criarDono(empresa)
      const codigo = codigoUnico()
      const [linha] = await sql<{ partner_id: string }[]>`
        SELECT * FROM partner_application_submit(${dono.id}, ${empresa}, '11999998888', 'PHONE', 'Motivo', ${codigo})
      `
      const partnerId = linha!.partner_id
      const superAdmin = await criarSuperAdmin()

      await sql`SELECT partner_application_review(${superAdmin}, ${partnerId}, 'reject', 'Nao agora')`

      const [minha] = await sql`SELECT * FROM partner_application_mine(${empresa})`
      expect(minha?.status).toBe('rejected')

      const [cupom] = await sql`SELECT active FROM coupon_lookup(${codigo})`
      expect(cupom?.active).toBe(false)
    })

    it('quem nao e Super Admin nao consegue revisar', async () => {
      const empresa = await criarEmpresa('Revisor Invalido')
      const dono = await criarDono(empresa)
      const [linha] = await sql<{ partner_id: string }[]>`
        SELECT * FROM partner_application_submit(${dono.id}, ${empresa}, '11999998888', 'PHONE', 'Motivo', ${codigoUnico()})
      `
      const partnerId = linha!.partner_id

      await expect(
        sql`SELECT partner_application_review(${dono.id}, ${partnerId}, 'approve', null)`,
      ).rejects.toThrow(/apenas super admin/i)
    })

    it('nao revisa a mesma candidatura duas vezes', async () => {
      const empresa = await criarEmpresa('Revisao Dupla')
      const dono = await criarDono(empresa)
      const [linha] = await sql<{ partner_id: string }[]>`
        SELECT * FROM partner_application_submit(${dono.id}, ${empresa}, '11999998888', 'PHONE', 'Motivo', ${codigoUnico()})
      `
      const partnerId = linha!.partner_id
      const superAdmin = await criarSuperAdmin()
      await sql`SELECT partner_application_review(${superAdmin}, ${partnerId}, 'approve', null)`

      await expect(
        sql`SELECT partner_application_review(${superAdmin}, ${partnerId}, 'approve', null)`,
      ).rejects.toThrow(/ja foi revisada/i)
    })

    it('reenvio so funciona depois de recusado, e reabre para pending', async () => {
      const empresa = await criarEmpresa('Vai Reenviar')
      const dono = await criarDono(empresa)
      const [linha] = await sql<{ partner_id: string }[]>`
        SELECT * FROM partner_application_submit(${dono.id}, ${empresa}, '11999998888', 'PHONE', 'Motivo original', ${codigoUnico()})
      `
      const partnerId = linha!.partner_id

      await expect(
        sql`SELECT partner_application_resend(${empresa}, '11988887777', 'Motivo novo')`,
      ).rejects.toThrow(/candidatura recusada/i)

      const superAdmin = await criarSuperAdmin()
      await sql`SELECT partner_application_review(${superAdmin}, ${partnerId}, 'reject', null)`

      await sql`SELECT partner_application_resend(${empresa}, '11988887777', 'Motivo novo')`

      const [minha] = await sql`SELECT * FROM partner_application_mine(${empresa})`
      expect(minha?.status).toBe('pending')
      expect(minha?.pix_key).toBe('11988887777')
      expect(minha?.reviewed_at).toBeNull()
    })

    it('uma empresa so tem uma candidatura de parceiro', async () => {
      const empresa = await criarEmpresa('Candidatura Unica')
      const dono = await criarDono(empresa)
      await sql`SELECT * FROM partner_application_submit(${dono.id}, ${empresa}, '11999998888', 'PHONE', 'Motivo', ${codigoUnico()})`

      await expect(
        sql`SELECT * FROM partner_application_submit(${dono.id}, ${empresa}, '11999998888', 'PHONE', 'De novo', ${codigoUnico()})`,
      ).rejects.toThrow(/duplicate key|unique/i)
    })
  })

  describe('nome de cupom — disponibilidade e sugestao', () => {
    it('disponivel antes de existir, indisponivel depois', async () => {
      const codigo = codigoUnico()
      expect((await sql`SELECT coupon_code_available(${codigo})`)[0]?.coupon_code_available).toBe(
        true,
      )

      const empresa = await criarEmpresa('Ocupa o Codigo')
      await sql`SELECT * FROM coupon_create_for_company(${empresa}, ${codigo})`

      expect((await sql`SELECT coupon_code_available(${codigo})`)[0]?.coupon_code_available).toBe(
        false,
      )
    })

    it('sugestao adiciona sufixo numerico em caso de colisao', async () => {
      const base = `SUG${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`
      const empresa = await criarEmpresa('Dona da Base')
      await sql`SELECT * FROM coupon_create_for_company(${empresa}, ${base})`

      const [sugestao] = await sql<
        { coupon_code_suggest: string }[]
      >`SELECT coupon_code_suggest(${base})`
      expect(sugestao?.coupon_code_suggest).toBe(`${base}1`)
    })
  })

  describe('coupon_lookup', () => {
    it('nunca expoe PIX nem mensagem — so as colunas do retorno', async () => {
      const empresa = await criarEmpresa('Privacidade do Lookup')
      const dono = await criarDono(empresa)
      const codigo = codigoUnico()
      await sql`SELECT * FROM partner_application_submit(${dono.id}, ${empresa}, '11999998888', 'PHONE', 'Segredo', ${codigo})`

      const [linha] = await sql`SELECT * FROM coupon_lookup(${codigo})`
      expect(Object.keys(linha ?? {}).sort()).toEqual(
        ['active', 'coupon_id', 'discount_percent', 'kind', 'referrer_label'].sort(),
      )
    })

    it('discrimina kind por qual FK esta preenchida, nao por escolha de quem cadastra', async () => {
      const parceiro = await criarEmpresa('Sou Parceira')
      const donoParceiro = await criarDono(parceiro)
      const codigoParceiro = codigoUnico()
      await sql`SELECT * FROM partner_application_submit(${donoParceiro.id}, ${parceiro}, '11999998888', 'PHONE', 'Motivo', ${codigoParceiro})`

      const lojista = await criarEmpresa('Sou Lojista')
      const codigoLojista = codigoUnico()
      await sql`SELECT * FROM coupon_create_for_company(${lojista}, ${codigoLojista})`

      const [parceiroLookup] = await sql`SELECT kind FROM coupon_lookup(${codigoParceiro})`
      const [lojistaLookup] = await sql`SELECT kind FROM coupon_lookup(${codigoLojista})`
      expect(parceiroLookup?.kind).toBe('partner')
      expect(lojistaLookup?.kind).toBe('lojista')
    })
  })

  describe('coupon_redemption_record', () => {
    it('resgate de cupom de parceiro grava o vinculo, sem creditar mes gratis', async () => {
      const parceiro = await criarEmpresa('Parceira Resgatavel')
      const donoParceiro = await criarDono(parceiro)
      const codigo = codigoUnico()
      const [linha] = await sql<{ partner_id: string }[]>`
        SELECT * FROM partner_application_submit(${donoParceiro.id}, ${parceiro}, '11999998888', 'PHONE', 'Motivo', ${codigo})
      `
      const partnerId = linha!.partner_id
      const superAdmin = await criarSuperAdmin()
      await sql`SELECT partner_application_review(${superAdmin}, ${partnerId}, 'approve', null)`

      const indicado = await criarEmpresa('Indicada Pelo Parceiro')
      const [resultado] = await sql<{ discount_percent: string }[]>`
        SELECT * FROM coupon_redemption_record(${codigo}, ${indicado})
      `
      expect(Number(resultado?.discount_percent)).toBe(30)

      const creditos =
        await admin`SELECT * FROM lojista_free_month_credits WHERE company_id = ${parceiro}`
      expect(creditos).toHaveLength(0)
    })

    it('resgate de cupom de lojista credita mes gratis para quem indicou', async () => {
      const indicador = await criarEmpresa('Indicadora Lojista')
      const codigo = codigoUnico()
      await sql`SELECT * FROM coupon_create_for_company(${indicador}, ${codigo})`

      const indicado = await criarEmpresa('Indicada Pela Lojista')
      await sql`SELECT * FROM coupon_redemption_record(${codigo}, ${indicado})`

      const creditos = await admin`
        SELECT status FROM lojista_free_month_credits WHERE company_id = ${indicador}
      `
      expect(creditos).toHaveLength(1)
      expect(creditos[0]?.status).toBe('available')
    })

    it('duas indicacoes concluidas geram dois creditos, cumulativo', async () => {
      const indicador = await criarEmpresa('Indicadora Cumulativa')
      const codigo = codigoUnico()
      await sql`SELECT * FROM coupon_create_for_company(${indicador}, ${codigo})`

      const indicadoA = await criarEmpresa('Primeira Indicada')
      const indicadoB = await criarEmpresa('Segunda Indicada')
      await sql`SELECT * FROM coupon_redemption_record(${codigo}, ${indicadoA})`
      await sql`SELECT * FROM coupon_redemption_record(${codigo}, ${indicadoB})`

      const creditos =
        await admin`SELECT * FROM lojista_free_month_credits WHERE company_id = ${indicador}`
      expect(creditos).toHaveLength(2)
    })

    it('recusa cupom de parceiro ainda nao aprovado', async () => {
      const parceiro = await criarEmpresa('Parceira Nao Aprovada')
      const dono = await criarDono(parceiro)
      const codigo = codigoUnico()
      await sql`SELECT * FROM partner_application_submit(${dono.id}, ${parceiro}, '11999998888', 'PHONE', 'Motivo', ${codigo})`

      const indicado = await criarEmpresa('Tentando Resgatar')
      await expect(
        sql`SELECT * FROM coupon_redemption_record(${codigo}, ${indicado})`,
      ).rejects.toThrow(/ainda nao foi ativado/i)
    })

    it('recusa codigo inexistente', async () => {
      const indicado = await criarEmpresa('Codigo Inexistente')
      await expect(
        sql`SELECT * FROM coupon_redemption_record(${codigoUnico()}, ${indicado})`,
      ).rejects.toThrow(/nao encontrado/i)
    })

    it('recusa auto-resgate do proprio cupom de lojista', async () => {
      const empresa = await criarEmpresa('Nao Pode Resgatar A Si Mesma')
      const codigo = codigoUnico()
      await sql`SELECT * FROM coupon_create_for_company(${empresa}, ${codigo})`

      await expect(
        sql`SELECT * FROM coupon_redemption_record(${codigo}, ${empresa})`,
      ).rejects.toThrow(/proprio cupom/i)
    })

    it('uma empresa so resgata um cupom na vida, mesmo cupons diferentes', async () => {
      const indicadorA = await criarEmpresa('Primeiro Indicador')
      const codigoA = codigoUnico()
      await sql`SELECT * FROM coupon_create_for_company(${indicadorA}, ${codigoA})`

      const indicadorB = await criarEmpresa('Segundo Indicador')
      const codigoB = codigoUnico()
      await sql`SELECT * FROM coupon_create_for_company(${indicadorB}, ${codigoB})`

      const indicado = await criarEmpresa('So Resgata Uma Vez')
      await sql`SELECT * FROM coupon_redemption_record(${codigoA}, ${indicado})`

      await expect(
        sql`SELECT * FROM coupon_redemption_record(${codigoB}, ${indicado})`,
      ).rejects.toThrow(/ja resgatou/i)
    })
  })
})
