import { z } from 'zod'
import { isValidCnpj, isValidCpf, onlyDigits } from '../common/document.js'
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
 * A chave PIX combina com o tipo escolhido?
 *
 * E por esta chave que a comissao do Parceiro e paga. Aceitar "abc" como
 * chave do tipo e-mail era descobrir o erro so no primeiro repasse, com o
 * dinheiro parado. Confere o FORMATO de cada tipo; se a chave esta registrada
 * no DICT e pergunta que so o banco responde, no repasse.
 */
export function pixKeyMatchesType(key: string, type: PixKeyType): boolean {
  const k = key.trim()
  switch (type) {
    case 'CPF':
      return isValidCpf(k)
    case 'CNPJ':
      return isValidCnpj(k)
    case 'EMAIL':
      return z.string().email().safeParse(k).success
    case 'PHONE': {
      /* DDD + numero, com ou sem +55 na frente. */
      const d = onlyDigits(k)
      return (
        d.length === 10 ||
        d.length === 11 ||
        (d.startsWith('55') && d.length >= 12 && d.length <= 13)
      )
    }
    case 'EVP':
      /* Chave aleatoria: UUID gerado pelo banco. */
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)
  }
}

const MENSAGEM_PIX: Record<PixKeyType, string> = {
  CPF: 'Chave PIX invalida: informe um CPF valido.',
  CNPJ: 'Chave PIX invalida: informe um CNPJ valido.',
  EMAIL: 'Chave PIX invalida: informe um e-mail valido.',
  PHONE: 'Chave PIX invalida: informe o telefone com DDD.',
  EVP: 'Chave PIX invalida: a chave aleatoria tem o formato 1234abcd-12ab-34cd-56ef-1234567890ab.',
}

export function pixKeyError(key: string, type: PixKeyType): string | null {
  return pixKeyMatchesType(key, type) ? null : MENSAGEM_PIX[type]
}

/* Refinamento comum ao cadastro e ao reenvio: o erro vai no campo `pixKey`. */
export const pixCombinaComTipo = (
  v: { pixKey: string; pixKeyType: PixKeyType },
  ctx: z.RefinementCtx,
) => {
  const erro = pixKeyError(v.pixKey, v.pixKeyType)
  if (erro !== null) ctx.addIssue({ code: 'custom', path: ['pixKey'], message: erro })
}

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
  .superRefine(pixCombinaComTipo)

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
  .superRefine(pixCombinaComTipo)

export type ResendPartnerApplicationInput = z.infer<typeof resendPartnerApplicationInputSchema>
