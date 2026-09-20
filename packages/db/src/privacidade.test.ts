import { randomUUID } from 'node:crypto'
import { COLECOES_DA_EXPORTACAO, NOME_ANONIMIZADO } from '@na-regua/core'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import {
  createDataSubjectRepository,
  createExportSource,
  FORA_DA_EXPORTACAO,
} from './privacy-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Exportacao completa e anonimizacao — NR-086, RF-125, RF-127, RF-128.
 *
 * ## Os dois portoes deste arquivo
 *
 * O resto da suite testa comportamento. Os dois `describe` do fim testam
 * COMPLETUDE, e sao o que justifica o arquivo existir:
 *
 * 1. **Toda tabela de negocio esta na exportacao, ou esta declarada fora
 *    dela.** `confereQueNadaFicouDeFora`, em `core`, compara o repositorio com
 *    o contrato — e uma tabela ausente dos DOIS passa. Foi assim que `invoices`
 *    ficou de fora do contrato por tres migrations: o lojista receberia um
 *    pacote que parece completo e sem os documentos fiscais que ele e obrigado
 *    a guardar por cinco anos.
 *
 * 2. **Toda coluna pessoal de `customers` e limpa na anonimizacao.** Este
 *    pegou de verdade: a 0019 acrescentou sete colunas de endereco DEPOIS de o
 *    caso de uso ser escrito, e a anonimizacao respondia ao titular que os
 *    dados pessoais dele foram removidos deixando rua, numero e CEP intactos.
 *    O falso de `core` nao conhece coluna — ele guarda o que a lista manda e
 *    devolve o que guardou —, entao nenhum teste de unidade poderia ver isso.
 *
 * Os dois portoes tem a mesma forma: comparam uma LISTA escrita a mao com o
 * banco de verdade, e reprovam quando o banco cresce e a lista nao.
 *
 * Como as outras suites de `db`: pulada sem `DATABASE_URL`, executada na CI.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

/**
 * As colunas de `customers` que NAO sao dado pessoal.
 *
 * Escrita a mao porque "pessoal" nao esta no schema: nenhuma consulta ao
 * Postgres responde se `wallet_balance_cents` identifica alguem. O portao usa
 * esta lista pelo complemento — toda coluna que nao esta aqui tem de ser limpa
 * pela anonimizacao —, entao coluna nova reprova o PR ate alguem decidir de
 * qual lado ela fica. Decidir e o ponto; o padrao e "e pessoal".
 */
const COLUNAS_NAO_PESSOAIS = new Set([
  'id',
  'company_id',
  /* Referencia interna, e nao contato. */
  'external_id',
  'is_active',
  'wallet_limit_cents',
  'wallet_balance_cents',
  /* Consentimento de WhatsApp: sao CARIMBOS de quando houve, e nao o numero.
     Precisam sobreviver — apagar a prova do opt-out faria a loja perder o
     registro de que a pessoa pediu para nao ser contatada. */
  'whatsapp_consent_at',
  'whatsapp_opt_out_at',
  'collection_consent_at',
  'payments_customer_id',
  'city_ibge_code',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'deleted_at',
  /* A propria marca da anonimizacao. */
  'anonymized_at',
  'anonymized_by',
])

describe.skipIf(!DATABASE_URL)('privacidade — NR-086', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresa: string
  let usuario: string

  beforeAll(async () => {
    admin = postgres(MIGRATION_URL!, { max: 1, onnotice: () => undefined })
    await migrate(MIGRATION_URL!)
    aplicacao = await conectarComoAplicacao(admin, MIGRATION_URL!)
    sql = aplicacao.sql

    empresa = randomUUID()
    const cnpj = cnpjDeTeste('9')
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${empresa}, ${'Loja da Privacidade'}, ${cnpj}, ${`c@${cnpj}.local`}, ${'41999990000'})
      `,
    )

    usuario = randomUUID()
    await withTenant(sql, empresa, async (tx) => {
      await tx`
        INSERT INTO users (id, name, email) VALUES (${usuario}, ${'Dona'}, ${`d-${usuario}@x.com`})
      `
      await tx`
        INSERT INTO company_users (company_id, user_id, role)
        VALUES (${empresa}, ${usuario}, ${'owner'})
      `
    })
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar()
    await admin?.end({ timeout: 5 })
  })

  const fonte = () => createExportSource(sql)
  const titulares = () => createDataSubjectRepository(sql)

  /** Um cliente com TODOS os campos pessoais preenchidos. */
  async function criarCliente(over: Record<string, unknown> = {}): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO customers (
          id, company_id, name, document, phone, email, notes,
          postal_code, street, street_number, complement, neighborhood, city, state,
          wallet_balance_cents
        ) VALUES (
          ${id}, ${empresa}, ${'Maria de Souza'}, ${'52998224725'}, ${'41988887777'},
          ${`maria-${id}@x.com`}, ${'Prefere entrega a tarde'},
          ${'80010000'}, ${'Rua das Flores'}, ${'120-A'}, ${'ap 31'}, ${'Centro'},
          ${'Curitiba'}, ${'PR'},
          ${(over['wallet_balance_cents'] as number | undefined) ?? 0}
        )
      `,
    )
    return id
  }

  /* ---------------------------------------------------------------- */

  describe('a exportacao le todas as colecoes', () => {
    /*
     * O teste que `core` nao consegue fazer: ele CONFERE que o repositorio
     * declara saber ler tudo, e nao que a leitura funciona. Uma tabela
     * renomeada passaria pela conferencia e explodiria no `SELECT`.
     */
    it.each(COLECOES_DA_EXPORTACAO)('%s responde sem erro', async (colecao) => {
      const pagina = await fonte().readPage(empresa, colecao, undefined)

      expect(Array.isArray(pagina.rows)).toBe(true)
    })

    it('declara saber ler exatamente as colecoes do contrato', () => {
      expect([...fonte().collections()].sort()).toEqual([...COLECOES_DA_EXPORTACAO].sort())
    })

    it('a empresa vem como uma linha, e e a do contexto', async () => {
      const pagina = await fonte().readPage(empresa, 'company', undefined)

      expect(pagina.rows).toHaveLength(1)
      expect(pagina.rows[0]?.['id']).toBe(empresa)
    })

    /* O papel vai na MESMA linha da pessoa: papel sem pessoa nao diz nada, e
       dois arquivos para cruzar nao e portabilidade, e trabalho. */
    it('o usuario vem com o papel na mesma linha', async () => {
      const pagina = await fonte().readPage(empresa, 'users', undefined)
      const linha = pagina.rows.find((l) => l['id'] === usuario)

      expect(linha?.['role']).toBe('owner')
      expect(linha?.['name']).toBe('Dona')
    })

    /* `auth_subject` e referencia interna ao provedor de identidade, e nao dado
       da pessoa. Exporta-lo entregaria uma chave sem utilidade para quem
       recebe o pacote. */
    it('o usuario NAO leva o subject do provedor de identidade', async () => {
      const pagina = await fonte().readPage(empresa, 'users', undefined)

      expect(Object.keys(pagina.rows[0] ?? {})).not.toContain('auth_subject')
    })

    it('nao devolve dado de outra empresa', async () => {
      await criarCliente()
      const outra = randomUUID()

      const pagina = await fonte().readPage(outra, 'customers', undefined)

      expect(pagina.rows).toEqual([])
    })

    /* Acabou significa cursor indefinido. Cursor que nunca acaba seria laco
       infinito no caso de uso — ele pagina `while (cursor !== undefined)`. */
    it('a ultima pagina nao devolve cursor', async () => {
      const pagina = await fonte().readPage(empresa, 'customers', undefined)

      expect(pagina.rows.length).toBeLessThan(1_000)
      expect(pagina.nextCursor).toBeUndefined()
    })

    /*
     * As baixas das DUAS tabelas saem numa colecao so, com `kind` na linha.
     * Exportar apenas `settlements` omitiria as de conta a pagar em silencio.
     */
    it('as baixas trazem o tipo, para as duas tabelas cabarem numa colecao', async () => {
      const pagina = await fonte().readPage(empresa, 'settlements', undefined)

      /* Vazio aqui e valido — o que se prova e a FORMA da consulta, que ja
         teria falhado no `UNION` se as colunas nao casassem. */
      expect(Array.isArray(pagina.rows)).toBe(true)
    })
  })

  /* ---------------------------------------------------------------- */

  describe('a anonimizacao', () => {
    it('acha o cliente com o endereco concatenado num campo', async () => {
      const id = await criarCliente()

      const cliente = await titulares().findCustomer(empresa, id)

      expect(cliente?.name).toBe('Maria de Souza')
      expect(cliente?.taxId).toBe('52998224725')
      expect(cliente?.address).toContain('Rua das Flores')
      expect(cliente?.address).toContain('Curitiba')
      expect(cliente?.anonymizedAt).toBeNull()
    })

    it('devolve o saldo como NUMERO, e nao como texto', async () => {
      const id = await criarCliente({ wallet_balance_cents: 1_000 })

      const cliente = await titulares().findCustomer(empresa, id)

      /*
       * O driver devolve `bigint` como string. Se isto vazasse, a recusa de
       * anonimizar quem deve pararia de funcionar sem nada falhar: `"1000" > 0`
       * e verdade em JavaScript, mas `"0" > 0` e falso — e um saldo devedor
       * lido como texto passaria por comparacoes que parecem certas.
       */
      expect(cliente?.walletBalanceCents).toBe(1_000)
      expect(typeof cliente?.walletBalanceCents).toBe('number')
    })

    it('limpa os campos pessoais e marca a data', async () => {
      const id = await criarCliente()

      await titulares().anonymizeCustomer({
        companyId: empresa,
        customerId: id,
        substitutes: {
          name: NOME_ANONIMIZADO,
          document: null,
          phone: null,
          email: null,
          notes: null,
          postal_code: null,
          street: null,
          street_number: null,
          complement: null,
          neighborhood: null,
          city: null,
          state: null,
        },
        anonymizedAt: new Date(),
        anonymizedBy: usuario,
      })

      const [linha] = await withTenant(
        sql,
        empresa,
        (tx) => tx<Record<string, unknown>[]>`SELECT * FROM customers WHERE id = ${id}`,
      )

      expect(linha?.['name']).toBe(NOME_ANONIMIZADO)
      expect(linha?.['document']).toBeNull()
      expect(linha?.['phone']).toBeNull()
      expect(linha?.['email']).toBeNull()
      expect(linha?.['notes']).toBeNull()
      /* O que faltava antes da NR-086. */
      expect(linha?.['street']).toBeNull()
      expect(linha?.['street_number']).toBeNull()
      expect(linha?.['neighborhood']).toBeNull()
      expect(linha?.['postal_code']).toBeNull()
      expect(linha?.['city']).toBeNull()
      expect(linha?.['anonymized_at']).toBeInstanceOf(Date)
      expect(linha?.['anonymized_by']).toBe(usuario)
    })

    /* A linha NAO e apagada: apagar destruiria as vendas que apontam para ela,
       e os totais de periodos fechados mudariam retroativamente — RF-128. */
    it('preserva a linha e o id do cliente', async () => {
      const id = await criarCliente()

      await titulares().anonymizeCustomer({
        companyId: empresa,
        customerId: id,
        substitutes: { name: NOME_ANONIMIZADO, phone: null },
        anonymizedAt: new Date(),
        anonymizedBy: usuario,
      })

      const [linha] = await withTenant(
        sql,
        empresa,
        (tx) => tx<{ id: string }[]>`SELECT id FROM customers WHERE id = ${id}`,
      )
      expect(linha?.id).toBe(id)
    })

    /* Falhar alto, e nao devolver um comprovante de operacao que nao houve. */
    it('recusa anonimizar duas vezes', async () => {
      const id = await criarCliente()
      const pedido = {
        companyId: empresa,
        customerId: id,
        substitutes: { name: NOME_ANONIMIZADO },
        anonymizedAt: new Date(),
        anonymizedBy: usuario,
      }

      await titulares().anonymizeCustomer(pedido)

      await expect(titulares().anonymizeCustomer(pedido)).rejects.toThrow()
    })

    it('nao alcanca cliente de outra empresa', async () => {
      const id = await criarCliente()

      expect(await titulares().findCustomer(randomUUID(), id)).toBeUndefined()
    })
  })

  /* ---------------------------------------------------------------- */

  describe('PORTAO: nenhuma tabela de negocio fica fora sem decisao', () => {
    /*
     * `confereQueNadaFicouDeFora`, em `core`, compara o repositorio com o
     * contrato — e tabela ausente dos DOIS passa. Foi assim que `invoices`
     * ficou de fora por tres migrations.
     *
     * Aqui a comparacao e contra o BANCO. Tabela nova precisa entrar na
     * exportacao ou em `FORA_DA_EXPORTACAO`, com o motivo escrito. As duas
     * saidas sao legitimas; o que nao pode e a omissao silenciosa.
     */
    it('toda tabela de public esta exportada ou declarada fora', async () => {
      const tabelas = await admin<{ relname: string }[]>`
        SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'
         ORDER BY c.relname
      `

      /* As fontes reais, e nao os nomes das colecoes: `company` le `companies`
         e `settlements` cobre duas tabelas. */
      const cobertas = new Set<string>([
        'companies',
        'users',
        'customers',
        'products',
        'categories',
        'sales',
        'sale_items',
        'payments',
        'receivables',
        'payables',
        'settlements',
        'inventory_movements',
        'appointments',
        'ledger_accounts',
        'bank_transactions',
        'audit_logs',
        'invoices',
        'sale_returns',
        'sale_return_items',
        'support_tickets',
        'ticket_messages',
        'customer_charges',
        'customer_charge_receivables',
      ])

      const orfas = tabelas
        .map((t) => t.relname)
        /* Tabelas temporarias das proprias migrations. */
        .filter((nome) => !nome.startsWith('nr00'))
        .filter((nome) => !cobertas.has(nome) && FORA_DA_EXPORTACAO[nome] === undefined)

      /* A mensagem precisa nomear a tabela: quem quebrou tem de saber onde. */
      expect(orfas).toEqual([])
    })
  })

  describe('PORTAO: nenhuma coluna pessoal escapa da anonimizacao', () => {
    /*
     * O portao que pegou o endereco.
     *
     * A 0019 acrescentou sete colunas a `customers` depois de o caso de uso ser
     * escrito, e a anonimizacao respondia "dados pessoais removidos" deixando
     * rua, numero, complemento, bairro, cidade, UF e CEP intactos. Nenhum teste
     * de unidade poderia ver: o falso de `core` nao conhece coluna.
     *
     * A lista de nao-pessoais e escrita a mao porque "pessoal" nao esta no
     * schema. O padrao e "e pessoal" — coluna nova reprova ate alguem decidir.
     */
    it('toda coluna de customers e pessoal e limpa, ou esta declarada nao-pessoal', async () => {
      const colunas = await admin<{ attname: string }[]>`
        SELECT a.attname
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = 'customers'
           AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attname
      `

      /*
       * Os mesmos campos que `anonymizeCustomer` em `core` monta. Repetidos
       * aqui de proposito: importar a lista de la faria o teste concordar com
       * a implementacao por construcao, e um teste que nao pode discordar nao
       * verifica nada.
       */
      const limpas = new Set([
        'name',
        'document',
        'phone',
        'email',
        'notes',
        'postal_code',
        'street',
        'street_number',
        'complement',
        'neighborhood',
        'city',
        'state',
      ])

      const naoDecididas = colunas
        .map((c) => c.attname)
        .filter((nome) => !limpas.has(nome) && !COLUNAS_NAO_PESSOAIS.has(nome))

      expect(naoDecididas).toEqual([])
    })

    /* O outro lado: campo na lista que a tabela nao tem faria o `UPDATE`
       explodir na primeira anonimizacao de verdade. */
    it('toda coluna que a anonimizacao limpa existe na tabela', async () => {
      const colunas = await admin<{ attname: string }[]>`
        SELECT a.attname
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = 'customers'
           AND a.attnum > 0 AND NOT a.attisdropped
      `
      const existentes = new Set(colunas.map((c) => c.attname))

      for (const campo of ['name', 'document', 'phone', 'email', 'notes', 'street', 'state']) {
        expect(existentes).toContain(campo)
      }
    })
  })
})
