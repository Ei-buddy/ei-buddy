import type { CreateCustomerContactInput, CustomerContactOutput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { CustomerContactRepository } from '../ports/customer-contacts.js'

/**
 * Lancar e ler contatos da ficha do cliente — RF-011, NR-072.
 *
 * A ficha ja mostrava um "Historico de contatos" desde que a tela existe, com
 * dados de exemplo, e o botao de lancar abria um aviso: "Lancamento de contato
 * entra com o modulo de CRM". Nao entrou — o CRM que existe (`crm_cards`,
 * NR-109) e um quadro de oportunidades da loja, e nao o diario de quem falou
 * com quem.
 */

export type CustomerContactDeps = {
  readonly contacts: CustomerContactRepository
}

/** Quantos contatos a ficha traz. Ver o comentario da porta sobre paginacao. */
export const TETO_DE_CONTATOS_NA_FICHA = 200

/**
 * O dia de hoje no fuso do sistema, em AAAA-MM-DD.
 *
 * Vem de `ctx.now` e nao de `new Date()`: a data padrao de um lancamento e
 * decisao do caso de uso, e caso de uso que le o relogio sozinho nao e
 * testavel.
 */
function hojeEm(agora: Date): string {
  return agora.toISOString().slice(0, 10)
}

export async function addCustomerContact(
  deps: CustomerContactDeps,
  ctx: ExecutionContext,
  customerId: string,
  input: CreateCustomerContactInput,
): Promise<CustomerContactOutput> {
  assertCanWrite(ctx)

  const gravado = await deps.contacts.create({
    companyId: ctx.companyId,
    customerId,
    kind: input.kind,
    description: input.description,
    happenedOn: input.happenedOn ?? hojeEm(ctx.now),
    createdBy: ctx.userId,
  })

  /*
   * Cliente de outra empresa cai no MESMO 404 de "nao existe", como em
   * `getCustomer`: um erro diferente confirmaria, para quem estivesse tentando
   * ids, que aquele cliente existe em alguma outra loja.
   */
  if (gravado === undefined) {
    throw AppError.notFound('Cliente nao encontrado.')
  }

  return gravado
}

export async function listCustomerContacts(
  deps: CustomerContactDeps,
  ctx: ExecutionContext,
  customerId: string,
): Promise<readonly CustomerContactOutput[]> {
  return deps.contacts.listByCustomer(ctx.companyId, customerId, TETO_DE_CONTATOS_NA_FICHA)
}
