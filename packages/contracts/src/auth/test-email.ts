import { z } from 'zod'
import { emailSchema } from '../common/primitives.js'

/** Envio de teste de e-mail pelo Super Admin — achado do QA. */
export const testEmailInputSchema = z.object({ to: emailSchema }).strict()

export type TestEmailInput = z.infer<typeof testEmailInputSchema>

export const testEmailOutputSchema = z.object({
  /** `log` = o servidor nao manda e-mail nenhum, so escreve no log. */
  mode: z.enum(['smtp', 'log']),
  sent: z.boolean(),
  /** Por que nao saiu, nas palavras do servidor de e-mail (ou da configuracao). */
  reason: z.string().nullable(),
})

export type TestEmailOutput = z.infer<typeof testEmailOutputSchema>
