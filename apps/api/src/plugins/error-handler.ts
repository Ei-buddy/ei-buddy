import { AppError, type AppErrorCode, isAppError } from '@na-regua/core'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

/**
 * Traducao de erro para HTTP.
 *
 * Uma regra manda em tudo aqui: **o cliente nunca ve o que ele nao deveria**
 * (RNF-054, seguranca.md). Erro esperado vira mensagem em pt-br dizendo o que
 * fazer; erro inesperado vira 500 com texto generico, e o detalhe real vai
 * para o log — onde a equipe ve e o atacante nao.
 */

const STATUS: Record<AppErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
}

/** Formato unico de erro. Cliente que trata um trata todos. */
export type ErrorBody = {
  error: {
    code: AppErrorCode | 'INTERNAL'
    message: string
    /** Só em VALIDATION_FAILED. Vazio nos demais. */
    fields: readonly { path: string; message: string }[]
  }
  /** Correlaciona com o log. E o que o suporte pede, em vez de "deu erro". */
  requestId: string
}

/**
 * Erros do Postgres que sao do PEDIDO, nao do servidor.
 *
 * Um id que nao e uuid (`22P02`) ou que aponta para registro inexistente
 * (`23503`, chave estrangeira) chegavam aqui crus e viravam 500 — "algo deu
 * errado do nosso lado" para um cliente que nao existe. Os dois dizem a mesma
 * coisa a quem chamou: o registro citado nao existe. Reconhecidos pelo codigo
 * SQLSTATE, sem a api depender do driver.
 */
const REGISTRO_INEXISTENTE = new Set(['22P02', '23503'])

function erroDoPedidoNoBanco(error: unknown): AppError | undefined {
  const codigo = (error as { code?: unknown } | null)?.code
  if (typeof codigo === 'string' && REGISTRO_INEXISTENTE.has(codigo)) {
    return AppError.notFound('Um dos registros informados não existe. Confira e tente de novo.')
  }
  return undefined
}

/**
 * Erro do PROPRIO Fastify sobre o pedido — corpo JSON vazio, JSON quebrado,
 * tipo de conteudo nao aceito. Vem com `statusCode` 4xx e codigo `FST_*`, e
 * caia no 500 abaixo: "algo deu errado do nosso lado" para um pedido que veio
 * errado. A mensagem original nao vai (pode citar detalhe do parser).
 */
function erroDoPedidoNoFastify(error: unknown): AppError | undefined {
  const e = error as { code?: unknown; statusCode?: unknown } | null
  if (
    typeof e?.code === 'string' &&
    e.code.startsWith('FST_') &&
    typeof e.statusCode === 'number' &&
    e.statusCode >= 400 &&
    e.statusCode < 500
  ) {
    return AppError.validation(
      'O pedido não veio no formato esperado. Atualize o app e tente de novo.',
    )
  }
  return undefined
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id

    const traduzido = erroDoPedidoNoBanco(error) ?? erroDoPedidoNoFastify(error)
    if (traduzido !== undefined) error = traduzido

    if (isAppError(error)) {
      const status = STATUS[error.code]
      /* Erro esperado nao e incidente: fica em warn para nao poluir o alerta. */
      request.log.warn({ code: error.code, status }, error.message)

      return reply.code(status).send({
        error: { code: error.code, message: error.message, fields: error.fields },
        requestId,
      } satisfies ErrorBody)
    }

    /*
     * Daqui para baixo o erro e inesperado — bug, banco fora, adapter quebrado.
     * O log leva o erro inteiro; a resposta nao leva nada dele. Vazar a
     * mensagem original aqui e como expor `relation "users" does not exist`
     * para quem esta sondando a API.
     */
    request.log.error({ err: error }, 'erro nao tratado')

    return reply.code(500).send({
      error: {
        code: 'INTERNAL',
        message: 'Algo deu errado do nosso lado. Tente de novo em instantes.',
        fields: [],
      },
      requestId,
    } satisfies ErrorBody)
  })

  /* 404 tambem no formato unico — senao o cliente teria dois formatos. */
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const error = AppError.notFound('Este endereço não existe.')

    return reply.code(404).send({
      error: { code: error.code, message: error.message, fields: [] },
      requestId: request.id,
    } satisfies ErrorBody)
  })
}
