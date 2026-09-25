import { createHash, randomBytes } from 'node:crypto'
import type { LoginThrottle, SessionClaims, SessionIssuer } from '@na-regua/core'
import type { Role } from '@na-regua/contracts'
import type { Sql } from 'postgres'

/**
 * Sessao e desaceleracao no banco — NR-083, ADR-0002, RF-119, RF-120.
 *
 * ## O que isto substitui
 *
 * `InMemorySessionIssuer` e `InMemoryLoginThrottle`, que guardam tudo num `Map`
 * da instancia. Os motivos estao na migration 0022, e o resumo e: reiniciar
 * deslogava todo mundo, duas instancias nao compartilhavam nada, e **sessao nao
 * dava para revogar** — que e o pre-requisito da RF-006.
 *
 * ## Por que NAO passa por `withTenant`
 *
 * Pelo mesmo motivo de `createUserDirectory`: nao existe empresa a passar. A
 * sessao e lida em TODA requisicao autenticada, antes de haver contexto —
 * porque e ela que produz o contexto. Um `withTenant` aqui seria pedir a empresa
 * a quem ainda vai descobri-la.
 *
 * As tabelas ficam sob RLS sem politica (nega tudo) e o acesso passa pelas
 * funcoes `auth_session_*` e `auth_throttle_*`, no desenho da 0003. A migration
 * explica cada restricao.
 */

/**
 * 32 bytes sorteados, em base64url.
 *
 * 256 bits de entropia: nao ha o que adivinhar, e por isso o hash guardado pode
 * ser SHA-256 em vez de um KDF lento — ver o comentario da coluna na 0022.
 *
 * `randomBytes` e nao `randomUUID`: um uuid v4 carrega 122 bits e tem formato
 * reconhecivel. Aqui nao ha razao para economizar entropia.
 */
const TAMANHO_DO_TOKEN = 32

export const gerarToken = (): string => randomBytes(TAMANHO_DO_TOKEN).toString('base64url')

/**
 * O que vai para o banco.
 *
 * Exportado porque o teste precisa conferir que a tabela guarda o HASH e nunca
 * o token — e um teste que recalcula o hash com sua propria linha nao prova nada
 * se a implementacao mudar de algoritmo.
 */
export const hashDoToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('base64url')

type LinhaDeSessao = {
  user_id: string
  active_company_id: string | null
  role: string | null
}

/**
 * Monta os claims a partir da linha.
 *
 * O CHECK `sessions_papel_acompanha_empresa` ja garante no banco que empresa e
 * papel andam juntos, mas `SessionClaims` e uniao discriminada e o TypeScript
 * nao sabe do CHECK. Estes dois `if` sao a travessia: sem eles seria preciso um
 * `as` afirmando o que o banco garante — e `as` e onde a garantia deixa de ser
 * conferida no dia em que alguem mexer na coluna.
 */
function paraClaims(l: LinhaDeSessao): SessionClaims | undefined {
  if (l.active_company_id === null && l.role === null) {
    /* Sem loja escolhida — estado valido, e so consegue escolher loja. */
    return { userId: l.user_id, companyId: null }
  }

  if (l.active_company_id !== null && l.role !== null) {
    return { userId: l.user_id, companyId: l.active_company_id, role: l.role as Role }
  }

  /* Um nulo e o outro nao: o CHECK impede, entao chegar aqui e linha
     corrompida. Vira sessao INVALIDA, e nao sessao meio-boa — um papel
     indefinido entrando em `assertCanWrite` e uma permissao que ninguem
     verificou. */
  return undefined
}

export function createSessionIssuer(sql: Sql): SessionIssuer {
  return {
    issue: async (claims, expiresAt) => {
      const token = gerarToken()

      await sql`
        SELECT auth_session_issue(
          ${hashDoToken(token)},
          ${claims.userId},
          ${claims.companyId},
          ${claims.companyId === null ? null : claims.role},
          ${expiresAt}
        )
      `

      /* O token em texto existe SO aqui e na resposta ao cliente. Nao volta a
         aparecer em lugar nenhum do servidor — nem em log, nem no banco. */
      return token
    },

    read: async (token) => {
      const [linha] = await sql<LinhaDeSessao[]>`
        SELECT * FROM auth_session_read(${hashDoToken(token)})
      `

      /* Expirada e revogada nao chegam aqui: a funcao ja as filtra. Filtrar la
         e o que impede os dois caminhos de discordarem — um `expires_at`
         esquecido neste arquivo seria uma sessao eterna, sem nada falhando. */
      return linha === undefined ? undefined : paraClaims(linha)
    },

    revoke: async (token) => {
      await sql`SELECT auth_session_revoke(${hashDoToken(token)})`
    },
  }
}

export function createLoginThrottle(sql: Sql): LoginThrottle {
  return {
    /**
     * Quantos segundos esperar, ou `undefined` quando pode tentar.
     *
     * A conta inteira mora em SQL (`auth_throttle_retry_after`): janela,
     * tolerancia, dobra e teto. Aqui em cima seria ler-modificar-escrever, e
     * duas tentativas simultaneas contariam uma — e sob forca bruta
     * "simultaneas" e o caso normal, nao a borda.
     */
    retryAfter: async (chave) => {
      const [linha] = await sql<{ segundos: number | null }[]>`
        SELECT auth_throttle_retry_after(${chave}) AS segundos
      `

      const segundos = linha?.segundos ?? null
      return segundos === null || segundos <= 0 ? undefined : Number(segundos)
    },

    registerFailure: async (chave, at) => {
      await sql`SELECT auth_throttle_register_failure(${chave}, ${at})`
    },

    clear: async (chave) => {
      await sql`SELECT auth_throttle_clear(${chave})`
    },
  }
}
