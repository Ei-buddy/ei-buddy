import { randomUUID } from 'node:crypto'
import type { StatementParseResult } from '@na-regua/contracts'
import {
  InMemoryAuditTrail,
  InMemoryReconciliation,
  type NewBankTransaction,
  type StatementFile,
} from '@na-regua/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import type { AuthenticatedPrincipal } from '../plugins/execution-context.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { type ConciliacaoDeps, registerConciliacaoRoutes } from './conciliacao.js'

/**
 * Rotas de extrato e conciliacao — NR-076, RF-076 a RF-080.
 *
 * As regras (janela de data, casamento por valor, quem pode escrever) tem teste
 * proprio em `core`. Aqui se prova o que so a rota faz: a forma que entra, o
 * codigo que sai, e as duas recusas que existem SO nesta borda — `accountId`
 * sem tabela e base64 corrompido no envio.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  companyId: 'empresa-1',
  userId: 'usuario-1',
  role: 'owner',
}

const EMPRESA = 'empresa-1'

/** Extrato falso: devolve o que o teste mandar, sem ler byte nenhum. */
function leitorQueDevolve(resultado: StatementParseResult) {
  const vistos: StatementFile[] = []
  return {
    vistos,
    parser: {
      parse: (arquivo: StatementFile) => {
        vistos.push(arquivo)
        return resultado
      },
    },
  }
}

function escritorEmMemoria() {
  const gravadas: NewBankTransaction[] = []
  return {
    gravadas,
    writer: {
      insertIgnoringDuplicates: async (t: readonly NewBankTransaction[]) => {
        /* Imita o indice unico: o que ja existe nao entra e nao conta. */
        const novas = t.filter((n) => !gravadas.some((g) => g.externalId === n.externalId))
        gravadas.push(...novas)
        return novas.length
      },
    },
  }
}

const LIDO_OK: StatementParseResult = {
  outcome: 'parsed',
  format: 'ofx',
  account: '0001/12345-6',
  transactions: [
    {
      externalId: 'FITID-1',
      direction: 'debit',
      amountCents: 5_000,
      postedOn: '2026-09-10',
      description: 'PAGAMENTO ENERGIA',
      counterparty: null,
    },
  ],
}

async function buildApp(principal: AuthenticatedPrincipal | null = PRINCIPAL) {
  /* A MESMA trilha por dentro da transacao — NR-087. */
  const audit = new InMemoryAuditTrail()
  const repo = new InMemoryReconciliation(audit)
  const leitor = leitorQueDevolve(LIDO_OK)
  const escritor = escritorEmMemoria()

  const deps: ConciliacaoDeps = {
    uow: repo,
    queries: repo,
    listQueries: repo,
    import: {
      parser: leitor.parser,
      transactions: escritor.writer,
      audit,
      ids: { next: () => randomUUID() },
    },
  }

  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  await registerRateLimit(app)
  app.addHook('onRequest', async (request) => {
    if (principal !== null) request.principal = principal
  })
  registerConciliacaoRoutes(app, deps)

  return { app, repo, audit, leitor, escritor }
}

let app: FastifyInstance

afterEach(async () => {
  await app?.close()
})

const base64 = (texto: string) => Buffer.from(texto, 'utf8').toString('base64')

describe('importar extrato — RF-076, RF-077', () => {
  it('importa e responde 200, nao 201', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/extratos',
      payload: { filename: 'extrato.ofx', contentBase64: base64('<OFX>...</OFX>') },
    })

    /* 200 e nao 201: reimportar e caso normal e nao cria nada. */
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ imported: 1, ignored: 0, format: 'ofx' })
  })

  it('na segunda vez diz que ja existiam, em vez de dizer que nada serviu', async () => {
    const c = await buildApp()
    app = c.app
    const envio = { filename: 'extrato.ofx', contentBase64: base64('<OFX>...</OFX>') }

    await app.inject({ method: 'POST', url: '/extratos', payload: envio })
    const r = await app.inject({ method: 'POST', url: '/extratos', payload: envio })

    /* "0 importadas" sozinho faria o lojista concluir que o arquivo nao serviu. */
    expect(r.json()).toMatchObject({ imported: 0, ignored: 1 })
  })

  it('entrega BYTES ao leitor, e nao texto ja decodificado', async () => {
    const c = await buildApp()
    app = c.app

    /* 0xC7 e "Ç" em latin-1 e byte invalido em UTF-8. Se a rota decodificasse
       como texto, ele chegaria corrompido e o nome do fornecedor entraria
       errado — sem erro nenhum. */
    const bytes = Buffer.from([0x4d, 0x41, 0x4e, 0x55, 0x54, 0xc7, 0x41, 0x4f])

    await app.inject({
      method: 'POST',
      url: '/extratos',
      payload: { filename: 'extrato.ofx', contentBase64: bytes.toString('base64') },
    })

    expect([...c.leitor.vistos[0]!.content]).toEqual([...bytes])
  })

  it('recusa base64 corrompido antes de culpar o extrato', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/extratos',
      payload: { filename: 'extrato.ofx', contentBase64: 'nao é base64!!' },
    })

    /* Sem esta checagem o `Buffer.from` descartaria o que nao reconhece e
       devolveria bytes truncados: viraria "formato desconhecido" e mandaria o
       lojista procurar problema no arquivo certo. */
    expect(r.statusCode).toBe(400)
    expect(c.leitor.vistos).toHaveLength(0)
  })

  it('traduz arquivo recusado para 400 com a linha', async () => {
    const repo = new InMemoryReconciliation(new InMemoryAuditTrail())
    const escritor = escritorEmMemoria()
    const leitor = leitorQueDevolve({
      outcome: 'rejected',
      code: 'TRANSACAO_INVALIDA',
      message: 'Nao consegui ler a transacao da linha 42.',
      line: 42,
    })

    const app2 = Fastify({ logger: false })
    registerErrorHandler(app2)
    await registerRateLimit(app2)
    app2.addHook('onRequest', async (request) => {
      request.principal = PRINCIPAL
    })
    registerConciliacaoRoutes(app2, {
      uow: repo,
      queries: repo,
      listQueries: repo,
      import: {
        parser: leitor.parser,
        transactions: escritor.writer,
        audit: new InMemoryAuditTrail(),
        ids: { next: () => randomUUID() },
      },
    })
    app = app2

    const r = await app.inject({
      method: 'POST',
      url: '/extratos',
      payload: { filename: 'extrato.ofx', contentBase64: base64('lixo') },
    })

    expect(r.statusCode).toBe(400)
    expect(r.json().error.fields).toEqual([
      { path: 'arquivo.linha.42', message: 'TRANSACAO_INVALIDA' },
    ])
    /* RF-077: nada entrou. */
    expect(escritor.gravadas).toHaveLength(0)
  })
})

describe('a fila — NR-076', () => {
  it('lista as pendentes, da mais antiga para a mais nova', async () => {
    const c = await buildApp()
    app = c.app

    c.repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 3_000,
      postedOn: '2026-09-10',
    })
    c.repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 1_000,
      postedOn: '2026-09-02',
    })

    const r = await app.inject({ method: 'GET', url: '/conciliacao/transacoes' })

    expect(r.statusCode).toBe(200)
    expect(r.json().transactions.map((t: { postedOn: string }) => t.postedOn)).toEqual([
      '2026-09-02',
      '2026-09-10',
    ])
  })

  it('sem `scope` na query devolve a fila, e nao a lista toda', async () => {
    const c = await buildApp()
    app = c.app

    const transacao = c.repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 5_000,
      postedOn: '2026-09-10',
    })
    const conta = c.repo.adicionarLancamento(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'Enel',
      amountCents: 5_000,
      dueDate: '2026-09-10',
    })
    await app.inject({
      method: 'POST',
      url: `/conciliacao/transacoes/${transacao.id}/conciliar`,
      payload: { entryKind: 'payable', entryId: conta.id },
    })

    const r = await app.inject({ method: 'GET', url: '/conciliacao/transacoes' })

    expect(r.json().transactions).toEqual([])
    expect(r.json().pendingCount).toBe(0)
  })

  it('recusa recorte que nao existe, em vez de devolver a fila em silencio', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'GET', url: '/conciliacao/transacoes?scope=todas' })

    expect(r.statusCode).toBe(400)
  })
})

describe('sugerir — RF-078', () => {
  it('devolve os candidatos que casam', async () => {
    const c = await buildApp()
    app = c.app

    const transacao = c.repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 5_000,
      postedOn: '2026-09-10',
    })
    c.repo.adicionarLancamento(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'Enel',
      amountCents: 5_000,
      dueDate: '2026-09-09',
    })

    const r = await app.inject({
      method: 'GET',
      url: `/conciliacao/transacoes/${transacao.id}/sugestoes`,
    })

    expect(r.statusCode).toBe(200)
    expect(r.json().suggestions).toHaveLength(1)
  })

  it('lista vazia e resposta, nao 404', async () => {
    const c = await buildApp()
    app = c.app

    const transacao = c.repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 5_000,
      postedOn: '2026-09-10',
    })

    const r = await app.inject({
      method: 'GET',
      url: `/conciliacao/transacoes/${transacao.id}/sugestoes`,
    })

    /* "Nada casa" e o que manda o lojista para o caminho de criar o lancamento
       (RF-079). Um 404 diria que a transacao nao existe, que e outra coisa. */
    expect(r.statusCode).toBe(200)
    expect(r.json().suggestions).toEqual([])
  })
})

describe('criar lancamento a partir da transacao — RF-079', () => {
  it('cria e concilia, com 201', async () => {
    const c = await buildApp()
    app = c.app

    const transacao = c.repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 5_000,
      postedOn: '2026-09-10',
    })

    const r = await app.inject({
      method: 'POST',
      url: `/conciliacao/transacoes/${transacao.id}/lancamento`,
      payload: { counterparty: 'Enel', description: 'Energia de agosto' },
    })

    expect(r.statusCode).toBe(201)
    expect(r.json().entryKind).toBe('payable')
    expect(c.repo.transacao(transacao.id)?.reconciledEntryId).toBe(r.json().entryId)
  })

  it('aceita accountId agora que o plano de contas tem tabela', async () => {
    const c = await buildApp()
    app = c.app

    const transacao = c.repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 5_000,
      postedOn: '2026-09-10',
    })

    const r = await app.inject({
      method: 'POST',
      url: `/conciliacao/transacoes/${transacao.id}/lancamento`,
      payload: {
        counterparty: 'Enel',
        description: 'Energia de agosto',
        accountId: '3d1f0c4e-6a2b-4c8d-9e1f-0a2b3c4d5e6f',
      },
    })

    /*
     * Ate a NR-077 esta rota RECUSAVA o campo, porque a tabela `accounts` nao
     * existia e aceitar era descartar em silencio — o lojista acreditaria ter
     * classificado e o erro so apareceria no relatorio do contador. A tabela
     * chegou; a recusa saiu.
     *
     * Que a conta realmente e GRAVADA e assunto do teste de `db`: o falso
     * daqui nao tem coluna, e afirma-lo com ele seria afirmar nada.
     */
    expect(r.statusCode).toBe(201)
  })
})

describe('desfazer — RF-080', () => {
  it('devolve os dois para a fila', async () => {
    const c = await buildApp()
    app = c.app

    const transacao = c.repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 5_000,
      postedOn: '2026-09-10',
    })
    const conta = c.repo.adicionarLancamento(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'Enel',
      amountCents: 5_000,
      dueDate: '2026-09-10',
    })
    await app.inject({
      method: 'POST',
      url: `/conciliacao/transacoes/${transacao.id}/conciliar`,
      payload: { entryKind: 'payable', entryId: conta.id },
    })

    const r = await app.inject({
      method: 'POST',
      url: `/conciliacao/transacoes/${transacao.id}/desfazer`,
      payload: { reason: 'Casei com a conta errada' },
    })

    expect(r.statusCode).toBe(200)
    expect(c.repo.transacao(transacao.id)?.reconciledEntryId).toBeNull()
    expect(c.repo.lancamento(conta.id)?.reconciled).toBe(false)
  })

  it('exige o motivo — sem ele a auditoria diria quem, e nunca por que', async () => {
    const c = await buildApp()
    app = c.app

    const transacao = c.repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 5_000,
      postedOn: '2026-09-10',
    })

    const r = await app.inject({
      method: 'POST',
      url: `/conciliacao/transacoes/${transacao.id}/desfazer`,
      payload: {},
    })

    expect(r.statusCode).toBe(400)
  })
})

describe('quem pode', () => {
  it('sem sessao, 401 em todas', async () => {
    const c = await buildApp(null)
    app = c.app

    expect((await app.inject({ method: 'GET', url: '/conciliacao/transacoes' })).statusCode).toBe(
      401,
    )
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/extratos',
          payload: { filename: 'e.ofx', contentBase64: base64('x') },
        })
      ).statusCode,
    ).toBe(401)
  })

  it('o contador le a fila mas nao concilia', async () => {
    const c = await buildApp({ ...PRINCIPAL, role: 'accountant' })
    app = c.app

    const transacao = c.repo.adicionarTransacao(EMPRESA, {
      direction: 'debit',
      amountCents: 5_000,
      postedOn: '2026-09-10',
    })
    const conta = c.repo.adicionarLancamento(EMPRESA, {
      entryKind: 'payable',
      counterparty: 'Enel',
      amountCents: 5_000,
      dueDate: '2026-09-10',
    })

    expect((await app.inject({ method: 'GET', url: '/conciliacao/transacoes' })).statusCode).toBe(
      200,
    )

    const escrita = await app.inject({
      method: 'POST',
      url: `/conciliacao/transacoes/${transacao.id}/conciliar`,
      payload: { entryKind: 'payable', entryId: conta.id },
    })

    expect(escrita.statusCode).toBe(403)
  })
})
