import { gravarTrilha } from './audit-repository.js'
import type {
  BankTransactionListItem,
  BankTransactionOutput,
  BankTransactionScope,
  EntryKind,
} from '@na-regua/contracts'
import type {
  BankTransactionWriter,
  LancamentoConciliavel,
  NewBankTransaction,
  NovoLancamentoDeTransacao,
  ReconciliationQueries,
  ReconciliationTransaction,
  ReconciliationUnitOfWork,
} from '@na-regua/core'
import type { Sql, TransactionSql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Extrato bancario e conciliacao — NR-047 e NR-076, RF-076 a RF-080.
 *
 * `bigint` volta como STRING no postgres.js para nao perder precisao acima de
 * 2^53, e `date` volta como `Date` a meia-noite LOCAL. As duas conversoes
 * acontecem na BORDA, como nos outros repositorios.
 */
const numero = (valor: unknown): number => Number(valor)

/**
 * O `Date` de uma coluna `date` vira `AAAA-MM-DD`.
 *
 * O postgres.js devolve a coluna como meia-noite **UTC** — `2026-12-01` chega
 * como `2026-12-01T00:00:00.000Z`. Entao os campos a ler sao os UTC.
 *
 * As tres copias desta funcao liam os campos LOCAIS, com um comentario meu
 * afirmando o contrario ("vem a meia-noite local, e converter para UTC pode
 * recuar um dia"). Era o inverso: em fuso negativo, a meia-noite UTC ainda e o
 * dia ANTERIOR no relogio local, e ler campo local e que recuava. Em
 * America/Sao_Paulo, todo vencimento aparecia um dia antes.
 *
 * A CI nunca pegaria: o runner roda em UTC, onde os dois caminhos dao o mesmo
 * resultado. Apareceu ao subir um Postgres na maquina de desenvolvimento.
 */
function paraDia(v: Date | string): string {
  if (typeof v === 'string') return v.slice(0, 10)
  /* Campos UTC. Ver o comentario acima. */
  const mes = String(v.getUTCMonth() + 1).padStart(2, '0')
  const dia = String(v.getUTCDate()).padStart(2, '0')
  return `${v.getUTCFullYear()}-${mes}-${dia}`
}

type LinhaTransacao = {
  id: string
  external_id: string
  direction: string
  amount_cents: string | number
  posted_on: Date | string
  description: string
  counterparty: string | null
  reconciled_payable_id: string | null
  reconciled_receivable_id: string | null
}

/**
 * O `entryKind` do contrato sai de QUAL das duas colunas esta preenchida.
 *
 * E o preco de ter chave estrangeira de verdade em vez de um par polimorfico
 * (ver a migration 0011): o banco garante que a referencia existe, e a borda
 * remonta o par que o contrato usa.
 */
function paraSaida(l: LinhaTransacao): BankTransactionOutput {
  const kind: EntryKind | null =
    l.reconciled_payable_id !== null
      ? 'payable'
      : l.reconciled_receivable_id !== null
        ? 'receivable'
        : null

  return {
    id: l.id,
    externalId: l.external_id,
    direction: l.direction as BankTransactionOutput['direction'],
    amountCents: numero(l.amount_cents),
    postedOn: paraDia(l.posted_on),
    description: l.description,
    counterparty: l.counterparty,
    reconciledEntryKind: kind,
    reconciledEntryId: l.reconciled_payable_id ?? l.reconciled_receivable_id,
  }
}

type LinhaCandidato = {
  entry_kind: string
  id: string
  counterparty: string
  description: string
  amount_cents: string | number
  net_amount_cents: string | number | null
  due_date: Date | string
  reconciled: boolean
  status: string
}

const paraCandidato = (l: LinhaCandidato): LancamentoConciliavel => ({
  entryKind: l.entry_kind as EntryKind,
  id: l.id,
  counterparty: l.counterparty,
  description: l.description,
  amountCents: numero(l.amount_cents),
  netAmountCents: l.net_amount_cents === null ? null : numero(l.net_amount_cents),
  dueDate: paraDia(l.due_date),
  reconciled: l.reconciled,
  status: l.status,
})

/**
 * Importacao do extrato — RF-076.
 *
 * Fora da unidade de trabalho da conciliacao de proposito: importar nao concilia
 * nada, e emendar as duas daria a uma transacao aberta o tempo de ler um arquivo
 * inteiro.
 */
export function createBankTransactionWriter(sql: Sql): BankTransactionWriter {
  return {
    insertIgnoringDuplicates: async (transacoes: readonly NewBankTransaction[]) => {
      if (transacoes.length === 0) return 0

      const companyId = transacoes[0]!.companyId

      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<{ id: string }[]>`
          INSERT INTO bank_transactions ${tx(
            transacoes.map((t) => ({
              company_id: t.companyId,
              external_id: t.externalId,
              direction: t.direction,
              amount_cents: t.amountCents,
              posted_on: t.postedOn,
              description: t.description,
              counterparty: t.counterparty,
              imported_by: t.importedBy,
              imported_at: t.importedAt,
            })),
          )}
          /* A deduplicacao e daqui, e nao de um SELECT antes: duas importacoes
             simultaneas do mesmo arquivo passariam as duas pela leitura. */
          ON CONFLICT (company_id, external_id) DO NOTHING
          RETURNING id
        `,
      )

      /* Quantas ENTRARAM, e nao quantas foram enviadas: quem chamou precisa
         dizer ao lojista "45 importadas" ou "0 importadas, 45 ja existiam", e
         as duas frases contam historias opostas. */
      return linhas.length
    },
  }
}

/** Erro do Postgres para violacao de indice unico. */
const VIOLACAO_DE_UNICIDADE = '23505'

function escopo(tx: TransactionSql): ReconciliationTransaction {
  return {
    /*
     * A trilha entra NA transacao — NR-087.
     *
     * O INSERT mora em `gravarTrilha`, e nao aqui: duas copias dele
     * divergiriam no primeiro campo novo, e a errada seria a que ninguem le.
     * Fora da transacao, a entrada sobreviveria ao rollback e a trilha passaria
     * a registrar o que nao aconteceu — ver `TransactionalAuditTrail`.
     */
    record: (entrada) => gravarTrilha(tx, entrada),
    findTransaction: async (_empresa, transactionId) => {
      const [linha] = await tx<LinhaTransacao[]>`
        SELECT * FROM bank_transactions WHERE id = ${transactionId}
      `
      return linha === undefined ? undefined : paraSaida(linha)
    },

    findEntry: async (_empresa, entryKind, entryId) => {
      const [linha] =
        entryKind === 'payable'
          ? await tx<LinhaCandidato[]>`
              SELECT 'payable'::text AS entry_kind, p.id, p.supplier AS counterparty,
                     p.description, p.amount_cents,
                     NULL::bigint AS net_amount_cents,
                     p.due_date, p.status,
                     EXISTS (
                       SELECT 1 FROM bank_transactions b WHERE b.reconciled_payable_id = p.id
                     ) AS reconciled
              FROM payables p
              WHERE p.id = ${entryId}
            `
          : await tx<LinhaCandidato[]>`
              SELECT 'receivable'::text AS entry_kind, r.id,
                     COALESCE(r.counterparty, c.name, 'Recebimento') AS counterparty,
                     r.description, r.amount_cents, r.net_amount_cents,
                     r.due_date, r.status,
                     EXISTS (
                       SELECT 1 FROM bank_transactions b WHERE b.reconciled_receivable_id = r.id
                     ) AS reconciled
              FROM receivables r
              LEFT JOIN customers c ON c.id = r.customer_id
              WHERE r.id = ${entryId}
            `

      return linha === undefined ? undefined : paraCandidato(linha)
    },

    /**
     * A escrita CONDICIONAL que decide o empate de duas abas.
     *
     * O `WHERE reconciled_at IS NULL` e o que a porta chama de "a checagem
     * final e do banco": as duas abas passam pela leitura em `core`, e so uma
     * atualiza a linha.
     *
     * O outro empate — duas transacoes disputando o MESMO lancamento — nao cabe
     * naquele `WHERE`, porque ele olha a transacao e o conflito esta do outro
     * lado. Por isso o `NOT EXISTS`: ele resolve o caso comum na PROPRIA
     * escrita, devolvendo zero linhas em vez de esbarrar no indice.
     *
     * A primeira versao confiava so no indice e num `catch` do 23505. A CI
     * mostrou por que nao funciona: em Postgres, statement que falha aborta a
     * transacao inteira, entao o `catch` devolvia `false`, o postgres.js
     * mandava COMMIT numa transacao ja abortada e relancava o erro original. O
     * `catch` nunca teve chance — ele parecia certo e nao era.
     *
     * O indice continua, e continua sendo quem decide a corrida de verdade:
     * duas transacoes simultaneas passam as duas pelo `NOT EXISTS` (nenhuma ve
     * a linha nao confirmada da outra) e a segunda esbarra nele. Por isso a
     * escrita mora num SAVEPOINT — assim a violacao desfaz so ela mesma, a
     * transacao de fora sobrevive, e o `false` chega a quem chamou como
     * "alguem chegou antes, recarregue" em vez de virar erro de servidor.
     */
    link: async (_empresa, transactionId, entryKind, entryId, at) => {
      /* `coluna = NULL` nunca e verdadeiro, entao o lado que nao se aplica se
         anula sozinho no `NOT EXISTS` — sem precisar de dois ramos de SQL. */
      const contaAPagar = entryKind === 'payable' ? entryId : null
      const recebivel = entryKind === 'receivable' ? entryId : null

      try {
        const linhas = await tx.savepoint(
          (sp) => sp<{ id: string }[]>`
            UPDATE bank_transactions
            SET reconciled_payable_id = ${contaAPagar},
                reconciled_receivable_id = ${recebivel},
                reconciled_at = ${at}
            WHERE id = ${transactionId}
              AND reconciled_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM bank_transactions b2
                WHERE b2.reconciled_payable_id = ${contaAPagar}
                   OR b2.reconciled_receivable_id = ${recebivel}
              )
            RETURNING id
          `,
        )

        return linhas.length === 1
      } catch (erro) {
        if ((erro as { code?: string }).code === VIOLACAO_DE_UNICIDADE) return false
        throw erro
      }
    },

    unlink: async (_empresa, transactionId) => {
      await tx`
        UPDATE bank_transactions
        SET reconciled_payable_id = NULL,
            reconciled_receivable_id = NULL,
            reconciled_at = NULL
        WHERE id = ${transactionId}
      `
    },

    insertEntry: async (l: NovoLancamentoDeTransacao) => {
      const [linha] =
        l.entryKind === 'payable'
          ? await tx<{ id: string }[]>`
              INSERT INTO payables
                (company_id, supplier, description, amount_cents, due_date,
                 account_id, created_by, created_at, updated_at)
              VALUES (${l.companyId}, ${l.counterparty}, ${l.description},
                      ${l.amountCents}, ${l.dueDate}, ${l.accountId},
                      ${l.createdBy}, ${l.createdAt}, ${l.createdAt})
              RETURNING id
            `
          : await tx<{ id: string }[]>`
              INSERT INTO receivables
                (company_id, origin, counterparty, description, amount_cents,
                 net_amount_cents, due_date, account_id, created_by, created_at, updated_at)
              /* \`net_amount_cents\` igual ao bruto: o valor JA e o que caiu no
                 banco — veio do extrato. Nao ha tarifa a prever depois do fato. */
              VALUES (${l.companyId}, 'manual', ${l.counterparty}, ${l.description},
                      ${l.amountCents}, ${l.amountCents}, ${l.dueDate}, ${l.accountId},
                      ${l.createdBy}, ${l.createdAt}, ${l.createdAt})
              RETURNING id
            `

      return { id: linha!.id }
    },
  }
}

export function createReconciliationUnitOfWork(sql: Sql): ReconciliationUnitOfWork {
  return {
    transaction: (companyId, fn) => withTenant(sql, companyId, (tx) => fn(escopo(tx))),
  }
}

export function createReconciliationQueries(sql: Sql): ReconciliationQueries {
  return {
    /**
     * Candidatos na JANELA de data — o valor fica de fora de proposito.
     *
     * Comparar com o bruto ou com o liquido e REGRA (venda no cartao de R$ 100
     * cai como R$ 97,50), e regra em SQL e regra que nenhum teste de `core`
     * enxerga: um `COALESCE(net_amount_cents, amount_cents)` escondido aqui
     * funcionaria e mudaria de comportamento sem ninguem perceber.
     *
     * A janela vale para o vencimento OU para a baixa: conta paga antes (ou
     * depois) do vencimento sai do banco na data da BAIXA, e so pelo
     * vencimento ela nunca era sugerida — achado do QA.
     */
    findCandidates: async (companyId, entryKind, de, ate) => {
      const linhas = await withTenant(sql, companyId, (tx) =>
        entryKind === 'payable'
          ? tx<LinhaCandidato[]>`
              SELECT 'payable'::text AS entry_kind, p.id, p.supplier AS counterparty,
                     p.description, p.amount_cents,
                     NULL::bigint AS net_amount_cents,
                     p.due_date, p.status,
                     EXISTS (
                       SELECT 1 FROM bank_transactions b WHERE b.reconciled_payable_id = p.id
                     ) AS reconciled
              FROM payables p
              WHERE p.due_date BETWEEN ${de} AND ${ate}
                 OR EXISTS (
                      SELECT 1 FROM settlements s
                       WHERE s.payable_id = p.id
                         AND s.reverses_id IS NULL
                         AND s.settled_on BETWEEN ${de} AND ${ate}
                         AND NOT EXISTS (SELECT 1 FROM settlements e WHERE e.reverses_id = s.id)
                    )
              ORDER BY p.due_date
            `
          : tx<LinhaCandidato[]>`
              SELECT 'receivable'::text AS entry_kind, r.id,
                     COALESCE(r.counterparty, c.name, 'Recebimento') AS counterparty,
                     r.description, r.amount_cents, r.net_amount_cents,
                     r.due_date, r.status,
                     EXISTS (
                       SELECT 1 FROM bank_transactions b WHERE b.reconciled_receivable_id = r.id
                     ) AS reconciled
              FROM receivables r
              LEFT JOIN customers c ON c.id = r.customer_id
              WHERE r.due_date BETWEEN ${de} AND ${ate}
                 OR EXISTS (
                      SELECT 1 FROM settlements s
                       WHERE s.receivable_id = r.id
                         AND s.reverses_id IS NULL
                         AND s.settled_on BETWEEN ${de} AND ${ate}
                         AND NOT EXISTS (SELECT 1 FROM settlements e WHERE e.reverses_id = s.id)
                    )
              ORDER BY r.due_date
            `,
      )

      return linhas.map(paraCandidato)
    },

    listTransactions: async (companyId, scope: BankTransactionScope) => {
      type Linha = LinhaTransacao & {
        entry_counterparty: string | null
        entry_description: string | null
        entry_due_date: Date | string | null
      }

      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`
          SELECT b.*,
                 COALESCE(p.supplier, r.counterparty, c.name) AS entry_counterparty,
                 COALESCE(p.description, r.description)       AS entry_description,
                 COALESCE(p.due_date, r.due_date)             AS entry_due_date
          FROM bank_transactions b
          LEFT JOIN payables p    ON p.id = b.reconciled_payable_id
          LEFT JOIN receivables r ON r.id = b.reconciled_receivable_id
          LEFT JOIN customers c   ON c.id = r.customer_id
          WHERE ${
            scope === 'pending' ? tx`b.reconciled_at IS NULL` : tx`b.reconciled_at IS NOT NULL`
          }
          /* Da MAIS ANTIGA para a mais nova: a transacao velha sem conferir e a
             que ja passou do mes que o contador fechou. */
          ORDER BY b.posted_on, b.id
        `,
      )

      return linhas.map((l): BankTransactionListItem => {
        const base = paraSaida(l)

        return {
          ...base,
          reconciledWith:
            base.reconciledEntryKind === null || base.reconciledEntryId === null
              ? null
              : {
                  kind: base.reconciledEntryKind,
                  id: base.reconciledEntryId,
                  /* `COALESCE` acima pode nao achar nome de cliente: recebivel
                     de venda sem cliente identificado nao tem contraparte
                     nenhuma, e "Recebimento" e mais honesto que vazio. */
                  counterparty: l.entry_counterparty ?? 'Recebimento',
                  description: l.entry_description ?? '',
                  dueDate: l.entry_due_date === null ? base.postedOn : paraDia(l.entry_due_date),
                },
        }
      })
    },
  }
}
