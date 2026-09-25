import { randomUUID } from 'node:crypto'
import {
  InMemoryAuditTrail,
  reverseSettlement,
  settlePayable,
  settleReceivable,
} from '@na-regua/core'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createSettlementQueries, createSettlementUnitOfWork } from './settlement-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Baixa e estorno de titulo — NR-029, RF-063 a RF-067.
 *
 * A regra tem teste em `core`, contra falso. O que se prova AQUI e o que so o
 * banco prova: que baixa e saldo entram na MESMA transacao, que o estorno e uma
 * linha negativa e nao um DELETE, que estornar duas vezes e recusado, que o
 * fiado do cliente anda junto, e que nada disso enxerga a loja do lado.
 *
 * O caso de uso de `core` roda de verdade contra este repositorio — nao ha
 * falso nenhum no meio. E o que faz este arquivo pegar fiacao errada, e nao
 * apenas SQL errado.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('baixa e estorno — NR-029', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string
  let usuario: string

  let uow: ReturnType<typeof createSettlementUnitOfWork>
  let baixas: ReturnType<typeof createSettlementQueries>

  const AGORA = new Date('2026-09-07T12:00:00.000Z')
  const HOJE = '2026-09-07'

  const contexto = (companyId: string) => ({
    companyId,
    userId: usuario,
    role: 'owner' as const,
    channel: 'app' as const,
    requestId: 'req-baixa',
    now: AGORA,
  })

  const deps = () => ({ uow, audit: new InMemoryAuditTrail() })

  async function criarEmpresa(cnpj: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpj}, ${`b@${cnpj}.local`}, '41999990000')
      `,
    )
    return id
  }

  async function criarPagavel(empresa: string, valorCents: number): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO payables (id, company_id, supplier, description, amount_cents, due_date)
        VALUES (${id}, ${empresa}, 'Enel', 'Energia', ${valorCents}, ${HOJE})
      `,
    )
    return id
  }

  async function criarCliente(empresa: string, saldoCents: number): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO customers (id, company_id, name, wallet_balance_cents)
        VALUES (${id}, ${empresa}, 'Maria Fiado', ${saldoCents})
      `,
    )
    return id
  }

  async function criarRecebivel(
    empresa: string,
    valorCents: number,
    clienteId: string | null,
  ): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO receivables
          (id, company_id, customer_id, origin, description, amount_cents,
           net_amount_cents, due_date, is_customer_debt)
        VALUES (${id}, ${empresa}, ${clienteId}, 'manual', 'Venda fiado', ${valorCents},
                ${valorCents}, ${HOJE},
                /* Com cliente, e divida dele — a mesma regra de
                   "nasceComoDividaDoCliente" para recebivel avulso. */
                ${clienteId !== null})
      `,
    )
    return id
  }

  const lerPagavel = (empresa: string, id: string) =>
    withTenant(
      sql,
      empresa,
      (tx) => tx<{ settled_amount_cents: string; status: string }[]>`
        SELECT settled_amount_cents, status FROM payables WHERE id = ${id}
      `,
    )

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0002_dominio_0909')

    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresaA = await criarEmpresa(cnpjDeTeste('8'), 'Loja Baixas A')
    empresaB = await criarEmpresa(cnpjDeTeste('9'), 'Loja Baixas B')

    usuario = randomUUID()
    await admin`
      INSERT INTO users (id, name, email) VALUES (${usuario}, 'Dona', ${`b${usuario}@local`})
    `

    uow = createSettlementUnitOfWork(sql)

    baixas = createSettlementQueries(sql)
  }, 60_000)

  afterAll(async () => {
    if (!sql) {
      await admin?.end({ timeout: 5 })
      return
    }
    for (const empresa of [empresaA, empresaB].filter(Boolean)) {
      await withTenant(sql, empresa, async (tx) => {
        await tx`DELETE FROM settlements`
        await tx`DELETE FROM settlements`
        await tx`DELETE FROM payables`
        await tx`DELETE FROM receivables`
        await tx`DELETE FROM customers`
        await tx`DELETE FROM companies`
      })
    }
    await admin`DELETE FROM users WHERE id = ${usuario}`
    await aplicacao.encerrar()
    await admin.end({ timeout: 5 })
  })

  describe('conta a pagar — RF-063', () => {
    it('baixa total muda o saldo E o status, juntos', async () => {
      const conta = await criarPagavel(empresaA, 50_000)

      const baixa = await settlePayable(deps(), contexto(empresaA), {
        payableId: conta,
        amountCents: 50_000,
        settledOn: HOJE,
        bankAccount: 'Itau 1234',
      })

      expect(baixa.amountCents).toBe(50_000)

      const [depois] = await lerPagavel(empresaA, conta)
      expect(Number(depois!.settled_amount_cents)).toBe(50_000)
      expect(depois!.status).toBe('settled')
    })

    it('baixa parcial deixa o titulo parcialmente baixado', async () => {
      const conta = await criarPagavel(empresaA, 50_000)

      await settlePayable(deps(), contexto(empresaA), {
        payableId: conta,
        amountCents: 20_000,
        settledOn: HOJE,
        bankAccount: 'Itau 1234',
      })

      const [depois] = await lerPagavel(empresaA, conta)
      expect(Number(depois!.settled_amount_cents)).toBe(20_000)
      /* Nem `open` nem `settled`: o lojista precisa ver que pagou parte. */
      expect(depois!.status).toBe('partially_settled')
    })

    it('duas baixas parciais somam e fecham o titulo', async () => {
      const conta = await criarPagavel(empresaA, 50_000)

      for (const valor of [30_000, 20_000]) {
        await settlePayable(deps(), contexto(empresaA), {
          payableId: conta,
          amountCents: valor,
          settledOn: HOJE,
          bankAccount: 'Itau 1234',
        })
      }

      const [depois] = await lerPagavel(empresaA, conta)
      expect(Number(depois!.settled_amount_cents)).toBe(50_000)
      expect(depois!.status).toBe('settled')
    })

    it('recusa baixar mais do que se deve', async () => {
      const conta = await criarPagavel(empresaA, 10_000)

      await expect(
        settlePayable(deps(), contexto(empresaA), {
          payableId: conta,
          amountCents: 15_000,
          settledOn: HOJE,
          bankAccount: 'Itau 1234',
        }),
      ).rejects.toThrow()

      /* E o titulo NAO pode ter mudado: a transacao inteira volta atras. */
      const [depois] = await lerPagavel(empresaA, conta)
      expect(Number(depois!.settled_amount_cents)).toBe(0)
      expect(depois!.status).toBe('open')
    })

    it('nao baixa titulo de outra loja', async () => {
      const conta = await criarPagavel(empresaA, 10_000)

      await expect(
        settlePayable(deps(), contexto(empresaB), {
          payableId: conta,
          amountCents: 10_000,
          settledOn: HOJE,
          bankAccount: 'Itau 1234',
        }),
      ).rejects.toThrow()
    })
  })

  describe('recebivel e o fiado — RF-064, RF-013', () => {
    it('baixa de recebivel abate o saldo devedor do cliente', async () => {
      const cliente = await criarCliente(empresaA, 30_000)
      const titulo = await criarRecebivel(empresaA, 30_000, cliente)

      await settleReceivable(deps(), contexto(empresaA), {
        receivableId: titulo,
        amountCents: 30_000,
        settledOn: HOJE,
        method: 'pix',
      })

      const [depois] = await withTenant(
        sql,
        empresaA,
        (tx) => tx<{ wallet_balance_cents: string }[]>`
          SELECT wallet_balance_cents FROM customers WHERE id = ${cliente}
        `,
      )

      /* Quem pagou o fiado deixa de dever. Sem isto o saldo ficaria parado e o
         cliente apareceria devendo algo que ja quitou. */
      expect(Number(depois!.wallet_balance_cents)).toBe(0)
    })
  })

  describe('estorno — RF-067', () => {
    it('grava uma linha NEGATIVA e devolve o saldo, sem apagar a baixa', async () => {
      const conta = await criarPagavel(empresaA, 40_000)
      const baixa = await settlePayable(deps(), contexto(empresaA), {
        payableId: conta,
        amountCents: 40_000,
        settledOn: HOJE,
        bankAccount: 'Itau 1234',
      })

      const estorno = await reverseSettlement(deps(), contexto(empresaA), {
        settlementId: baixa.id,
        reason: 'Pagamento em duplicidade',
      })

      expect(estorno.amountCents).toBeLessThan(0)
      expect(estorno.reversesId).toBe(baixa.id)

      const [depois] = await lerPagavel(empresaA, conta)
      expect(Number(depois!.settled_amount_cents)).toBe(0)
      expect(depois!.status).toBe('open')

      /* A baixa original CONTINUA la. Quem confere o caixa do dia precisa ver
         que houve uma baixa e um estorno, e nao um buraco onde a baixa estava. */
      const linhas = await withTenant(
        sql,
        empresaA,
        (tx) => tx<{ total: string }[]>`
          SELECT count(*)::text AS total FROM settlements WHERE payable_id = ${conta}
        `,
      )
      expect(Number(linhas[0]!.total)).toBe(2)
    })

    it('recusa estornar a mesma baixa duas vezes', async () => {
      const conta = await criarPagavel(empresaA, 20_000)
      const baixa = await settlePayable(deps(), contexto(empresaA), {
        payableId: conta,
        amountCents: 20_000,
        settledOn: HOJE,
        bankAccount: 'Itau 1234',
      })

      await reverseSettlement(deps(), contexto(empresaA), {
        settlementId: baixa.id,
        reason: 'Primeiro estorno',
      })

      /* Sem esta guarda, duas linhas negativas fariam o titulo dever MAIS do
         que devia — e o saldo ficaria negativo sem ninguem entender por que. */
      await expect(
        reverseSettlement(deps(), contexto(empresaA), {
          settlementId: baixa.id,
          reason: 'Segundo estorno',
        }),
      ).rejects.toThrow()
    })

    it('acha a baixa nas duas tabelas — quem estorna nao sabe de qual e', async () => {
      const cliente = await criarCliente(empresaA, 15_000)
      const titulo = await criarRecebivel(empresaA, 15_000, cliente)
      const baixa = await settleReceivable(deps(), contexto(empresaA), {
        receivableId: titulo,
        amountCents: 15_000,
        settledOn: HOJE,
        method: 'cash',
      })

      /* Mesma rota, mesmo caso de uso, outra tabela. */
      const estorno = await reverseSettlement(deps(), contexto(empresaA), {
        settlementId: baixa.id,
        reason: 'Cliente pediu de volta',
      })

      expect(estorno.reversesId).toBe(baixa.id)
      expect(estorno.amountCents).toBe(-15_000)
    })
  })

  /**
   * O historico de baixas — RF-067.
   *
   * A tela precisa dele para estornar: o estorno endereca a BAIXA, e a lista de
   * titulos nao traz os ids delas.
   *
   * O que se prova aqui e o que so o banco prova. Que a consulta acha as baixas
   * na tabela CERTA das duas. Que o estorno aparece junto, negativo — porque
   * somar as linhas tem de dar o saldo baixado, e uma lista que esconde o
   * estorno discordaria do titulo. E, sobretudo, que a empresa do lado nao ve
   * nada: e a unica consulta de baixa que nasce FORA da transacao de escrita, e
   * uma que esquecesse `withTenant` devolveria a loja errada em silencio.
   */
  describe('historico de baixas — RF-067', () => {
    it('lista as baixas de uma conta a pagar, com o estorno junto', async () => {
      const conta = await criarPagavel(empresaA, 30_000)

      const primeira = await settlePayable(deps(), contexto(empresaA), {
        payableId: conta,
        amountCents: 10_000,
        settledOn: HOJE,
        bankAccount: 'Itau 1234',
      })
      const segunda = await settlePayable(deps(), contexto(empresaA), {
        payableId: conta,
        amountCents: 20_000,
        settledOn: HOJE,
        bankAccount: 'Itau 1234',
      })
      await reverseSettlement(deps(), contexto(empresaA), {
        settlementId: segunda.id,
        reason: 'Lancada na conta errada',
      })

      const lista = await baixas.listByTitulo(empresaA, 'payable', conta)

      expect(lista).toHaveLength(3)
      /* Somar as linhas da o saldo baixado — a propriedade que o estorno
         negativo preserva, e a razao de ele nao ser omitido daqui. */
      expect(lista.reduce((acc, b) => acc + b.amountCents, 0)).toBe(10_000)
      expect(lista.some((b) => b.id === primeira.id)).toBe(true)
      expect(lista.filter((b) => b.reversesId === segunda.id)).toHaveLength(1)
      /* Toda linha aponta o titulo, e nenhuma se confunde com recebivel. */
      expect(lista.every((b) => b.payableId === conta && b.receivableId === null)).toBe(true)
    })

    it('lista as baixas de um recebivel — a outra tabela', async () => {
      const cliente = await criarCliente(empresaA, 25_000)
      const titulo = await criarRecebivel(empresaA, 25_000, cliente)

      const baixa = await settleReceivable(deps(), contexto(empresaA), {
        receivableId: titulo,
        amountCents: 25_000,
        settledOn: HOJE,
        method: 'pix',
      })

      const lista = await baixas.listByTitulo(empresaA, 'receivable', titulo)

      expect(lista).toHaveLength(1)
      expect(lista[0]!.id).toBe(baixa.id)
      expect(lista[0]!.receivableId).toBe(titulo)
      expect(lista[0]!.payableId).toBeNull()
      /* A forma do RECEBIMENTO, que so esta tabela guarda. */
      expect(lista[0]!.method).toBe('pix')
    })

    it('nao devolve a baixa da loja do lado', async () => {
      const conta = await criarPagavel(empresaA, 12_000)
      await settlePayable(deps(), contexto(empresaA), {
        payableId: conta,
        amountCents: 12_000,
        settledOn: HOJE,
        bankAccount: 'Itau 1234',
      })

      /*
       * MESMO id de titulo, tenant diferente. Sem `withTenant`, a consulta
       * filtra so por `payable_id` e devolveria a baixa da empresa A — e como
       * ela existe e o id confere, nada pareceria errado.
       */
      expect(await baixas.listByTitulo(empresaB, 'payable', conta)).toHaveLength(0)
    })

    it('titulo sem baixa devolve lista vazia, e nao erro', async () => {
      const conta = await criarPagavel(empresaA, 5_000)

      /* A tela abre o historico de qualquer titulo. Vazio e uma resposta. */
      expect(await baixas.listByTitulo(empresaA, 'payable', conta)).toEqual([])
    })
  })
})
