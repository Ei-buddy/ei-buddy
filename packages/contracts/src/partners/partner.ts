import { z } from 'zod'
import { dateTimeSchema, idSchema } from '../common/primitives.js'

/**
 * Candidatura de conta de Parceiro — NR-115, ADR-0013.
 *
 * O cadastro em si (nome, e-mail, CNPJ...) e o mesmo de qualquer conta —
 * `signupInputSchema` ganha so o campo `account` discriminado. Os schemas
 * daqui cobrem o que e EXCLUSIVO do Parceiro: os campos extras e o fluxo de
 * aprovacao pelo Super Admin.
 */

export const pixKeyTypeSchema = z.enum(['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP'], {
  error: 'Tipo de chave PIX invalido.',
})

export type PixKeyType = z.infer<typeof pixKeyTypeSchema>

/**
 * Os campos extras do cadastro de Parceiro — RF-02 do prompt de conta de
 * parceiro. `couponCode` e opcional aqui: quando ausente, o backend sugere um
 * a partir do nome da empresa (RF-03) — quem preenche pode aceitar a sugestao
 * ou digitar o proprio.
 */
export const partnerAccountFieldsSchema = z
  .object({
    pixKey: z.string().trim().min(1, 'Informe a chave PIX.').max(140),
    pixKeyType: pixKeyTypeSchema,
    message: z
      .string()
      .trim()
      .min(10, 'Conte um pouco mais sobre por que quer ser Parceiro.')
      .max(1000),
    couponCode: z
      .string()
      .trim()
      .min(3, 'O nome do cupom precisa de ao menos 3 caracteres.')
      .max(20, 'O nome do cupom pode ter no maximo 20 caracteres.')
      .regex(/^[a-zA-Z0-9]+$/, 'Use so letras e numeros, sem espaco.')
      .optional(),
  })
  .strict()

export type PartnerAccountFields = z.infer<typeof partnerAccountFieldsSchema>

export const partnerApplicationStatusSchema = z.enum(['pending', 'active', 'rejected'])

export type PartnerApplicationStatus = z.infer<typeof partnerApplicationStatusSchema>

/** O que a propria empresa ve sobre a candidatura dela — self-service. */
export const myPartnerApplicationOutputSchema = z.object({
  partnerId: idSchema,
  status: partnerApplicationStatusSchema,
  pixKey: z.string(),
  pixKeyType: pixKeyTypeSchema,
  message: z.string(),
  reviewNote: z.string().nullable(),
  couponCode: z.string().nullable(),
  createdAt: dateTimeSchema,
  reviewedAt: dateTimeSchema.nullable(),
})

export type MyPartnerApplicationOutput = z.infer<typeof myPartnerApplicationOutputSchema>

/** Uma linha da fila de aprovacao do Super Admin. */
export const pendingPartnerApplicationSchema = z.object({
  partnerId: idSchema,
  companyId: idSchema,
  companyName: z.string(),
  companyPhone: z.string(),
  companyEmail: z.string(),
  pixKey: z.string(),
  pixKeyType: pixKeyTypeSchema,
  message: z.string(),
  couponCode: z.string().nullable(),
  createdAt: dateTimeSchema,
})

export type PendingPartnerApplication = z.infer<typeof pendingPartnerApplicationSchema>

export const reviewPartnerApplicationInputSchema = z
  .object({
    note: z.string().trim().max(500).optional(),
  })
  .strict()

export type ReviewPartnerApplicationInput = z.infer<typeof reviewPartnerApplicationInputSchema>

export const resendPartnerApplicationInputSchema = z
  .object({
    pixKey: z.string().trim().min(1, 'Informe a chave PIX.').max(140),
    pixKeyType: pixKeyTypeSchema,
    message: z
      .string()
      .trim()
      .min(10, 'Conte um pouco mais sobre por que quer ser Parceiro.')
      .max(1000),
  })
  .strict()

export type ResendPartnerApplicationInput = z.infer<typeof resendPartnerApplicationInputSchema>
