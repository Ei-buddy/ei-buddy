import {
  type CheckCustomerWalletInput,
  type CreateCustomerInput,
  type CustomerListInput,
  type CustomerListOutput,
  type CustomerOutput,
  DIAS_PARA_INATIVO,
  type ImportCustomersInput,
  type ImportCustomersOutput,
} from '@na-regua/contracts'
import { AppError, isAppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { CustomerRepository } from '../ports/registration-repositories.js'

export type RegisterCustomerDeps = {
  readonly customers: CustomerRepository
}

export type RegisterCustomerOptions = {
  /**
   * Confirma o cadastro mesmo havendo parecido — RF-010.
   *
   * O balcao ja viu a lista de candidatos e decidiu que e outra pessoa. Sem
   * este passo, dois irmaos com o mesmo telefone de casa nao conseguiriam
   * comprar, e isso acontece.
   */
  readonly allowDuplicate?: boolean
}

/**
 * Resultado do cadastro.
 *
 * Uniao discriminada, e nao excecao no caso do parecido: "achei alguem
 * parecido" nao e erro, e uma pergunta — e a resposta e do balcao, com o
 * cliente na frente. Excecao aqui obrigaria a rota a transformar um fluxo
 * normal em `catch`, e o WhatsApp a fazer o mesmo por outro caminho.
 */
export type RegisterCustomerResult =
  | { readonly status: 'created'; readonly customer: CustomerOutput }
  | { readonly status: 'duplicate_found'; readonly candidates: readonly CustomerOutput[] }

/**
 * Cadastra cliente — RF-009, RF-010.
 *
 * Exige apenas nome. RF-009 fala em "apenas nome e telefone", e o telefone
 * tambem e opcional aqui de proposito: no balcao ele as vezes vem depois, e
 * exigir mais campo do que o necessario e travar a venda para cadastrar
 * ficha. Quem precisa de telefone e o envio de mensagem, que verifica na hora.
 */
export async function registerCustomer(
  deps: RegisterCustomerDeps,
  ctx: ExecutionContext,
  input: CreateCustomerInput,
  options: RegisterCustomerOptions = {},
): Promise<RegisterCustomerResult> {
  assertCanWrite(ctx)

  if (!options.allowDuplicate && (input.phone !== undefined || input.document !== undefined)) {
    const candidates = await deps.customers.findSimilar(ctx.companyId, {
      phone: input.phone,
      document: input.document,
    })

    if (candidates.length > 0) {
      return { status: 'duplicate_found', candidates }
    }
  }

  const customer = await deps.customers.create({
    companyId: ctx.companyId,
    name: input.name,
    document: input.document,
    phone: input.phone,
    email: input.email,
    notes: input.notes,
    walletLimitCents: input.walletLimitCents,
    address: input.address,
    createdBy: ctx.userId,
    createdAt: ctx.now,
  })

  return { status: 'created', customer }
}

/**
 * Recusa cadastro sem nenhum jeito de identificar a pessoa.
 *
 * Nao e chamada por `registerCustomer` — o cadastro so com nome e legitimo.
 * Existe para quem PRECISA identificar depois: cobranca por WhatsApp, fiado.
 * Fica aqui, e nao na rota, porque a regra vale para os dois canais.
 */
export function assertIdentifiable(customer: CustomerOutput): void {
  if (customer.phone === null && customer.document === null) {
    throw AppError.validation(
      'Este cliente nao tem telefone nem documento. Complete o cadastro para continuar.',
      [{ path: 'phone', message: 'Informe telefone ou documento.' }],
    )
  }
}

/**
 * Importacao de clientes em lote — NR-072, US-008.
 *
 * ## O parecido entra, e nao vira recusa
 *
 * `registerCustomer` devolve `duplicate_found` quando acha alguem parecido, e
 * no balcao isso e uma PERGUNTA que o operador responde com o cliente na
 * frente. Numa planilha nao ha ninguem para responder, e travar 40 linhas
 * esperando confirmacao transformaria a importacao num formulario.
 *
 * Entao o lote confirma (`allowDuplicate: true`) e o parecido entra. O
 * lojista tem a tela de clientes para juntar depois; o contrario — a linha
 * sumir sem aviso — deixaria o cadastro incompleto com cara de completo.
 *
 * Sequencial pelo mesmo motivo da importacao de produtos: a deteccao de
 * parecido le o que ja existe, e em paralelo duas linhas iguais do proprio
 * arquivo nao se enxergariam.
 */
export async function importCustomers(
  deps: RegisterCustomerDeps,
  ctx: ExecutionContext,
  input: ImportCustomersInput,
): Promise<ImportCustomersOutput> {
  assertCanWrite(ctx)

  const rejected: { index: number; description: string; reason: string }[] = []
  let imported = 0

  for (const [index, linha] of input.customers.entries()) {
    try {
      await registerCustomer(deps, ctx, linha, { allowDuplicate: true })
      imported += 1
    } catch (erro) {
      /* Erro desconhecido SOBE: banco fora do ar nao e "linha invalida", e
         transforma-lo numa faria a tela dizer "298 importados" para um lote
         que parou no meio. */
      if (!isAppError(erro)) throw erro

      rejected.push({ index, description: linha.name, reason: erro.message })
    }
  }

  return { imported, rejected }
}

/**
 * A lista de clientes — RF-011, US-036.
 *
 * Leitura: sem `assertCanWrite`. Quem vende precisa achar o cliente, e o
 * `accountant` consulta cadastro para conferir nota.
 *
 * O que `core` decide aqui e o que "inativo" significa: a fronteira de dias vem
 * de `contracts` (`DIAS_PARA_INATIVO`) e nao do repositorio, porque e regra de
 * negocio — a mesma que o CRM usa para dizer "faz dois meses que ela nao vem".
 * Deixa-la no SQL espalharia a definicao por cada consulta que precisasse dela.
 */
/**
 * A ficha de um cliente — RF-011.
 *
 * Nao usa a lista com `pageSize: 1`: a lista e a resposta para "quem sao meus
 * clientes", e traz o historico de compra de cada um. A ficha responde outra
 * pergunta — "quem e esta pessoa" — e o que ela precisa (endereco, limite de
 * fiado, observacao) nao depende de varrer vendas.
 *
 * Cliente de outra empresa vira `NOT_FOUND` e nao `FORBIDDEN`, de proposito: um
 * erro diferente de "nao existe" confirmaria, para quem estivesse tentando ids,
 * que aquele cliente existe em alguma outra loja.
 */
export async function getCustomer(
  deps: { readonly customers: CustomerRepository },
  ctx: ExecutionContext,
  customerId: string,
): Promise<CustomerOutput> {
  const cliente = await deps.customers.findById(ctx.companyId, customerId)

  if (cliente === undefined) {
    throw AppError.notFound('Cliente nao encontrado.')
  }

  return cliente
}

export async function listCustomers(
  deps: { readonly customers: CustomerRepository },
  ctx: ExecutionContext,
  input: CustomerListInput,
): Promise<CustomerListOutput> {
  const { clientes, total } = await deps.customers.list(ctx.companyId, {
    ...(input.q === undefined || input.q === '' ? {} : { termo: input.q }),
    filtro: input.filter,
    diasParaInativo: DIAS_PARA_INATIVO,
    hoje: ctx.now,
    offset: (input.page - 1) * input.pageSize,
    limite: input.pageSize,
  })

  return { customers: [...clientes], total, page: input.page, pageSize: input.pageSize }
}

export type SearchCustomersDeps = {
  readonly customers: CustomerRepository
}

const LIMITE_BUSCA_CLIENTE = 5

/** Resultado da busca textual antes da leitura de saldo — NR-115. */
export type CheckCustomerWalletByQueryResult =
  | {
      readonly status: 'found'
      readonly customerName: string
      readonly walletBalanceCents: number
    }
  | { readonly status: 'not_found' }
  | { readonly status: 'ambiguous'; readonly alternatives: readonly CustomerOutput[] }

export type CheckCustomerWalletByQueryDeps = SearchCustomersDeps

/**
 * Busca textual de clientes para o balcao — NR-115.
 *
 * Leitura, sem `assertCanWrite`. O limite evita varrer o cadastro inteiro e
 * forca desambiguacao quando ha varios parecidos.
 */
export async function searchCustomers(
  deps: SearchCustomersDeps,
  ctx: ExecutionContext,
  input: { readonly termo?: string; readonly limite?: number },
): Promise<readonly CustomerOutput[]> {
  const limite = Math.min(input.limite ?? LIMITE_BUSCA_CLIENTE, LIMITE_BUSCA_CLIENTE)

  return deps.customers.search(ctx.companyId, {
    ...(input.termo === undefined || input.termo.trim() === ''
      ? {}
      : { termo: input.termo.trim() }),
    limite: Math.max(1, limite),
  })
}

/**
 * Consulta de fiado por texto — NR-115, RF-135.
 *
 * Busca primeiro; so informa `walletBalanceCents` quando ha candidato unico.
 * Zero ou varios candidatos terminam em ausencia ou desambiguacao, sem escolher
 * cliente nem inventar saldo.
 */
export async function checkCustomerWalletByQuery(
  deps: CheckCustomerWalletByQueryDeps,
  ctx: ExecutionContext,
  input: CheckCustomerWalletInput,
): Promise<CheckCustomerWalletByQueryResult> {
  const candidatos = await searchCustomers(deps, ctx, {
    termo: input.query,
    limite: LIMITE_BUSCA_CLIENTE,
  })

  if (candidatos.length === 0) {
    return { status: 'not_found' }
  }

  if (candidatos.length > 1) {
    return { status: 'ambiguous', alternatives: candidatos }
  }

  const cliente = candidatos[0]!
  return {
    status: 'found',
    customerName: cliente.name,
    walletBalanceCents: cliente.walletBalanceCents,
  }
}
