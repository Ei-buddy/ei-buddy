import { randomUUID } from 'node:crypto'
import { PLANO_DE_CONTAS_PADRAO } from '@na-regua/core'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createChartOfAccountsRepository } from './chart-of-accounts-repository.js'
import { migrate } from './migrate.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Plano de contas, classificacao e os lancamentos do DRE — NR-077.
 *
 * A aritmetica do DRE tem teste em `domain` e o agrupamento em `core`, os dois
 * contra falsos. O que se prova AQUI e o que so o banco prova: que dois nomes
 * iguais com caixa diferente sao a mesma conta, que conta com lancamento nao
 * pode ser apagada, que o periodo sai por competencia sem cancelado dentro, e
 * que nada disso vaza entre lojas.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('plano de contas e DRE — NR-077', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string
  let usuarioA: string

  let repo: ReturnType<typeof createChartOfAccountsRepository>

  const AGORA = new Date('2026-09-15T12:00:00.000Z')

  async function criarEmpresa(cnpj: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpj}, ${`c@${cnpj}.local`}, '41999990000')
      `,
    )
    return id
  }

  async function criarConta(
    empresa: string,
    valorCents: number,
    vencimento: string,
    extras: { accountId?: string; status?: string; supplier?: string } = {},
  ): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO payables
          (id, company_id, supplier, description, amount_cents, due_date, account_id, status,
           cancelled_at)
        VALUES (${id}, ${empresa}, ${extras.supplier ?? 'Enel'}, 'Energia',
                ${valorCents}, ${vencimento}, ${extras.accountId ?? null},
                ${extras.status ?? 'open'},
                ${extras.status === 'cancelled' ? AGORA : null})
      `,
    )
    return id
  }

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0002_dominio_0909')

    admin = postgres(DATABASE_URL!, { max: 6, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresaA = await criarEmpresa(cnpjDeTeste('9'), 'Loja Contabil A')
    empresaB = await criarEmpresa(cnpjDeTeste('8'), 'Loja Contabil B')

    usuarioA = randomUUID()
    await admin`
      INSERT INTO users (id, name, email) VALUES (${usuarioA}, 'Dona', ${`k${usuarioA}@local`})
    `

    repo = createChartOfAccountsRepository(sql)

    /* As DUAS semeadas aqui. Semear dentro de um teste faria os seguintes
       dependerem da ordem em que o vitest os roda. */
    for (const empresa of [empresaA, empresaB]) {
      const entraram = await repo.insertDefaults(empresa, PLANO_DE_CONTAS_PADRAO, usuarioA, AGORA)
      expect(entraram).toBe(PLANO_DE_CONTAS_PADRAO.length)
    }
  }, 60_000)

  afterAll(async () => {
    if (!sql) {
      await admin?.end({ timeout: 5 })
      return
    }
    for (const empresa of [empresaA, empresaB].filter(Boolean)) {
      await withTenant(sql, empresa, async (tx) => {
        await tx`DELETE FROM payables`
        await tx`DELETE FROM receivables WHERE sale_id IS NOT NULL`
        await tx`DELETE FROM sale_items`
        await tx`DELETE FROM sales`
        await tx`DELETE FROM receivables`
        await tx`DELETE FROM ledger_accounts`
        await tx`DELETE FROM companies`
      })
    }
    await admin`DELETE FROM users WHERE id = ${usuarioA}`
    await aplicacao.encerrar()
    await admin.end({ timeout: 5 })
  })

  describe('o plano — RF-081, RF-082', () => {
    it('semear de novo nao duplica nem inventa conta', async () => {
      const antes = await repo.list(empresaA)

      const segunda = await repo.insertDefaults(empresaA, PLANO_DE_CONTAS_PADRAO, usuarioA, AGORA)

      /* A semeadura roda fora da transacao que cria a empresa: refazer precisa
         ser seguro, senao recuperar uma falha parcial deixa o plano em dobro. */
      expect(segunda).toBe(0)
      expect(await repo.list(empresaA)).toHaveLength(antes.length)
      expect(antes).toHaveLength(PLANO_DE_CONTAS_PADRAO.length)
    })

    it('devolve o plano na ordem do DRE, e nao na alfabetica', async () => {
      const plano = await repo.list(empresaA)
      const tipos = [...new Set(plano.map((c) => c.type))]

      /* O plano se le de cima para baixo como o relatorio. Alfabetica poria
         "custo" antes de "receita" e a tela leria ao contrario do DRE. */
      expect(tipos).toEqual(['revenue', 'deduction', 'cost', 'expense'])
    })

    it('duas caixas do mesmo nome sao a MESMA conta', async () => {
      await repo.insert({
        companyId: empresaA,
        name: 'Estacionamento',
        type: 'expense',
        isDefault: false,
        createdBy: usuarioA,
        createdAt: AGORA,
      })

      /* Sem o indice em `lower(name)` o lojista criaria a segunda sem perceber
         e o DRE mostraria a despesa partida em duas linhas que somam certo e
         leem errado. */
      await expect(
        repo.insert({
          companyId: empresaA,
          name: 'ESTACIONAMENTO',
          type: 'expense',
          isDefault: false,
          createdBy: usuarioA,
          createdAt: AGORA,
        }),
      ).rejects.toThrow(/duplicate key|accounts_nome_unico/i)
    })

    it('acha por nome sem depender da caixa', async () => {
      const achada = await repo.findByName(empresaA, 'aluguel')

      /* O caso de uso compara por aqui antes de inserir. Comparacao exata
         deixaria a recusa vir do banco como erro de servidor, em vez da
         mensagem que explica o que houve. */
      expect(achada?.name).toBe('Aluguel')
    })

    it('conta os lancamentos dos DOIS lados', async () => {
      const conta = await repo.findByName(empresaA, 'Aluguel')
      await criarConta(empresaA, 90_000, '2026-09-05', { accountId: conta!.id })

      const recebivel = randomUUID()
      await withTenant(
        sql,
        empresaA,
        (tx) => tx`
          INSERT INTO receivables
            (id, company_id, origin, description, amount_cents, net_amount_cents,
             due_date, account_id)
          VALUES (${recebivel}, ${empresaA}, 'manual', 'Sublocacao',
                  20000, 20000, '2026-09-06', ${conta!.id})
        `,
      )

      /* Uma consulta so: dois numeros obrigariam o caso de uso a somar, e a
         soma e a resposta. */
      expect(await repo.countEntries(empresaA, conta!.id)).toBe(2)
    })

    it('o banco recusa apagar conta com lancamento — RF-082', async () => {
      const conta = await repo.findByName(empresaA, 'Aluguel')

      /* O caso de uso ja recusa com uma mensagem boa ("esta conta tem 2
         lancamentos"). Isto aqui e a ultima linha de defesa: sem ela, um DELETE
         fora do caso de uso deixaria lancamento apontando para conta que nao
         existe, e o DRE somaria errado sem avisar. */
      await expect(repo.remove(empresaA, conta!.id)).rejects.toThrow(
        /violates foreign key|payables_account_id/i,
      )
    })
  })

  describe('classificar e sugerir — RF-083, RF-084', () => {
    it('grava a conta no lancamento', async () => {
      const conta = await repo.findByName(empresaA, 'Marketing')
      const titulo = await criarConta(empresaA, 15_000, '2026-09-07')

      await repo.classify(empresaA, 'payable', titulo, conta!.id)

      const [linha] = await withTenant(
        sql,
        empresaA,
        (tx) => tx<{ account_id: string | null }[]>`
          SELECT account_id FROM payables WHERE id = ${titulo}
        `,
      )
      expect(linha?.account_id).toBe(conta!.id)
    })

    it('o historico vem da mais usada para a menos', async () => {
      const energia = await repo.findByName(empresaA, 'Energia, agua e internet')
      const outras = await repo.findByName(empresaA, 'Outras despesas')

      for (const _ of [1, 2, 3]) {
        const t = await criarConta(empresaA, 1_000, '2026-09-08', { supplier: 'Copel' })
        await repo.classify(empresaA, 'payable', t, energia!.id)
      }
      const t = await criarConta(empresaA, 1_000, '2026-09-08', { supplier: 'Copel' })
      await repo.classify(empresaA, 'payable', t, outras!.id)

      const historico = await repo.historyFor(empresaA, 'payable', 'copel')

      /* Ordenar no repositorio porque a contagem e sobre o historico INTEIRO:
         trazer tudo para contar na aplicacao carregaria anos de lancamento
         para escolher uma linha. E `times` precisa ser NUMERO — como string,
         "9" viria depois de "10". */
      expect(historico[0]).toMatchObject({ accountId: energia!.id, times: 3 })
      expect(historico[1]).toMatchObject({ accountId: outras!.id, times: 1 })
    })
  })

  describe('os lancamentos do periodo — RF-085, RF-086', () => {
    it('sai por competencia e deixa o cancelado de fora', async () => {
      const aluguel = await repo.findByName(empresaB, 'Aluguel')

      await criarConta(empresaB, 50_000, '2026-10-05', { accountId: aluguel!.id })
      await criarConta(empresaB, 99_900, '2026-10-06', {
        accountId: aluguel!.id,
        status: 'cancelled',
      })

      const lancamentos = await repo.entriesBetween(empresaB, '2026-10-01', '2026-10-31')

      /* Conta cancelada nao e despesa: soma-la faria o resultado piorar por
         causa de algo que nao aconteceu. */
      expect(lancamentos).toHaveLength(1)
      expect(lancamentos[0]).toMatchObject({ amountCents: 50_000, occurredOn: '2026-10-05' })
    })

    it('quem nao tem conta ganha o tipo da propria natureza', async () => {
      await criarConta(empresaB, 7_700, '2026-11-03')

      const [semConta] = await repo.entriesBetween(empresaB, '2026-11-01', '2026-11-30')

      /* Sem isto, `accountType` teria de ser nulo e o DRE nao saberia de que
         lado somar o que ninguem classificou. Some-lo mudaria o total, e as
         linhas do relatorio deixariam de fechar com o resultado. */
      expect(semConta).toMatchObject({ accountId: null, accountType: 'expense' })
    })

    /* Achado do QA: sem a venda, o DRE nao tinha imposto, tarifa nem custo da
       mercadoria (margem bruta 100%), e a parcela do credito vencendo no mes
       seguinte levava a receita junto. */
    it('a venda entra na data dela, com imposto, custo e tarifa; o recebivel dela nao', async () => {
      const venda = randomUUID()
      await withTenant(sql, empresaB, async (tx) => {
        await tx`
          INSERT INTO sales
            (id, company_id, number, status, gross_amount_cents, discount_cents,
             tax_amount_cents, card_fee_amount_cents, cost_amount_cents, net_amount_cents,
             created_at)
          VALUES (${venda}, ${empresaB}, 1, 'settled', 10000, 500,
                  570, 300, 6000, 8630, '2027-01-10T15:00:00Z')
        `
        await tx`
          INSERT INTO receivables
            (company_id, sale_id, origin, description, amount_cents, net_amount_cents, due_date)
          VALUES (${empresaB}, ${venda}, 'sale', 'Parcela 2/2', 4750, 4750, '2027-01-20')
        `
      })

      const lancamentos = await repo.entriesBetween(empresaB, '2027-01-01', '2027-01-31')

      expect(
        Object.fromEntries(lancamentos.map((l) => [l.accountName, [l.accountType, l.amountCents]])),
      ).toEqual({
        vendas: ['revenue', 10000],
        descontos: ['deduction', 500],
        impostos: ['deduction', 570],
        cmv: ['cost', 6000],
        tarifas_cartao: ['expense', 300],
      })
    })

    it('a data nao recua um dia por causa de fuso', async () => {
      await criarConta(empresaB, 1_100, '2026-12-01')

      const lancamentos = await repo.entriesBetween(empresaB, '2026-12-01', '2026-12-01')

      /* `toISOString()` sobre o `Date` de uma coluna `date` recuaria para
         2026-11-30 em fuso negativo — e jogaria a despesa para o mes anterior. */
      expect(lancamentos[0]?.occurredOn).toBe('2026-12-01')
    })
  })

  describe('isolamento entre lojas', () => {
    it('o plano de uma nao aparece na outra', async () => {
      await repo.insert({
        companyId: empresaB,
        name: 'So da loja B',
        type: 'expense',
        isDefault: false,
        createdBy: usuarioA,
        createdAt: AGORA,
      })

      const daA = await repo.list(empresaA)

      expect(daA.map((c) => c.name)).not.toContain('So da loja B')
    })

    it('o mesmo nome de conta vale nas duas lojas', async () => {
      /* O indice unico e POR EMPRESA. Global, a segunda loja nao poderia ter
         "Aluguel" — que toda loja tem. */
      const daB = await repo.findByName(empresaB, 'Aluguel')
      const daA = await repo.findByName(empresaA, 'Aluguel')

      expect(daA?.id).not.toBe(daB?.id)
      expect(daA?.name).toBe(daB?.name)
    })
  })
})
