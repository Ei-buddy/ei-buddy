/**
 * Erro de aplicacao tipado.
 *
 * `DomainError` (packages/domain) cobre regra de calculo pura — "parcelas
 * invalidas", "itens vazios". Este cobre o que so o caso de uso sabe:
 * o recurso nao existe, o papel nao permite, a operacao conflita com o estado
 * atual.
 *
 * A separacao importa porque quem traduz para HTTP e `apps/api`, e ele precisa
 * do CODIGO para escolher o status — nunca da string, que muda com a redacao.
 * Ver docs/engenharia/code-style.md#tratamento-de-erro
 */
export type AppErrorCode =
  /** Entrada nao passou no schema de `contracts` — RNF-027. */
  | 'VALIDATION_FAILED'
  /** Sem credencial, ou credencial invalida. */
  | 'UNAUTHORIZED'
  /**
   * Autenticado, mas o papel nao permite.
   *
   * Cuidado: recurso de OUTRA empresa responde NOT_FOUND, nunca este —
   * 403 confirma que o recurso existe (apps/api/README.md#seguranca).
   */
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  /** Conflito com o estado atual: venda ja cancelada, e-mail ja cadastrado. */
  | 'CONFLICT'
  /** Limite de requisicoes estourado — RNF-026. */
  | 'RATE_LIMITED'

/** Detalhe por campo, para a tela destacar onde esta o problema. */
export type FieldIssue = {
  readonly path: string
  readonly message: string
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly fields: readonly FieldIssue[]

  /**
   * `message` vai para o usuario: diz o que aconteceu e o que fazer, sem
   * jargao nem codigo cru — RNF-054. Nada de "constraint violation".
   */
  constructor(code: AppErrorCode, message: string, fields: readonly FieldIssue[] = []) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.fields = fields
  }

  static notFound(message = 'Nao encontramos o que voce procura.'): AppError {
    return new AppError('NOT_FOUND', message)
  }

  static forbidden(message = 'Seu perfil nao permite esta acao.'): AppError {
    return new AppError('FORBIDDEN', message)
  }

  static unauthorized(message = 'Sessao expirada. Entre de novo para continuar.'): AppError {
    return new AppError('UNAUTHORIZED', message)
  }

  /** `fields` opcional: o cadastro aponta o campo repetido (e-mail, CNPJ, celular). */
  static conflict(message: string, fields: readonly FieldIssue[] = []): AppError {
    return new AppError('CONFLICT', message, fields)
  }

  static validation(message: string, fields: readonly FieldIssue[] = []): AppError {
    return new AppError('VALIDATION_FAILED', message, fields)
  }

  /**
   * Tentativas demais — RF-120, RNF-026.
   *
   * A mensagem diz QUANTO esperar, e nao so que houve excesso: sem o tempo, a
   * unica estrategia de quem esta do outro lado e tentar de novo, o que
   * realimenta o bloqueio.
   */
  static rateLimited(message: string): AppError {
    return new AppError('RATE_LIMITED', message)
  }
}

/** Estreita `unknown` de um `catch` sem recorrer a `instanceof` em cascata. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
