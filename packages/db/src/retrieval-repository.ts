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
 * assistente sugeriria um produto sem relacao com o que foi pedido, e o
 * lojista confirmaria sem reler.
 *
 * `0.5` sobre **word_similarity**, e nao sobre `similarity`: aqui a medida ja
 * e "quanto da consulta aparece no alvo", entao metade e um piso exigente o
 * bastante para descartar coincidencia e frouxo o bastante para o portugues de
 * balcao, em que a pessoa escreve um terco do nome. Quem corta de verdade e o
 * `k`.
 */
const PISO_DE_SEMELHANCA = 0.5

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
          SELECT kind, ref_id, conteudo,
                 word_similarity(${consulta}, normalizado) AS relevancia
            FROM retrieval_chunks
           WHERE company_id = ${entrada.companyId}
             ${entrada.kind === undefined ? tx`` : tx`AND kind = ${entrada.kind}`}
             /*
              * "<%" e word_similarity, e nao "%" e similarity — a diferenca e
              * o caso da RF-102 inteiro.
              *
              * "similarity" compara os dois textos POR INTEIRO e penaliza a
              * diferenca de tamanho: "coca" contra "coca-cola 2 litros" fica
              * abaixo de qualquer piso util, porque o alvo e cinco vezes
              * maior. E quem escreve no balcao digita um pedaco.
              *
              * "word_similarity" mede quanto da CONSULTA aparece no alvo, que
              * e a pergunta certa: "coca" esta inteiro dentro de "coca-cola 2
              * litros". A ordem dos argumentos importa e nao e simetrica —
              * invertida, mede quanto do alvo cabe na consulta e o problema
              * volta.
              *
              * O operador usa o mesmo indice GIN. O piso explicito vem DEPOIS
              * porque "<%" obedece ao pg_trgm.word_similarity_threshold da
              * SESSAO, que nao controlamos: sem ele, o corte mudaria com a
              * configuracao do banco em vez de com o nosso codigo.
              */
             AND ${consulta} <% normalizado
             AND word_similarity(${consulta}, normalizado) >= ${PISO_DE_SEMELHANCA}
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
