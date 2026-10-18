import type {
  ConnectionListOutput,
  ConnectionPendingCountOutput,
  ConnectionRequestOutput,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext, UserId } from '../context.js'
import type { CompanyRepository } from '../ports/registration-repositories.js'
import {
  ConnectionActionRefusedError,
  ConnectionAlreadyExistsError,
  ConnectionNotFoundError,
  type ConnectionNotifier,
  type ConnectionRequests,
  TargetCompanyUnavailableError,
} from '../ports/connections.js'

export type ManageConnectionsDeps = {
  readonly connections: ConnectionRequests
  readonly notifier: ConnectionNotifier
  readonly companies: CompanyRepository
}

/**
 * Pedir conexao com outra empresa — RF-04.
 *
 * O auto-pedido e recusado AQUI, antes de qualquer ida ao banco: e a unica
 * das quatro regras de negocio que nao depende de dado de outra empresa, e
 * checar cedo poupa uma consulta cross-tenant para um pedido que nunca
 * poderia ter sucesso.
 */
export async function requestConnection(
  deps: ManageConnectionsDeps,
  ctx: ExecutionContext,
  targetCompanyId: string,
): Promise<ConnectionRequestOutput> {
  assertCanWrite(ctx)

  if (targetCompanyId === ctx.companyId) {
    throw AppError.validation('Não é possível pedir conexão com a própria empresa.', [
      { path: 'targetCompanyId', message: 'Escolha outra empresa.' },
    ])
  }

  const minhaEmpresa = await deps.companies.findById(ctx.companyId)
  if (minhaEmpresa === undefined) {
    throw AppError.notFound('Empresa não encontrada.')
  }

  try {
    const pedido = await deps.connections.request(ctx.userId, ctx.companyId, targetCompanyId)

    /*
     * O aviso e MELHOR ESFORCO — RF-04 pede notificar, nao pede que o pedido
     * falhe se a fila estiver fora do ar. `InvoiceQueue` tem a mesma postura:
     * enfileirar sem Redis falha, e o pedido ja foi gravado de qualquer jeito.
     */
    await deps.notifier
      .notifyRequestReceived({ ...pedido, requesterCompanyName: minhaEmpresa.tradeName })
      .catch(() => undefined)

    return { id: pedido.id }
  } catch (erro) {
    if (erro instanceof ConnectionAlreadyExistsError) {
      throw AppError.conflict(erro.message)
    }
    if (erro instanceof TargetCompanyUnavailableError) {
      /* A mensagem vem pronta da funcao SQL — "nao encontrada", "sem
         telefone cadastrado" e "sem dono ativo" sao recusas diferentes, e um
         texto generico aqui esconderia qual das tres aconteceu. */
      throw AppError.notFound(erro.message)
    }
    throw erro
  }
}

/** Aceitar ou recusar um pedido recebido — RF-04. */
export async function respondToConnection(
  deps: ManageConnectionsDeps,
  ctx: ExecutionContext,
  connectionId: string,
  accept: boolean,
): Promise<void> {
  assertCanWrite(ctx)
  await chamarComTraducaoDeErro(() => deps.connections.respond(connectionId, ctx.userId, accept))
}

/** Cancelar um pedido pendente, ou desfazer uma conexao aceita — RF-05. */
export async function endConnection(
  deps: ManageConnectionsDeps,
  ctx: ExecutionContext,
  connectionId: string,
): Promise<void> {
  assertCanWrite(ctx)
  await chamarComTraducaoDeErro(() => deps.connections.end(connectionId, ctx.userId))
}

/** Minhas conexoes, dos dois lados — RF-05. Leitura: nao exige `assertCanWrite`. */
export async function listConnections(
  deps: Pick<ManageConnectionsDeps, 'connections'>,
  ctx: ExecutionContext,
): Promise<ConnectionListOutput> {
  const linhas = await deps.connections.list(ctx.userId)
  return { connections: linhas.map((l) => ({ ...l })) }
}

/** Quantos pedidos recebidos e pendentes — o sino do painel. */
export async function connectionPendingCount(
  deps: Pick<ManageConnectionsDeps, 'connections'>,
  userId: UserId,
): Promise<ConnectionPendingCountOutput> {
  return { count: await deps.connections.pendingCount(userId) }
}

async function chamarComTraducaoDeErro(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (erro) {
    if (erro instanceof ConnectionNotFoundError) {
      throw AppError.notFound('Pedido de conexão não encontrado.')
    }
    if (erro instanceof ConnectionActionRefusedError) {
      throw AppError.conflict(erro.message)
    }
    throw erro
  }
}
