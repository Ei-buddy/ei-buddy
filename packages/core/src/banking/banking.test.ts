import type { ParsedBankTransaction, StatementParseResult } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ExecutionContext } from '../context.js'
import { FakeStatementParser, InMemoryBankTransactionWriter } from './fakes.js'
import { importStatement } from './import-statement.js'

const AGORA = new Date('2026-10-01T12:00:00.000Z')
const EMPRESA = 'empresa-1'

function contexto(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: EMPRESA,
    userId: 'usr-1',
    role: 'owner',
    channel: 'app',
    requestId: 'req-1',
    now: AGORA,
    ...over,
  }
}

function cenario() {
  const parser = new FakeStatementParser()
  const transactions = new InMemoryBankTransactionWriter()
  const audit = new InMemoryAuditTrail()
  /* Uuid fixo: a trilha grava `entity_id` como uuid, e "ofx:req-1" quebrava. */
  const ids = { next: () => '00000000-0000-4000-8000-000000000001' }
  return { deps: { parser, transactions, audit, ids }, parser, transactions, audit }
}

const arquivo = { content: new Uint8Array([1, 2, 3]), filename: 'extrato.ofx' }

const transacao = (over: Partial<ParsedBankTransaction> = {}): ParsedBankTransaction => ({
  externalId: 'FITID-1',
  direction: 'debit',
  amountCents: 48_000,
  postedOn: '2026-09-10',
  description: 'PAGTO ELETRON COPEL',
  counterparty: null,
  ...over,
})

const lido = (transactions: ParsedBankTransaction[]): StatementParseResult => ({
  outcome: 'parsed',
  format: 'ofx',
  transactions,
  account: '341/12345-6',
})

async function pegaErro(fn: () => Promise<unknown>) {
  try {
    await fn()
    return undefined
  } catch (e) {
    return e
  }
}

describe('importar extrato — RF-076', () => {
  it('grava as transacoes e diz quantas entraram', async () => {
    const { deps, parser } = cenario()
    parser.programar(lido([transacao(), transacao({ externalId: 'FITID-2' })]))

    const r = await importStatement(deps, contexto(), arquivo)

    expect(r).toMatchObject({ imported: 2, ignored: 0, format: 'ofx', account: '341/12345-6' })
  })

  it('marca quem importou e quando', async () => {
    const { deps, parser, transactions } = cenario()
    parser.programar(lido([transacao()]))

    await importStatement(deps, contexto(), arquivo)

    expect(transactions.daEmpresa(EMPRESA)[0]).toMatchObject({
      companyId: EMPRESA,
      importedBy: 'usr-1',
      importedAt: AGORA,
    })
  })

  /*
   * A forma normal de conferir se a importacao funcionou e importar outra vez.
   * Por isso duplicata e ignorada e contada, e nao recusada.
   */
  it('reimportar o mesmo extrato nao duplica nada', async () => {
    const { deps, parser, transactions } = cenario()
    parser.programar(lido([transacao(), transacao({ externalId: 'FITID-2' })]))
    await importStatement(deps, contexto(), arquivo)

    const r = await importStatement(deps, contexto(), arquivo)

    expect(r).toMatchObject({ imported: 0, ignored: 2 })
    expect(transactions.quantas()).toBe(2)
  })

  /*
   * "0 importadas" faria o lojista concluir que o arquivo nao serviu.
   * "0 importadas, 45 ja existiam" responde a pergunta que ele tinha.
   */
  it('separa o que entrou do que ja existia num extrato que se sobrepoe', async () => {
    const { deps, parser } = cenario()
    parser.programar(lido([transacao()]))
    await importStatement(deps, contexto(), arquivo)

    parser.programar(lido([transacao(), transacao({ externalId: 'FITID-2' })]))
    const r = await importStatement(deps, contexto(), arquivo)

    expect(r).toMatchObject({ imported: 1, ignored: 1 })
  })

  it('extrato de uma loja nao conta como duplicata na outra', async () => {
    const { deps, parser, transactions } = cenario()
    parser.programar(lido([transacao()]))
    await importStatement(deps, contexto(), arquivo)

    const r = await importStatement(deps, contexto({ companyId: 'empresa-2' }), arquivo)

    expect(r.imported).toBe(1)
    expect(transactions.daEmpresa('empresa-2')).toHaveLength(1)
  })

  it('audita o LOTE, e nao cada transacao', async () => {
    const { deps, parser, audit } = cenario()
    parser.programar(lido([transacao(), transacao({ externalId: 'FITID-2' })]))

    await importStatement(deps, contexto(), arquivo)

    const entradas = audit.daEmpresa(EMPRESA)
    expect(entradas).toHaveLength(1)
    expect(entradas[0]!.entity).toBe('BankStatement')
    expect(entradas[0]!.after).toMatchObject({ read: 2, imported: 2, ignored: 0 })
  })

  /* "ofx:req-1" ia para `audit_logs.entity_id`, que e uuid: as transacoes ja
     estavam gravadas e a tela recebia 500. */
  it('o lote entra na trilha com id uuid, e o formato vai no detalhe', async () => {
    const { deps, parser, audit } = cenario()
    parser.programar(lido([transacao()]))

    await importStatement(deps, contexto(), arquivo)

    const [entrada] = audit.daEmpresa(EMPRESA)
    expect(entrada!.entityId).toBe('00000000-0000-4000-8000-000000000001')
    expect(entrada!.after).toMatchObject({ format: 'ofx', requestId: 'req-1' })
  })

  it('recusa quem so pode ler', async () => {
    const { deps, parser } = cenario()
    parser.programar(lido([transacao()]))

    const erro = await pegaErro(() =>
      importStatement(deps, contexto({ role: 'accountant' }), arquivo),
    )

    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
  })

  /* Papel sem permissao nao deve nem custar a leitura do arquivo. */
  it('nem le o arquivo quando o papel nao permite', async () => {
    const { deps, parser } = cenario()
    parser.programar(lido([transacao()]))

    await pegaErro(() => importStatement(deps, contexto({ role: 'accountant' }), arquivo))

    expect(parser.chamadas).toBe(0)
  })
})

describe('arquivo recusado — RF-077', () => {
  /*
   * O ponto da RF-077: a leitura acontece por completo ANTES de qualquer
   * escrita, entao arquivo recusado nao deixa transacao nenhuma dentro do
   * sistema. Importacao parcial e pior que nenhuma — a conciliacao passaria a
   * nao fechar por um motivo invisivel.
   */
  it('nao grava nada quando o arquivo e recusado', async () => {
    const { deps, parser, transactions } = cenario()
    parser.programar({
      outcome: 'rejected',
      code: 'TRANSACAO_INVALIDA',
      message: 'A transacao 40 esta incompleta. Nada foi importado.',
      line: 412,
    })

    await pegaErro(() => importStatement(deps, contexto(), arquivo))

    expect(transactions.quantas()).toBe(0)
  })

  it('a recusa vira erro de validacao com a mensagem do leitor', async () => {
    const { deps, parser } = cenario()
    parser.programar({
      outcome: 'rejected',
      code: 'FORMATO_DESCONHECIDO',
      message: 'Este arquivo e um PDF, e PDF nao da para importar.',
      line: null,
    })

    const erro = await pegaErro(() => importStatement(deps, contexto(), arquivo))

    expect(isAppError(erro) && erro.code).toBe('VALIDATION_FAILED')
    expect(isAppError(erro) && erro.message).toContain('PDF')
  })

  /*
   * O codigo vai em `fields` para a tela agir sem interpretar a mensagem:
   * FORMATO_DESCONHECIDO pede outro arquivo, TRANSACAO_INVALIDA aponta a
   * linha. Mensagem muda com a redacao; codigo nao.
   */
  it('leva o codigo e a linha para a tela poder agir', async () => {
    const { deps, parser } = cenario()
    parser.programar({
      outcome: 'rejected',
      code: 'TRANSACAO_INVALIDA',
      message: 'A data da linha 42 nao foi reconhecida.',
      line: 42,
    })

    const erro = await pegaErro(() => importStatement(deps, contexto(), arquivo))

    expect(isAppError(erro) && erro.fields).toEqual([
      { path: 'arquivo.linha.42', message: 'TRANSACAO_INVALIDA' },
    ])
  })

  it('recusa sem linha aponta o arquivo inteiro', async () => {
    const { deps, parser } = cenario()
    parser.programar({
      outcome: 'rejected',
      code: 'SEM_TRANSACOES',
      message: 'Este extrato nao tem nenhuma transacao no periodo.',
      line: null,
    })

    const erro = await pegaErro(() => importStatement(deps, contexto(), arquivo))

    expect(isAppError(erro) && erro.fields[0]!.path).toBe('arquivo')
  })

  it('nao audita importacao que nao aconteceu', async () => {
    const { deps, parser, audit } = cenario()
    parser.programar({
      outcome: 'rejected',
      code: 'ESTRUTURA_INVALIDA',
      message: 'Arquivo incompleto.',
      line: null,
    })

    await pegaErro(() => importStatement(deps, contexto(), arquivo))

    expect(audit.daEmpresa(EMPRESA)).toHaveLength(0)
  })

  it('falha de gravacao nao audita importacao', async () => {
    const { deps, parser, transactions, audit } = cenario()
    parser.programar(lido([transacao()]))
    transactions.falhar = true

    await pegaErro(() => importStatement(deps, contexto(), arquivo))

    expect(audit.daEmpresa(EMPRESA)).toHaveLength(0)
  })
})
