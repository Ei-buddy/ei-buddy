import type { QuoteOutput, QuoteSituation } from '@na-regua/contracts'
import type { FiltroDeOrcamentos, QuoteChanges, QuoteRepository } from '@na-regua/core'
import type { PendingQuery, Row, Sql, TransactionSql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Orcamentos no banco — NR-159.
 *
 * Toda consulta filtra `company_id` explicitamente alem da RLS: a CI roda como
 * superusuario, que ignora a politica.
 */

const numero = (v: unknown): number => Number(v)

/* Id que nao e uuid nao existe — e responder "nao encontrado" e melhor que
   deixar o Postgres recusar o texto com um 500. */
const ehUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

type LinhaOrcamento = {
  id: string
  number: number
  customer_id: string | null
  customer_name: string | null
  status: string
  valid_until: Date | string
  notes: string | null
  discount_cents: string | number
  total_cents: string | number
  sale_id: string | null
  created_at: Date
}

type LinhaItem = {
  quote_id: string
  product_id: string
  description: string
  quantity: number
  unit_price_cents: string | number
  internal_code: string
  cost_price_cents: string | number
  stock: number
  is_active: boolean
}

/* Coluna `date` chega como meia-noite UTC: os campos a ler sao os UTC. */
function paraDia(v: Date | string): string {
  if (typeof v === 'string') return v.slice(0, 10)
  const mes = String(v.getUTCMonth() + 1).padStart(2, '0')
  const dia = String(v.getUTCDate()).padStart(2, '0')
  return `${v.getUTCFullYear()}-${mes}-${dia}`
}

const paraSaida = (
  o: LinhaOrcamento,
  itens: readonly LinhaItem[],
  saleNumber: number | null,
): QuoteOutput => ({
  id: o.id,
  number: o.number,
  customerId: o.customer_id,
  customerName: o.customer_name,
  status: o.status as QuoteOutput['status'],
  validUntil: paraDia(o.valid_until),
  notes: o.notes,
  discountCents: numero(o.discount_cents),
  totalCents: numero(o.total_cents),
  saleId: o.sale_id,
  saleNumber,
  items: itens.map((i) => ({
    productId: i.product_id,
    description: i.description,
    quantity: i.quantity,
    unitPriceCents: numero(i.unit_price_cents),
    code: i.internal_code,
    costPriceCents: numero(i.cost_price_cents),
    stock: i.stock,
    isActive: i.is_active,
  })),
  createdAt: o.created_at.toISOString(),
})

async function comItens(
  tx: TransactionSql,
  companyId: string,
  orcamentos: readonly LinhaOrcamento[],
): Promise<QuoteOutput[]> {
  if (orcamentos.length === 0) return []
  const itens = await tx<LinhaItem[]>`
    SELECT qi.quote_id, qi.product_id, qi.description, qi.quantity, qi.unit_price_cents,
           p.internal_code, p.cost_price_cents, p.stock, p.is_active
      FROM quote_items qi
      JOIN products p ON p.id = qi.product_id AND p.company_id = qi.company_id
     WHERE qi.company_id = ${companyId}
       AND qi.quote_id = ANY(${orcamentos.map((o) => o.id)})
     ORDER BY qi.position
  `
  /* O numero da venda, para a tela dizer "Venda #N" — NR-172. */
  const vendaIds = orcamentos.map((o) => o.sale_id).filter((id): id is string => id !== null)
  const numeros =
    vendaIds.length === 0
      ? []
      : await tx<{ id: string; number: string | number }[]>`
          SELECT id, number FROM sales WHERE company_id = ${companyId} AND id = ANY(${vendaIds})
        `
  /* `sales.number` e bigint: chega como string, e vira numero aqui, na borda. */
  const numeroDa = new Map(numeros.map((v) => [v.id, numero(v.number)]))
  return orcamentos.map((o) =>
    paraSaida(
      o,
      itens.filter((i) => i.quote_id === o.id),
      o.sale_id === null ? null : (numeroDa.get(o.sale_id) ?? null),
    ),
  )
}

async function gravarItens(
  tx: TransactionSql,
  companyId: string,
  quoteId: string,
  itens: QuoteChanges['items'],
): Promise<void> {
  await tx`
    INSERT INTO quote_items ${tx(
      itens.map((i, n) => ({
        company_id: companyId,
        quote_id: quoteId,
        product_id: i.productId,
        position: n + 1,
        description: i.description,
        quantity: i.quantity,
        unit_price_cents: i.unitPriceCents,
      })),
    )}
  `
}

/* Linha da lista: o orcamento mais o total e o resumo, nas janelas. */
type LinhaDaLista = LinhaOrcamento & {
  total_geral: string | number
  aberto_qtd: string | number
  aberto_valor: string | number
  vencido_qtd: string | number
  vencido_valor: string | number
  convertido_qtd: string | number
  convertido_valor: string | number
  cancelado_qtd: string | number
  cancelado_valor: string | number
}

/**
 * Busca e periodo — o recorte do PAINEL. A situacao fica fora daqui: ela
 * recorta so a lista, e o painel continua mostrando todas.
 */
function recorte(tx: TransactionSql, f: FiltroDeOrcamentos, timeZone: string) {
  return tx`
    ${
      f.from === undefined
        ? tx``
        : tx`AND q.created_at >= (${f.from}::date)::timestamp AT TIME ZONE ${timeZone}`
    }
    ${
      f.to === undefined
        ? tx``
        : tx`AND q.created_at < (${f.to}::date + 1)::timestamp AT TIME ZONE ${timeZone}`
    }
    ${
      f.termo === undefined
        ? tx``
        : tx`AND (
              q.customer_name ILIKE ${'%' + f.termo + '%'}
              OR q.number::text = ${f.termo}
              OR EXISTS (
                SELECT 1 FROM quote_items qi2
                 WHERE qi2.company_id = q.company_id
                   AND qi2.quote_id = q.id
                   AND qi2.description ILIKE ${'%' + f.termo + '%'}
              )
            )`
    }
  `
}

/* As quatro situacoes. Vencido e o aberto com validade antes de hoje. */
const situacao: Record<QuoteSituation, (tx: TransactionSql, hoje: string) => PendingQuery<Row[]>> =
  {
    open: (tx, hoje) => tx`q.status = 'open' AND q.valid_until >= ${hoje}::date`,
    expired: (tx, hoje) => tx`q.status = 'open' AND q.valid_until < ${hoje}::date`,
    converted: (tx) => tx`q.status = 'converted'`,
    cancelled: (tx) => tx`q.status = 'cancelled'`,
  }

export function createQuoteRepository(sql: Sql, timeZone = 'America/Sao_Paulo'): QuoteRepository {
  return {
    findProducts: (companyId, ids) =>
      withTenant(sql, companyId, async (tx) => {
        ids = ids.filter(ehUuid)
        const linhas = await tx<{ id: string; description: string; is_active: boolean }[]>`
          SELECT id, description, is_active FROM products
           WHERE company_id = ${companyId} AND deleted_at IS NULL AND id = ANY(${[...ids]})
        `
        return linhas.map((l) => ({ id: l.id, description: l.description, isActive: l.is_active }))
      }),

    findCustomer: async (companyId, id) => {
      if (!ehUuid(id)) return null
      return withTenant(sql, companyId, async (tx) => {
        const [c] = await tx<{ id: string; name: string }[]>`
          SELECT id, name FROM customers
           WHERE company_id = ${companyId} AND id = ${id} AND deleted_at IS NULL
        `
        return c ?? null
      })
    },

    create: (q) =>
      withTenant(sql, q.companyId, async (tx) => {
        /* Trava a numeracao da loja: duas gravacoes ao mesmo tempo nao podem
           pegar o mesmo numero. O indice unico e a guarda final. */
        await tx`SELECT pg_advisory_xact_lock(hashtext(${`quotes:${q.companyId}`}))`
        const [seq] = await tx<{ proximo: number }[]>`
          SELECT COALESCE(MAX(number), 0) + 1 AS proximo FROM quotes WHERE company_id = ${q.companyId}
        `
        const [o] = await tx<LinhaOrcamento[]>`
          INSERT INTO quotes ${tx({
            company_id: q.companyId,
            number: seq!.proximo,
            customer_id: q.customerId,
            customer_name: q.customerName,
            valid_until: q.validUntil,
            notes: q.notes,
            discount_cents: q.discountCents,
            total_cents: q.totalCents,
            created_at: q.createdAt,
            created_by: q.createdBy,
          })}
          RETURNING *
        `
        await gravarItens(tx, q.companyId, o!.id, q.items)
        const [saida] = await comItens(tx, q.companyId, [o!])
        return saida!
      }),

    /* Itens trocados inteiros: a edicao e a proposta nova, na ordem nova. O
       `status = 'open'` no WHERE e a guarda contra quem fechou no meio. */
    update: async (companyId, id, q) => {
      if (!ehUuid(id)) return null
      return withTenant(sql, companyId, async (tx) => {
        const [o] = await tx<LinhaOrcamento[]>`
          UPDATE quotes
             SET customer_id = ${q.customerId},
                 customer_name = ${q.customerName},
                 valid_until = ${q.validUntil},
                 notes = ${q.notes},
                 discount_cents = ${q.discountCents},
                 total_cents = ${q.totalCents}
           WHERE company_id = ${companyId} AND id = ${id} AND status = 'open'
          RETURNING *
        `
        if (o === undefined) return null
        await tx`DELETE FROM quote_items WHERE company_id = ${companyId} AND quote_id = ${id}`
        await gravarItens(tx, companyId, id, q.items)
        const [saida] = await comItens(tx, companyId, [o])
        return saida ?? null
      })
    },

    /**
     * A pagina, o total e o resumo numa consulta so — NR-210.
     *
     * O resumo precisa enxergar o que a situacao escolhida esconde. Por isso
     * a situacao nao vai no `WHERE`: a CTE traz o recorte de busca e periodo,
     * as janelas (`OVER ()`) somam cada situacao sobre ele, e so depois a
     * situacao filtra as linhas da pagina. Com a situacao no `WHERE`, escolher
     * "Vencidos" zeraria o "Em aberto" do painel.
     *
     * Quando a pagina vem vazia (pagina alem do fim, ou situacao sem nenhum),
     * nao ha linha para carregar as janelas: o resumo sai de uma segunda
     * consulta, so de agregados.
     */
    list: (companyId, f) =>
      withTenant(sql, companyId, async (tx) => {
        const h = f.hoje
        const linhas = await tx<LinhaDaLista[]>`
          WITH recorte AS (
            SELECT q.*,
                   count(*) FILTER (WHERE ${situacao.open(tx, h)}) OVER () AS aberto_qtd,
                   COALESCE(SUM(q.total_cents) FILTER (WHERE ${situacao.open(tx, h)}) OVER (), 0)
                     AS aberto_valor,
                   count(*) FILTER (WHERE ${situacao.expired(tx, h)}) OVER () AS vencido_qtd,
                   COALESCE(SUM(q.total_cents) FILTER (WHERE ${situacao.expired(tx, h)}) OVER (), 0)
                     AS vencido_valor,
                   count(*) FILTER (WHERE ${situacao.converted(tx, h)}) OVER () AS convertido_qtd,
                   COALESCE(SUM(q.total_cents) FILTER (WHERE ${situacao.converted(tx, h)}) OVER (), 0)
                     AS convertido_valor,
                   count(*) FILTER (WHERE ${situacao.cancelled(tx, h)}) OVER () AS cancelado_qtd,
                   COALESCE(SUM(q.total_cents) FILTER (WHERE ${situacao.cancelled(tx, h)}) OVER (), 0)
                     AS cancelado_valor
              FROM quotes q
             WHERE q.company_id = ${companyId}
             ${recorte(tx, f, timeZone)}
          )
          SELECT q.*, count(*) OVER () AS total_geral
            FROM recorte q
           WHERE TRUE
           ${f.situacao === undefined ? tx`` : tx`AND ${situacao[f.situacao](tx, h)}`}
           ORDER BY q.number DESC
           LIMIT ${f.limite} OFFSET ${f.offset}
        `

        let base: LinhaDaLista | undefined = linhas[0]
        let total = numero(linhas[0]?.total_geral ?? 0)
        if (base === undefined) {
          const [agregado] = await tx<LinhaDaLista[]>`
            SELECT
              count(*) FILTER (WHERE ${situacao.open(tx, h)}) AS aberto_qtd,
              COALESCE(SUM(q.total_cents) FILTER (WHERE ${situacao.open(tx, h)}), 0) AS aberto_valor,
              count(*) FILTER (WHERE ${situacao.expired(tx, h)}) AS vencido_qtd,
              COALESCE(SUM(q.total_cents) FILTER (WHERE ${situacao.expired(tx, h)}), 0)
                AS vencido_valor,
              count(*) FILTER (WHERE ${situacao.converted(tx, h)}) AS convertido_qtd,
              COALESCE(SUM(q.total_cents) FILTER (WHERE ${situacao.converted(tx, h)}), 0)
                AS convertido_valor,
              count(*) FILTER (WHERE ${situacao.cancelled(tx, h)}) AS cancelado_qtd,
              COALESCE(SUM(q.total_cents) FILTER (WHERE ${situacao.cancelled(tx, h)}), 0)
                AS cancelado_valor,
              count(*) FILTER (WHERE ${
                f.situacao === undefined ? tx`TRUE` : situacao[f.situacao](tx, h)
              }) AS total_geral
              FROM quotes q
             WHERE q.company_id = ${companyId}
             ${recorte(tx, f, timeZone)}
          `
          base = agregado
          total = numero(agregado?.total_geral ?? 0)
        }

        const par = (qtd: unknown, valor: unknown) => ({
          count: numero(qtd ?? 0),
          totalCents: numero(valor ?? 0),
        })
        return {
          orcamentos: await comItens(tx, companyId, linhas),
          total,
          resumo: {
            open: par(base?.aberto_qtd, base?.aberto_valor),
            expired: par(base?.vencido_qtd, base?.vencido_valor),
            converted: par(base?.convertido_qtd, base?.convertido_valor),
            cancelled: par(base?.cancelado_qtd, base?.cancelado_valor),
          },
        }
      }),

    findById: async (companyId, id) => {
      if (!ehUuid(id)) return null
      return withTenant(sql, companyId, async (tx) => {
        const linhas = await tx<LinhaOrcamento[]>`
          SELECT * FROM quotes WHERE company_id = ${companyId} AND id = ${id}
        `
        const [saida] = await comItens(tx, companyId, linhas)
        return saida ?? null
      })
    },

    saleExists: async (companyId, saleId) => {
      if (!ehUuid(saleId)) return false
      return withTenant(sql, companyId, async (tx) => {
        const linhas = await tx`
          SELECT 1 FROM sales WHERE company_id = ${companyId} AND id = ${saleId}
        `
        return linhas.length > 0
      })
    },

    close: (companyId, id, d) =>
      withTenant(sql, companyId, async (tx) => {
        const linhas = await tx<LinhaOrcamento[]>`
          UPDATE quotes
             SET status = ${d.status}, sale_id = ${d.saleId}, closed_at = ${d.closedAt}
           WHERE company_id = ${companyId} AND id = ${id} AND status = 'open'
          RETURNING *
        `
        const [saida] = await comItens(tx, companyId, linhas)
        return saida ?? null
      }),
  }
}
