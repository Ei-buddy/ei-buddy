import { z } from 'zod'
import { addressSchema, documentSchema } from '../common/document.js'
import { emailSchema, idSchema, phoneSchema } from '../common/primitives.js'

/**
 * Cadastro de fornecedor — NR-191, achado do QA ("cadastro de fornecedor,
 * poder cadastrar por completo").
 *
 * So o nome e obrigatorio: o fornecedor costuma ser cadastrado na hora da
 * compra, com o que esta na nota. O resto completa depois — e nada aqui
 * trava a entrada de mercadoria.
 */
const camposDoFornecedor = z
  .object({
    /** Razao social, ou o nome da pessoa fisica. */
    name: z.string().trim().min(2, 'Informe o nome do fornecedor.').max(160, 'Nome muito longo.'),
    tradeName: z.string().trim().max(160, 'Nome fantasia muito longo.').optional(),
    /** CPF ou CNPJ, com o digito conferido. */
    document: documentSchema.optional(),
    stateRegistration: z.string().trim().max(30, 'Inscrição estadual muito longa.').optional(),
    email: emailSchema.optional(),
    /** Fixo ou celular, com DDD. */
    phone: phoneSchema.optional(),
    contactName: z.string().trim().max(120, 'Nome do contato muito longo.').optional(),
    address: addressSchema.optional(),
    notes: z.string().trim().max(500, 'Observação muito longa.').optional(),
  })
  .strict()

export const createSupplierInputSchema = camposDoFornecedor

export type CreateSupplierInput = z.infer<typeof createSupplierInputSchema>

/**
 * Edicao — tudo opcional, e `null` apaga o campo opcional. Ausente quer dizer
 * "nao mexe".
 */
export const updateSupplierInputSchema = z
  .object({
    name: camposDoFornecedor.shape.name.optional(),
    tradeName: camposDoFornecedor.shape.tradeName.unwrap().nullable().optional(),
    document: documentSchema.nullable().optional(),
    stateRegistration: camposDoFornecedor.shape.stateRegistration.unwrap().nullable().optional(),
    email: emailSchema.nullable().optional(),
    phone: phoneSchema.nullable().optional(),
    contactName: camposDoFornecedor.shape.contactName.unwrap().nullable().optional(),
    address: addressSchema.optional(),
    notes: camposDoFornecedor.shape.notes.unwrap().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((o) => Object.values(o).some((v) => v !== undefined), {
    message: 'Informe o que corrigir.',
  })

export type UpdateSupplierInput = z.infer<typeof updateSupplierInputSchema>

export const listSuppliersQuerySchema = z
  .object({
    /** Nome, fantasia, CNPJ ou telefone — a mesma busca do cliente. */
    q: z.string().trim().max(120).optional(),
    /** `false` traz tambem os inativos. */
    somenteAtivos: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .strict()

export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>

export const supplierOutputSchema = z.object({
  id: idSchema,
  name: z.string(),
  tradeName: z.string().nullable(),
  document: z.string().nullable(),
  stateRegistration: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  contactName: z.string().nullable(),
  address: z.object({
    zipCode: z.string().nullable(),
    street: z.string().nullable(),
    number: z.string().nullable(),
    complement: z.string().nullable(),
    district: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
  }),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
})

export type SupplierOutput = z.infer<typeof supplierOutputSchema>
