import type { ImportStatementResult } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { IdGenerator } from '../ports/payable-repository.js'
import type { ExecutionContext } from '../context.js'
import type {
  BankTransactionWriter,
  StatementFile,
  StatementParser,
} from '../ports/statement-import.js'

export type ImportStatementDeps = {
  readonly parser: StatementParser
  readonly transactions: BankTransactionWriter
  readonly audit: AuditTrail
  /** Id do lote na trilha: `audit_logs.entity_id` e uuid. */
  readonly ids: IdGenerator
}

/**
 * Importa um extrato de arquivo — RF-076, RF-077.
 *
 * ## Ler tudo, depois gravar
 *
 * A ordem e a RF-077. O arquivo e lido por completo e so entao qualquer coisa
 * e gravada: um arquivo com problema na linha 40 nao deixa 39 transacoes
 * dentro do sistema. Importacao parcial e pior que nenhuma — a conciliacao
 * passaria a nao fechar por um motivo invisivel, e o lojista procuraria no
 * banco a transacao que falta, e ela estaria la.
 *
 * ## Reimportar e caso normal, nao erro
 *
 * A forma de conferir se a importacao funcionou e importar outra vez. Por isso
 * duplicata e IGNORADA e contada, nao recusada — e por isso a resposta separa
 * "entraram" de "ja existiam": "0 importadas" faria o lojista concluir que o
 * arquivo nao serviu; "0 importadas, 45 ja existiam" responde a pergunta que
 * ele tinha.
 */
export async function importStatement(
  deps: ImportStatementDeps,
  ctx: ExecutionContext,
  arquivo: StatementFile,
): Promise<ImportStatementResult> {
  assertCanWrite(ctx)

  const lido = deps.parser.parse(arquivo)

  if (lido.outcome === 'rejected') {
    /*
     * `VALIDATION_FAILED` e nao um erro proprio: para quem chama, arquivo
     * recusado e entrada que nao serve — mesmo tratamento de um corpo que nao
     * passa no schema. O `code` da recusa vai em `fields` para a tela poder
     * agir sem ler a mensagem: `FORMATO_DESCONHECIDO` pede outro arquivo,
     * `TRANSACAO_INVALIDA` aponta a linha.
     */
    throw AppError.validation(lido.message, [
      { path: lido.line === null ? 'arquivo' : `arquivo.linha.${lido.line}`, message: lido.code },
    ])
  }

  const importadas = await deps.transactions.insertIgnoringDuplicates(
    lido.transactions.map((t) => ({
      ...t,
      companyId: ctx.companyId,
      importedBy: ctx.userId,
      importedAt: ctx.now,
    })),
  )

  /*
   * Auditoria do LOTE, e nao de cada transacao.
   *
   * Um extrato mensal traz centenas de linhas; auditar uma a uma encheria a
   * trilha de ruido e a pergunta que se faz depois nao e "de onde veio esta
   * transacao", e "quem importou o extrato de setembro, e quando". Cada
   * transacao ja guarda `imported_by` e `imported_at`.
   *
   * `entity: 'BankStatement'` nao e tabela — e o lote. A trilha e por entidade
   * do glossario, e o lote e a entidade sobre a qual alguem pergunta.
   */
  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'BankStatement',
    entityId: deps.ids.next(),
    action: 'created',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: null,
    after: {
      requestId: ctx.requestId,
      format: lido.format,
      account: lido.account,
      read: lido.transactions.length,
      imported: importadas,
      ignored: lido.transactions.length - importadas,
    },
  })

  return {
    imported: importadas,
    ignored: lido.transactions.length - importadas,
    format: lido.format,
    account: lido.account,
  }
}
