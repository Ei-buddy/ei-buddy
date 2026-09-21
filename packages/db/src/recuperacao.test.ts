import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createRetrievalStore } from './retrieval-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Recuperacao auxiliar por trigrama — NR-120, RF-102, ADR-0017.
 *
 * O que se prova aqui e o que so o Postgres pode dizer: se "coca 2l" acha
 * "Coca-Cola 2 litros", se o acento atrapalha, e se o indice isola por
 * empresa. Nenhum teste em memoria responde isso — `similarity()` e do banco.
 *
 * Como as outras suites de `db`: pulada sem `DATABASE_URL`, executada na CI.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('recuperacao auxiliar — NR-120', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string

  async function criarEmpresa(cnpj: string, nome: string): Promise<string> {
    const id = randomUUID()
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

  const AGORA = new Date('2026-09-20T12:00:00.000Z')

  async function indexar(empresa: string, conteudo: string, refId = randomUUID()) {
    await createRetrievalStore(sql).indexar({
      companyId: empresa,
      kind: 'product',
      refId,
      conteudo,
      atualizadoEm: AGORA,
    })
    return refId
  }

  const buscar = (empresa: string, consulta: string, k = 5) =>
    createRetrievalStore(sql).buscar({ companyId: empresa, consulta, k })

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0027_recuperacao_auxiliar')

    admin = postgres(DATABASE_URL!, { max: 3, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresaA = await criarEmpresa(cnpjDeTeste('2'), 'Mercearia A')
    empresaB = await criarEmpresa(cnpjDeTeste('3'), 'Mercearia B')

    await indexar(empresaA, 'Coca-Cola 2 litros')
    await indexar(empresaA, 'Coca-Cola lata 350ml')
    await indexar(empresaA, 'Sabão em pó OMO 1kg')
    await indexar(empresaA, 'Arroz tipo 1 5kg')
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar?.()
    await admin?.end({ timeout: 5 })
  })

  it('portugues de balcao acha o produto — o caso da RF-102', async () => {
    const r = await buscar(empresaA, 'coca 2l')

    /* E para isso que a tabela existe: a pessoa escreve um terco do nome. */
    expect(r[0]?.conteudo).toBe('Coca-Cola 2 litros')
  })

  it('acento nao atrapalha, nos dois sentidos', async () => {
    /* A normalizacao roda ao gravar E ao consultar; se so um lado fizesse,
       este teste cairia. */
    expect((await buscar(empresaA, 'sabao em po'))[0]?.conteudo).toBe('Sabão em pó OMO 1kg')
    expect((await buscar(empresaA, 'SABÃO'))[0]?.conteudo).toBe('Sabão em pó OMO 1kg')
  })

  it('ordena do mais parecido, e traz o id para a tool', async () => {
    const r = await buscar(empresaA, 'coca cola')

    expect(r.length).toBeGreaterThanOrEqual(2)
    expect(r[0]!.relevancia).toBeGreaterThanOrEqual(r[1]!.relevancia)
    /* O que a tool vai receber. Sem o id, o candidato nao serve para nada. */
    expect(r[0]?.refId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('um pedaco curto do nome ja acha — e por isso e word_similarity', async () => {
    /* `similarity` compara os textos por inteiro e penaliza a diferenca de
       tamanho: "coca" contra "coca-cola 2 litros" ficava abaixo de qualquer
       piso util. Foi a CI que mostrou. */
    expect((await buscar(empresaA, 'coca')).length).toBeGreaterThanOrEqual(2)
  })

  it('`k` limita de verdade — o teto de tokens depende disso', async () => {
    expect(await buscar(empresaA, 'coca', 1)).toHaveLength(1)
  })

  it('consulta sem nada parecido devolve vazio, e nao o menos ruim', async () => {
    /* Palpite ruim e pior que nada: o assistente sugeriria um produto sem
       relacao, e o lojista confirmaria sem reler. */
    expect(await buscar(empresaA, 'bicicleta ergometrica')).toHaveLength(0)
  })

  it('consulta vazia nao vai ao banco', async () => {
    expect(await buscar(empresaA, '   ')).toHaveLength(0)
  })

  it('reindexar o mesmo produto ATUALIZA, e o nome velho para de responder', async () => {
    const id = await indexar(empresaA, 'Biscoito recheado morango')
    expect((await buscar(empresaA, 'biscoito morango'))[0]?.conteudo).toBe(
      'Biscoito recheado morango',
    )

    await indexar(empresaA, 'Bolacha recheada chocolate', id)

    /* Sem o upsert, o lojista veria o assistente sugerir um nome que ele mesmo
       corrigiu. */
    expect(await buscar(empresaA, 'biscoito morango')).toHaveLength(0)
    expect((await buscar(empresaA, 'bolacha chocolate'))[0]?.conteudo).toBe(
      'Bolacha recheada chocolate',
    )
  })

  it('remover tira da busca', async () => {
    const id = await indexar(empresaA, 'Detergente neutro 500ml')
    await createRetrievalStore(sql).remover({ companyId: empresaA, kind: 'product', refId: id })

    /* Produto apagado nao pode continuar sendo sugerido. */
    expect(await buscar(empresaA, 'detergente neutro')).toHaveLength(0)
  })

  it('o catalogo de uma loja nao aparece na busca da outra', async () => {
    await indexar(empresaB, 'Coca-Cola 2 litros')

    const daB = await buscar(empresaB, 'coca 2l')

    /* RLS por `app.company_id`. Um vazamento aqui entregaria o catalogo do
       vizinho pelo assistente. */
    expect(daB).toHaveLength(1)
    expect((await buscar(empresaA, 'coca 2l')).map((c) => c.refId)).not.toContain(daB[0]?.refId)
  })
})
