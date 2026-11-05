import {
  createSupplierInputSchema,
  listSuppliersQuerySchema,
  updateSupplierInputSchema,
} from '@na-regua/contracts'
import {
  createSupplier,
  deleteSupplier,
  getSupplier,
  listSuppliers,
  type SupplierDeps,
  updateSupplier,
} from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'

/**
 * Cadastro de fornecedor — NR-191, achado do QA.
 *
 * Em `/cadastros/fornecedores`, e nao em `/fornecedores`: esse caminho ja e a
 * busca de fornecedor por proximidade (Conexoes, ADR-0008), outra coisa — la
 * sao outras lojas da plataforma; aqui, o cadastro da propria loja.
 */
export type CadastroDeFornecedoresDeps = SupplierDeps

export function registerCadastroDeFornecedoresRoutes(
  app: FastifyInstance,
  deps: CadastroDeFornecedoresDeps,
): void {
  app.get('/cadastros/fornecedores', async (request, reply) => {
    const ctx = requireContext(request)
    const query = validate(listSuppliersQuerySchema, request.query ?? {})
    return reply.code(200).send({ suppliers: await listSuppliers(deps, ctx, query) })
  })

  app.get('/cadastros/fornecedores/:id', async (request, reply) => {
    const ctx = requireContext(request)
    const { id } = request.params as { id: string }
    return reply.code(200).send(await getSupplier(deps, ctx, id))
  })

  app.post(
    '/cadastros/fornecedores',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const input = validate(createSupplierInputSchema, request.body)
      return reply.code(201).send(await createSupplier(deps, ctx, input))
    },
  )

  app.patch(
    '/cadastros/fornecedores/:id',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }
      const input = validate(updateSupplierInputSchema, request.body)
      return reply.code(200).send(await updateSupplier(deps, ctx, id, input))
    },
  )

  app.delete(
    '/cadastros/fornecedores/:id',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }
      await deleteSupplier(deps, ctx, id)
      return reply.code(204).send()
    },
  )
}
