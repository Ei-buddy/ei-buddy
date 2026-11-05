import type {
  CreateSupplierInput,
  ListSuppliersQuery,
  SupplierOutput,
  UpdateSupplierInput,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { EnderecoDoFornecedor, SupplierRepository } from '../ports/supplier-repository.js'
import { usuarioReal } from '../system-actor.js'

export type SupplierDeps = {
  readonly suppliers: SupplierRepository
  readonly audit: AuditTrail
}

/** Quantos a lista traz — uma loja tem dezenas de fornecedores, nao milhares. */
export const FORNECEDORES_NA_LISTA = 200

const enderecoDe = (e: CreateSupplierInput['address']): EnderecoDoFornecedor => ({
  zipCode: e?.zipCode ?? null,
  street: e?.street ?? null,
  number: e?.number ?? null,
  complement: e?.complement ?? null,
  district: e?.district ?? null,
  city: e?.city ?? null,
  state: e?.state ?? null,
})

const JA_EXISTE = (nome: string) =>
  AppError.conflict(`Já existe um fornecedor com este CPF/CNPJ: ${nome}.`)

/** Os fornecedores da loja, por nome — NR-191. Leitura: o contador tambem ve. */
export async function listSuppliers(
  deps: Pick<SupplierDeps, 'suppliers'>,
  ctx: ExecutionContext,
  query: ListSuppliersQuery,
): Promise<readonly SupplierOutput[]> {
  return deps.suppliers.list(ctx.companyId, {
    ...(query.q === undefined || query.q === '' ? {} : { termo: query.q }),
    somenteAtivos: query.somenteAtivos ?? true,
    limite: FORNECEDORES_NA_LISTA,
  })
}

export async function getSupplier(
  deps: Pick<SupplierDeps, 'suppliers'>,
  ctx: ExecutionContext,
  id: string,
): Promise<SupplierOutput> {
  const f = await deps.suppliers.findById(ctx.companyId, id)
  if (f === undefined) throw AppError.notFound('Fornecedor não encontrado.')
  return f
}

/**
 * Cadastra o fornecedor. O mesmo CPF/CNPJ duas vezes na loja e recusado com
 * o nome de quem ja tem — o lojista abre esse, em vez de criar o segundo.
 */
export async function createSupplier(
  deps: SupplierDeps,
  ctx: ExecutionContext,
  input: CreateSupplierInput,
): Promise<SupplierOutput> {
  assertCanWrite(ctx)

  if (input.document !== undefined) {
    const existente = await deps.suppliers.findByDocument(ctx.companyId, input.document)
    if (existente !== undefined) throw JA_EXISTE(existente.name)
  }

  const f = await deps.suppliers.insert({
    companyId: ctx.companyId,
    name: input.name,
    tradeName: input.tradeName ?? null,
    document: input.document ?? null,
    stateRegistration: input.stateRegistration ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    contactName: input.contactName ?? null,
    address: enderecoDe(input.address),
    notes: input.notes ?? null,
    createdBy: usuarioReal(ctx),
    createdAt: ctx.now,
  })

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'Supplier',
    entityId: f.id,
    action: 'created',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: null,
    after: { name: f.name, document: f.document },
  })

  return f
}

export async function updateSupplier(
  deps: SupplierDeps,
  ctx: ExecutionContext,
  id: string,
  input: UpdateSupplierInput,
): Promise<SupplierOutput> {
  assertCanWrite(ctx)

  const antes = await deps.suppliers.findById(ctx.companyId, id)
  if (antes === undefined) throw AppError.notFound('Fornecedor não encontrado.')

  if (input.document != null && input.document !== antes.document) {
    const existente = await deps.suppliers.findByDocument(ctx.companyId, input.document)
    if (existente !== undefined && existente.id !== id) throw JA_EXISTE(existente.name)
  }

  const { address, ...resto } = input
  const depois = await deps.suppliers.update(ctx.companyId, id, {
    ...resto,
    ...(address === undefined ? {} : { address: enderecoDe(address) }),
  })

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'Supplier',
    entityId: id,
    action: 'updated',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: { name: antes.name, document: antes.document, isActive: antes.isActive },
    after: { ...input },
  })

  return depois
}

/** Exclui do cadastro. A compra antiga continua mostrando de quem foi. */
export async function deleteSupplier(
  deps: SupplierDeps,
  ctx: ExecutionContext,
  id: string,
): Promise<void> {
  assertCanWrite(ctx)

  const f = await deps.suppliers.findById(ctx.companyId, id)
  if (f === undefined) throw AppError.notFound('Fornecedor não encontrado.')

  await deps.suppliers.remove(ctx.companyId, id, ctx.now)

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'Supplier',
    entityId: id,
    action: 'deleted',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: { name: f.name, document: f.document },
    after: null,
  })
}
