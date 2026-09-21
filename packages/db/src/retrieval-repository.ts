import { normalizarParaBusca, type Candidato, type RetrievalStore } from '@na-regua/core'
import type { Sql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Recuperacao auxiliar por trigrama — NR-120, RF-102, ADR-0017.
 *
 * Semelhanca de ESCRITA, e nao de significado: `similarity()` do `pg_trgm`
 * compara sequencias de tres letras. E o que resolve o caso da RF-102 —
 * "coca 2l" achar "Coca-Cola 2 litros" — sem embedding, sem custo por chamada
 * e sem extensao que a CI e a VPS nao tem.
 *
 * A normalizacao mora em `core` (`normalizarParaBusca`) e roda nos DOIS lados:
 * ao gravar e ao consultar. Se so um normalizasse, "Sabao em po" nunca
 * encontraria "sabão em pó".
 */

/**
 * O piso de semelhanca para um candidato existir.
 *
 * Abaixo disto o trigrama casa por acidente: duas palavras curtas com letras
 * em comum. Devolver esse tipo de palpite e pior que devolver nada — o
 * assistente sugeriria um produto que nao tem relacao com o que foi pedido, e
 * o lojista confirmaria sem reler.
 *
 * `0.15` e frouxo de proposito para o portugues de balcao, em que a pessoa
 * escreve um terco do nome. Quem corta de verdade e o `k`.
 */
const PISO_DE_SEMELHANCA = 0.15

type Linha = { kind: string; ref_id: string | null; conteudo: string; relevancia: number }

export function createRetrievalStore(sql: Sql): RetrievalStore {
  return {
    indexar: async (trecho) => {
      await withTenant(
        sql,
        trecho.companyId,
        (tx) => tx`
          INSERT INTO retrieval_chunks
            (company_id, kind, ref_id, conteudo, normalizado, atualizado_em)
          VALUES (
            ${trecho.companyId}, ${trecho.kind}, ${trecho.refId},
            ${trecho.conteudo}, ${normalizarParaBusca(trecho.conteudo)},
            ${trecho.atualizadoEm}
          )
          /* Reindexar ATUALIZA. Sem isto, renomear um produto deixaria o nome
             antigo respondendo para sempre — e o lojista veria o assistente
             sugerir um item que ele mesmo corrigiu. */
          ON CONFLICT (company_id, kind, ref_id) WHERE ref_id IS NOT NULL
            DO UPDATE SET conteudo = EXCLUDED.conteudo,
                          normalizado = EXCLUDED.normalizado,
                          atualizado_em = EXCLUDED.atualizado_em
        `,
      )
    },

    remover: async (entrada) => {
      await withTenant(
        sql,
        entrada.companyId,
        (tx) => tx`
          DELETE FROM retrieval_chunks
           WHERE kind = ${entrada.kind} AND ref_id = ${entrada.refId}
        `,
      )
    },

    buscar: async (entrada): Promise<readonly Candidato[]> => {
      const consulta = normalizarParaBusca(entrada.consulta)
      if (consulta === '') return []

      const linhas = await withTenant(
        sql,
        entrada.companyId,
        (tx) => tx<Linha[]>`
          SELECT kind, ref_id, conteudo, similarity(normalizado, ${consulta}) AS relevancia
            FROM retrieval_chunks
           WHERE company_id = ${entrada.companyId}
             ${entrada.kind === undefined ? tx`` : tx`AND kind = ${entrada.kind}`}
             /*
              * O operador "%" usa o indice de trigrama; "similarity() >"
              * sozinho faria varredura. O piso explicito vem DEPOIS porque o
              * "%" obedece ao pg_trgm.similarity_threshold da SESSAO, que nao
              * controlamos — sem ele, o corte mudaria com a configuracao do
              * banco em vez de com o nosso codigo.
              */
             AND normalizado % ${consulta}
             AND similarity(normalizado, ${consulta}) >= ${PISO_DE_SEMELHANCA}
           ORDER BY relevancia DESC, conteudo
           LIMIT ${entrada.k}
        `,
      )

      return linhas.map((l) => ({
        kind: l.kind as Candidato['kind'],
        refId: l.ref_id,
        conteudo: l.conteudo,
        /* `similarity` volta `real`; o driver pode entregar string. */
        relevancia: Number(l.relevancia),
      }))
    },
  }
}
