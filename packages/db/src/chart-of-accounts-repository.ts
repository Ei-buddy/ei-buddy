import type { AccountOutput, AccountType, EntryKind } from '@na-regua/contracts'
import type {
  ChartOfAccountsRepository,
  ContaPadrao,
  LancamentoClassificado,
  NewAccount,
} from '@na-regua/core'
import type { Sql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Plano de contas, classificacao e os lancamentos do DRE — NR-032, NR-077.
 *
 * `bigint` volta como STRING no postgres.js e `date` como `Date` a meia-noite
 * LOCAL. As duas conversoes acontecem na BORDA, como nos outros repositorios.
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

type LinhaConta = {
  id: string
  name: string
  type: string
  is_default: boolean
}

const paraConta = (l: LinhaConta): AccountOutput => ({
  id: l.id,
  name: l.name,
  type: l.type as AccountType,
  isDefault: l.is_default,
})

type LinhaLancamento = {
  entry_kind: string
  entry_id: string
  account_id: string | null
  account_name: string | null
  account_type: string
  amount_cents: string | number
  occurred_on: Date | string
}

const paraLancamento = (l: LinhaLancamento): LancamentoClassificado => ({
  entryKind: l.entry_kind as EntryKind | 'sale',
  entryId: l.entry_id,
  accountId: l.account_id,
  /* Nome vazio quando nao ha conta: quem escolhe o rotulo de "sem
     classificacao" e `core`, que o mostra igual no web, no assistente e na
     exportacao. Inventar o texto aqui daria tres redacoes para a mesma linha. */
  accountName: l.account_name ?? '',
  accountType: l.account_type as AccountType,
  amountCents: numero(l.amount_cents),
  occurredOn: paraDia(l.occurred_on),
})

export function createChartOfAccountsRepository(
  sql: Sql,
  /** Fuso da loja: a venda das 23h de dia 31 e do mes que acaba. */
  timeZone = 'America/Sao_Paulo',
): ChartOfAccountsRepository & {
  /** Semeia o plano padrao no fim do onboarding — RF-081. */
  insertDefaults(
    companyId: string,
    contas: readonly ContaPadrao[],
    createdBy: string,
    createdAt: Date,
  ): Promise<number>
} {
  return {
    list: async (companyId) => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaConta[]>`
          SELECT id, name, type, is_default FROM ledger_accounts
          /* A ordem da TELA, e nao a alfabetica pura: o plano se le de cima
             para baixo como o DRE — receita, deducao, custo, despesa. */
          ORDER BY CASE type
                     WHEN 'revenue'   THEN 1
                     WHEN 'deduction' THEN 2
                     WHEN 'cost'      THEN 3
                     ELSE 4
                   END,
                   name
        `,
      )
      return linhas.map(paraConta)
    },

    findById: async (companyId, accountId) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaConta[]>`
          SELECT id, name, type, is_default FROM ledger_accounts WHERE id = ${accountId}
        `,
      )
      return linha === undefined ? undefined : paraConta(linha)
    },

    /**
     * `lower(name)`, e nao `name`: e o mesmo criterio do indice unico.
     *
     * Comparar exato aqui deixaria o caso de uso aceitar "aluguel" ao lado de
     * "Aluguel" — e a recusa viria do banco, como erro de servidor, em vez da
     * mensagem que explica o que houve.
     */
    findByName: async (companyId, name) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaConta[]>`
          SELECT id, name, type, is_default FROM ledger_accounts WHERE lower(name) = lower(${name})
        `,
      )
      return linha === undefined ? undefined : paraConta(linha)
    },

    insert: async (conta: NewAccount) => {
      const [linha] = await withTenant(
        sql,
        conta.companyId,
        (tx) => tx<LinhaConta[]>`
          INSERT INTO ledger_accounts (company_id, name, type, is_default, created_by, created_at)
          VALUES (${conta.companyId}, ${conta.name}, ${conta.type},
                  ${conta.isDefault}, ${conta.createdBy}, ${conta.createdAt})
          RETURNING id, name, type, is_default
        `,
      )
      return paraConta(linha!)
    },

    rename: async (companyId, accountId, name) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaConta[]>`
          UPDATE ledger_accounts SET name = ${name} WHERE id = ${accountId}
          RETURNING id, name, type, is_default
        `,
      )
      return paraConta(linha!)
    },

    remove: async (companyId, accountId) => {
      await withTenant(
        sql,
        companyId,
        (tx) => tx`DELETE FROM ledger_accounts WHERE id = ${accountId}`,
      )
    },

    /**
     * Quantos lancamentos usam a conta — RF-082.
     *
     * Os dois lados somados numa consulta so. Duas idas ao banco devolveriam
     * dois numeros que o caso de uso teria de somar, e a soma e a resposta.
     */
    countEntries: async (companyId, accountId) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<{ total: string }[]>`
          SELECT (
            (SELECT count(*) FROM payables    WHERE account_id = ${accountId}) +
            (SELECT count(*) FROM receivables WHERE account_id = ${accountId})
          ) AS total
        `,
      )
      return numero(linha!.total)
    },

    classify: async (companyId, entryKind, entryId, accountId) => {
      await withTenant(sql, companyId, (tx) =>
        entryKind === 'payable'
          ? tx`UPDATE payables SET account_id = ${accountId}, updated_at = now() WHERE id = ${entryId}`
          : tx`UPDATE receivables SET account_id = ${accountId}, updated_at = now() WHERE id = ${entryId}`,
      )
    },

    /**
     * O historico da contraparte — RF-084.
     *
     * A ordenacao por contagem mora aqui de proposito: ela e sobre o historico
     * INTEIRO, e trazer tudo para contar na aplicacao seria carregar anos de
     * lancamento para escolher uma linha.
     *
     * `count` volta como bigint — string no postgres.js. Sem a conversao, a
     * ordenacao em `core` compararia strings e "9" viria depois de "10".
     */
    historyFor: async (companyId, entryKind, counterparty) => {
      const linhas = await withTenant(sql, companyId, (tx) =>
        entryKind === 'payable'
          ? tx<{ account_id: string; account_name: string; times: string }[]>`
              SELECT p.account_id, a.name AS account_name, count(*) AS times
              FROM payables p
              JOIN ledger_accounts a ON a.id = p.account_id
              WHERE lower(p.supplier) = lower(${counterparty})
                AND p.account_id IS NOT NULL
              GROUP BY p.account_id, a.name
              ORDER BY count(*) DESC, a.name
            `
          : tx<{ account_id: string; account_name: string; times: string }[]>`
              SELECT r.account_id, a.name AS account_name, count(*) AS times
              FROM receivables r
              JOIN ledger_accounts a ON a.id = r.account_id
              LEFT JOIN customers c ON c.id = r.customer_id
              WHERE lower(COALESCE(r.counterparty, c.name, '')) = lower(${counterparty})
                AND r.account_id IS NOT NULL
              GROUP BY r.account_id, a.name
              ORDER BY count(*) DESC, a.name
            `,
      )

      return linhas.map((l) => ({
        accountId: l.account_id,
        accountName: l.account_name,
        times: numero(l.times),
      }))
    },

    /**
     * Os lancamentos do periodo — RF-085, RF-086.
     *
     * Por COMPETENCIA (`due_date`), e nao por caixa. O DRE responde "o mes
     * fechou no azul", e o mes em que a conta de luz venceu e o mes ao qual ela
     * pertence, ainda que o pagamento tenha saido no dia 5 do seguinte. Trocar
     * para a data da baixa mudaria o resultado de todo mes.
     *
     * Cancelado fica de fora: conta cancelada nao e despesa, e some-la faria o
     * resultado piorar por causa de algo que nao aconteceu.
     *
     * O TIPO de quem nao tem conta sai da natureza do lancamento — conta a
     * pagar e despesa, recebivel e receita. Sem isso, `accountType` precisaria
     * ser nulo e o DRE nao saberia de que lado somar o que ninguem classificou;
     * some-lo mudaria o total, e as linhas do relatorio deixariam de fechar com
     * o resultado.
     */
    entriesBetween: async (companyId, from, to) => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaLancamento[]>`
          SELECT 'payable'::text AS entry_kind,
                 p.id AS entry_id,
                 p.account_id,
                 a.name AS account_name,
                 COALESCE(a.type, 'expense') AS account_type,
                 p.amount_cents,
                 p.due_date AS occurred_on
          FROM payables p
          LEFT JOIN ledger_accounts a ON a.id = p.account_id
          WHERE p.due_date BETWEEN ${from} AND ${to}
            AND p.status <> 'cancelled'

          UNION ALL

          SELECT 'receivable'::text AS entry_kind,
                 r.id AS entry_id,
                 r.account_id,
                 a.name AS account_name,
                 COALESCE(a.type, 'revenue') AS account_type,
                 r.amount_cents,
                 r.due_date AS occurred_on
          FROM receivables r
          LEFT JOIN ledger_accounts a ON a.id = r.account_id
          WHERE r.due_date BETWEEN ${from} AND ${to}
            AND r.status <> 'cancelled'
            /* O recebivel da VENDA nao e receita: a venda e. Somar os dois
               contaria a receita duas vezes; e a parcela do credito vencendo
               no mes seguinte jogava a receita no mes errado. */
            AND r.sale_id IS NULL

          UNION ALL

          /*
           * A venda, na data dela — competencia, como o relatorio de
           * faturamento. Cada venda abre em ate seis linhas (bruto, desconto,
           * devolucao, imposto, custo da mercadoria, tarifa de cartao). O
           * account_name e um CODIGO: o rotulo e de core, como o de
           * "sem classificacao".
           */
          SELECT 'sale'::text AS entry_kind,
                 s.id AS entry_id,
                 NULL::uuid AS account_id,
                 linha.codigo AS account_name,
                 linha.tipo AS account_type,
                 linha.valor AS amount_cents,
                 (s.created_at AT TIME ZONE ${timeZone})::date AS occurred_on
          FROM sales s
          CROSS JOIN LATERAL (
            SELECT COALESCE(SUM(i.returned_quantity * i.cost_price_cents), 0) AS custo_devolvido
            FROM sale_items i
            WHERE i.sale_id = s.id
          ) dev
          CROSS JOIN LATERAL (
            VALUES
              ('vendas', 'revenue', s.gross_amount_cents),
              ('descontos', 'deduction', s.discount_cents),
              ('devolucoes', 'deduction', s.returned_amount_cents),
              ('impostos', 'deduction',
                 ROUND(s.tax_amount_cents * (s.gross_amount_cents - s.returned_amount_cents)::numeric
                       / NULLIF(s.gross_amount_cents, 0))::bigint),
              ('cmv', 'cost', s.cost_amount_cents - dev.custo_devolvido),
              ('tarifas_cartao', 'expense', s.card_fee_amount_cents)
          ) AS linha(codigo, tipo, valor)
          WHERE s.status NOT IN ('cancelled', 'returned')
            AND s.created_at >= (${from}::date)::timestamp AT TIME ZONE ${timeZone}
            AND s.created_at <  (${to}::date + 1)::timestamp AT TIME ZONE ${timeZone}
            AND linha.valor > 0

          ORDER BY occurred_on, entry_id
        `,
      )

      return linhas.map(paraLancamento)
    },

    /**
     * O plano padrao no fim do onboarding — RF-081.
     *
     * `ON CONFLICT DO NOTHING` torna a semeadura repetivel. Ela roda fora da
     * transacao que cria a empresa (`companies.create` e um insert proprio), e
     * sem idempotencia uma segunda tentativa depois de falha parcial pararia no
     * meio com nome repetido — deixando o plano incompleto, que e pior que
     * vazio, porque parece pronto.
     */
    insertDefaults: async (companyId, contas, createdBy, createdAt) => {
      if (contas.length === 0) return 0

      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<{ id: string }[]>`
          INSERT INTO ledger_accounts ${tx(
            contas.map((c, i) => ({
              company_id: companyId,
              name: c.name,
              type: c.type,
              kind: c.type,
              code: `${c.type.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(2, '0')}`,
              is_default: true,
              created_by: createdBy,
              created_at: createdAt,
            })),
          )}
          ON CONFLICT (company_id, lower(name)) DO NOTHING
          RETURNING id
        `,
      )

      return linhas.length
    },
  }
}
