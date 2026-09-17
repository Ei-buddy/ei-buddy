import type { AuditEntryOutput } from '@na-regua/contracts'
import type { AuditQueries, AuditTrail, NewAuditEntry } from '@na-regua/core'
import type { JSONValue, Sql, TransactionSql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * A trilha de auditoria no banco — NR-087, RF-123, RF-124, US-061.
 *
 * ## O que faltava
 *
 * A tabela existe desde a 0007, com gatilhos que recusam UPDATE, DELETE e
 * TRUNCATE, e com teste provando que recusam. E nunca ninguem escreveu nela:
 * `packages/db` nao expunha repositorio, e OITO builders da composicao usavam
 * `InMemoryAuditTrail`.
 *
 * Consequencia: toda venda, baixa, estorno, ajuste de estoque, convite,
 * anonimizacao e exportacao era auditada num `Map` que morre com o processo.
 * "Quem baixou a base inteira, e quando" — a pergunta de depois de um
 * vazamento — nao tinha resposta.
 *
 * ## Duas entradas, um INSERT
 *
 * `gravarTrilha(tx, ...)` escreve na transacao que RECEBE. `createAuditTrail`
 * abre a propria. O INSERT e escrito uma vez: duas copias divergiriam no
 * primeiro campo novo, e a que ficasse errada seria a que ninguem le.
 *
 * ## Por que a versao transacional existe — e nao e refinamento
 *
 * Seis casos de uso chamam a trilha DENTRO da transacao de negocio (ajuste de
 * estoque, baixa, estorno, conta a pagar, encerramento de recorrencia,
 * conciliacao). Se a trilha abrisse conexao propria ali, duas coisas ruins
 * aconteceriam:
 *
 * 1. **Trava o banco.** O pool tem 10 conexoes. Dez transacoes simultaneas,
 *    cada uma pedindo uma segunda conexao para a trilha, esperam por uma
 *    decima primeira que nao existe. Nao e degradacao: e o banco parado.
 *
 * 2. **A trilha passa a mentir.** Gravada fora da transacao, ela sobrevive ao
 *    rollback do que ela registra. O estorno falha no commit e fica na trilha
 *    um estorno que nunca aconteceu — e trilha que registra o que nao houve
 *    nao resolve divergencia nenhuma, que e a US-061.
 *
 * Por isso os escopos de transacao (`SettlementTransaction`,
 * `InventoryTransaction` e os outros tres) passaram a incluir `record`. O caso
 * de uso chama `tx.record(...)` quando esta dentro, e `deps.audit.record(...)`
 * quando nao esta — e a assinatura diz qual dos dois, em vez de deixar
 * implicito.
 */

type LinhaDaTrilha = {
  id: string
  entity: string
  entity_id: string
  action: string
  actor_id: string
  channel: string
  occurred_at: Date
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

/**
 * O `before`/`after` para o `jsonb` da coluna.
 *
 * `AuditValues` e `Record<string, unknown>` de proposito: a trilha atravessa
 * todas as entidades e nao pode conhecer o tipo de cada campo. O `JSONValue` do
 * driver nao expressa isso, e a conversao e a fronteira onde afirmamos o que o
 * contrato ja garante — quem grava validou antes de chegar aqui.
 *
 * Fica numa funcao nomeada, e nao num `as` solto no meio do INSERT, para a
 * afirmacao ter um lugar onde ser lida e questionada.
 */
const paraJson = (valores: Record<string, unknown> | null): JSONValue | null =>
  valores === null ? null : (valores as JSONValue)

const paraEntrada = (l: LinhaDaTrilha): AuditEntryOutput => ({
  id: l.id,
  entity: l.entity,
  entityId: l.entity_id,
  action: l.action as AuditEntryOutput['action'],
  actorId: l.actor_id,
  channel: l.channel as AuditEntryOutput['channel'],
  occurredAt: l.occurred_at.toISOString(),
  before: l.before,
  after: l.after,
})

/**
 * Grava uma entrada NA transacao recebida — NR-087.
 *
 * Exportada porque os escopos de transacao de `packages/db` delegam para ca:
 * cada `escopo(tx, companyId)` ganha `record: (e) => gravarTrilha(tx, e)`. E
 * assim o INSERT mora num lugar so e a trilha entra junto com o que ela
 * registra.
 *
 * `company_id` vem da ENTRADA e nao do `withTenant`: aqui nao ha `withTenant`
 * — quem abriu a transacao ja definiu o tenant, e a politica de RLS confere o
 * valor no `WITH CHECK`. Gravar empresa diferente da do contexto e recusado
 * pelo banco, e nao por um `if` daqui.
 */
export async function gravarTrilha(
  tx: TransactionSql,
  entrada: NewAuditEntry,
): Promise<AuditEntryOutput> {
  /*
   * `tx.json` explicito no `before` e no `after`.
   *
   * Sem ele o driver serializa o objeto como TEXTO, e a coluna `jsonb` recusa
   * — ou, no pior caso, aceita a string e toda consulta por campo
   * (`before ->> 'stockQuantity'`) devolve nulo para sempre. A trilha
   * continuaria gravando e pararia de ser consultavel.
   */
  const [linha] = await tx<LinhaDaTrilha[]>`
    INSERT INTO audit_logs
      (company_id, entity, entity_id, action, actor_id, channel, occurred_at, before, after)
    VALUES (
      ${entrada.companyId}, ${entrada.entity}, ${entrada.entityId}, ${entrada.action},
      ${entrada.actorId}, ${entrada.channel}, ${entrada.occurredAt},
      ${entrada.before === null ? null : tx.json(paraJson(entrada.before))},
      ${entrada.after === null ? null : tx.json(paraJson(entrada.after))}
    )
    RETURNING id, entity, entity_id, action, actor_id, channel, occurred_at, before, after
  `

  if (linha === undefined) {
    /*
     * `RETURNING` sem linha depois de um INSERT que nao lancou nao deveria
     * acontecer. Falhar alto e o certo: devolver uma entrada inventada faria o
     * caso de uso seguir achando que auditou.
     */
    throw new Error('A entrada da trilha de auditoria nao foi gravada.')
  }

  return paraEntrada(linha)
}

/**
 * A trilha para quem NAO esta dentro de uma transacao de negocio.
 *
 * Sao os onze call sites que registram algo ja consumado — login, saida,
 * convite, exportacao, anonimizacao, classificacao contabil, importacao de
 * extrato. Ali a trilha nao precisa entrar junto com nada: o que ela registra
 * ja aconteceu, e uma falha ao gravar deve derrubar a requisicao (que e o que
 * a excecao faz) e nao desfazer uma operacao que nao existe mais.
 *
 * Abre a propria transacao por causa do `withTenant`: e ele quem define
 * `app.company_id`, e sem isso a politica de `audit_logs` recusa a escrita —
 * nao aceita em silencio, recusa. Ver ADR-0001.
 */
export function createAuditTrail(sql: Sql): AuditTrail {
  return {
    record: (entrada) => withTenant(sql, entrada.companyId, (tx) => gravarTrilha(tx, entrada)),
  }
}

/* --------------------------------------------------------------------------
   Leitura da trilha — US-061, "quando consulto"
   -------------------------------------------------------------------------- */

/**
 * A trilha como a tela pergunta.
 *
 * ## Por que o nome vem de uma funcao, e nao de um `JOIN`
 *
 * `users` tem politica de RLS que so mostra quem tem vinculo com a empresa do
 * contexto (migration 0002). Num `JOIN`, o nome sumiria justamente nos dois
 * casos que mais interessam a quem audita: o funcionario que SAIU, e o proprio
 * Super Admin agindo dentro da loja — ele nao tem vinculo em `company_users`.
 *
 * `audit_actor_names` (migration 0016) atravessa a politica com retorno minimo
 * e igualdade exata, no mesmo molde das funcoes `auth_*`. Os ids que ela
 * recebe vem de linhas que quem chama JA leu sob RLS, da propria empresa.
 *
 * ## Por que nao ha checagem de empresa no `WHERE`
 *
 * `withTenant` define `app.company_id`, e a politica de `audit_logs` faz o
 * resto. Repetir o filtro daria a impressao de que e ele quem protege — e no
 * dia em que alguem o removesse por parecer redundante, a protecao iria junto
 * sem ninguem notar.
 */
export function createAuditQueries(sql: Sql): AuditQueries {
  return {
    /**
     * Quem agiu, agrupado — a tela abre por aqui.
     *
     * Sem paginacao de proposito: sao PESSOAS, e uma loja nao tem milhares
     * delas nem quando tem milhares de registros. Paginar aqui seria paginar
     * o indice do livro.
     */
    listActors: (companyId) =>
      withTenant(sql, companyId, async (tx) => {
        const linhas = await tx<{ actor_id: string; entries: number; last_action_at: string }[]>`
          SELECT a.actor_id,
                 count(*)::int AS entries,
                 max(a.occurred_at) AS last_action_at
            FROM audit_logs a
           GROUP BY a.actor_id
           ORDER BY max(a.occurred_at) DESC
        `

        const nomes = new Map<string, string>()
        if (linhas.length > 0) {
          const autores = await tx<{ id: string; name: string }[]>`
            SELECT id, name FROM audit_actor_names(${linhas.map((l) => l.actor_id)}::uuid[])
          `
          for (const a of autores) nomes.set(a.id, a.name)
        }

        return linhas.map((l) => ({
          actorId: l.actor_id,
          actorName: nomes.get(l.actor_id) ?? null,
          entries: l.entries,
          lastActionAt: new Date(l.last_action_at).toISOString(),
        }))
      }),

    list: (companyId, filtro) =>
      withTenant(sql, companyId, async (tx) => {
        const condicoes = [
          filtro.entity === undefined ? tx`TRUE` : tx`a.entity = ${filtro.entity}`,
          filtro.actorId === undefined ? tx`TRUE` : tx`a.actor_id = ${filtro.actorId}::uuid`,
          filtro.action === undefined ? tx`TRUE` : tx`a.action = ${filtro.action}`,
          filtro.from === undefined ? tx`TRUE` : tx`a.occurred_at >= ${filtro.from}::timestamptz`,
          filtro.to === undefined ? tx`TRUE` : tx`a.occurred_at <= ${filtro.to}::timestamptz`,
        ].reduce((acc, cond) => tx`${acc} AND ${cond}`)

        const linhas = await tx<LinhaDaTrilha[]>`
          SELECT a.id, a.entity, a.entity_id, a.action, a.actor_id, a.channel,
                 a.occurred_at, a.before, a.after
            FROM audit_logs a
           WHERE ${condicoes}
           ORDER BY a.occurred_at DESC, a.id DESC
           LIMIT ${filtro.pageSize} OFFSET ${(filtro.page - 1) * filtro.pageSize}
        `

        const [contagem] = await tx<{ total: number }[]>`
          SELECT count(*)::int AS total FROM audit_logs a WHERE ${condicoes}
        `

        /* Uma consulta para a pagina inteira, e nao uma por linha: a mesma
           pessoa costuma aparecer varias vezes seguidas na trilha. */
        const ids = [...new Set(linhas.map((l) => l.actor_id))]
        const nomes = new Map<string, string>()

        if (ids.length > 0) {
          const autores = await tx<{ id: string; name: string }[]>`
            SELECT id, name FROM audit_actor_names(${ids}::uuid[])
          `
          for (const a of autores) nomes.set(a.id, a.name)
        }

        return {
          entries: linhas.map((l) => ({
            ...paraEntrada(l),
            /* Nulo quando o usuario nem existe mais: a trilha sobrevive a
               remocao de quem agiu, de proposito (`actor_id` sem FK). */
            actorName: nomes.get(l.actor_id) ?? null,
          })),
          total: contagem?.total ?? 0,
        }
      }),
  }
}
