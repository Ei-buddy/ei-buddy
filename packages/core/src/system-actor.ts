import type { ExecutionContext } from './context.js'

/**
 * Quem "agiu" quando ninguem agiu — NR-044.
 *
 * Ha acoes que mudam dado de negocio sem pessoa nenhuma do outro lado: o
 * cliente paga um link e o titulo baixa; o prazo de teste acaba e a loja fica
 * restrita. A auditoria continua obrigatoria (RNF-040), e ela precisa de um
 * autor.
 *
 * As alternativas eram piores:
 *
 * - **o dono da loja** — mentira, e mentira que aparece na tela de auditoria
 *   como "Joao deu baixa" numa baixa que o Joao nao deu;
 * - **nulo** — `audit_logs.actor_id` e `NOT NULL`, e afrouxar isso abriria a
 *   porta para acao humana sem autor;
 * - **um texto tipo `'job'`** — a coluna e `uuid`, e foi exatamente isso que
 *   derrubou a primeira versao da baixa por webhook com 500.
 *
 * Um uuid fixo e reconhecivel resolve: a auditoria diz "sistema", e diz a
 * verdade. A versao 4 no formato mantem a forma valida de uuid; os zeros
 * tornam obvio, para quem olha o banco, que nao e ninguem.
 */
export const ATOR_DO_SISTEMA = '00000000-0000-4000-8000-000000000000'

/**
 * O usuario REAL por tras do contexto, ou `null` quando foi o sistema.
 *
 * Existe porque as duas colunas de autoria tem regras diferentes, e a
 * diferenca nao e detalhe: `audit_logs.actor_id` nao tem chave estrangeira —
 * ela aceita o ator do sistema e deve receber, porque o registro de auditoria
 * precisa dizer quem foi. Ja `settlements.created_by` (e as colunas iguais a
 * ela) referencia `users`: gravar ali um id que nao existe na tabela viola a
 * FK, e inventar um usuario para satisfazer a FK seria criar uma pessoa que
 * nao existe.
 *
 * Entao: a auditoria recebe o ator; a coluna de usuario recebe `null`.
 */
export function usuarioReal(ctx: ExecutionContext): string | null {
  return ctx.userId === ATOR_DO_SISTEMA ? null : ctx.userId
}
