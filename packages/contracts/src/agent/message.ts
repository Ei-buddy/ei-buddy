import { z } from 'zod'

/**
 * Mensagem ao assistente — RF-096.
 *
 * O canal HTTP existe para exercitar o runtime sem WhatsApp (NR-060). O
 * webhook entra depois, atras da mesma `processMessage`. O texto e o mesmo
 * campo nos dois caminhos, para nao nascer um schema paralelo.
 */

const agentImageMimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp'])

const agentImageInputSchema = z
  .object({
    mimeType: agentImageMimeTypeSchema,
    dataBase64: z
      .string()
      .max(512_000, 'Imagem grande demais.')
      .refine((valor) => !valor.startsWith('data:'), 'Base64 deve vir sem prefixo data:.'),
  })
  .strict()

export const agentMessageInputSchema = z
  .object({
    text: z.string().trim().max(4000, 'Mensagem longa demais. Resuma e envie de novo.').optional(),
    image: agentImageInputSchema.optional(),
  })
  .strict()
  .superRefine((valor, ctx) => {
    const temTexto = valor.text !== undefined && valor.text.length > 0
    const temImagem = valor.image !== undefined
    if (!temTexto && !temImagem) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A mensagem nao pode ser vazia.',
      })
    }
  })

export type AgentMessageInput = z.infer<typeof agentMessageInputSchema>

export const agentReplyKindSchema = z.enum([
  'answer',
  'clarify',
  'unknown',
  'confirmation',
  'ignored',
])

export type AgentReplyKind = z.infer<typeof agentReplyKindSchema>

export const agentReplySchema = z
  .object({
    kind: agentReplyKindSchema,
    text: z.string(),
    confirmationId: z.string().optional(),
  })
  .strict()

export type AgentReply = z.infer<typeof agentReplySchema>
