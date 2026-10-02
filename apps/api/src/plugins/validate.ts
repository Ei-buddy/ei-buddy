import { AppError, type FieldIssue } from '@na-regua/core'
import type { z } from 'zod'

/**
 * Valida entrada com um schema de `contracts` — RNF-027.
 *
 * Existe para que nenhum handler chame `schema.parse()` direto: o `ZodError`
 * cru traz `code`, `expected`, `received` e o caminho como array, tudo em
 * ingles. Isso e vocabulario de biblioteca, nao mensagem para o lojista
 * (RNF-054). Aqui ele vira `AppError` com a lista de campos que a tela usa
 * para destacar onde esta o problema.
 */
export function validate<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input)
  if (result.success) return result.data as z.infer<S>

  const fields: FieldIssue[] = result.error.issues.map((issue) => ({
    /* Caminho como string: `items.0.quantity` chega pronto para a tela. */
    path: issue.path.join('.'),
    message: mensagemEmPortugues(issue),
  }))

  throw AppError.validation('Confira os campos indicados e tente de novo.', fields)
}

/**
 * As mensagens PADRAO do zod saem em ingles ("Too small: expected number to
 * be >=0", "Unrecognized key") quando o schema nao escreveu a sua — o QA
 * achou varias chegando assim na tela. As mensagens proprias dos schemas
 * passam intactas: so o texto padrao da biblioteca e trocado.
 */
const PADRAO_DO_ZOD = /^(Invalid |Too (small|big)|Unrecognized key)/

function mensagemEmPortugues(issue: z.core.$ZodIssue): string {
  if (!PADRAO_DO_ZOD.test(issue.message)) return issue.message

  switch (issue.code) {
    case 'invalid_type':
      return issue.message.endsWith('received undefined')
        ? 'Campo obrigatorio.'
        : 'Valor em formato invalido.'
    case 'unrecognized_keys':
      return `Campo nao reconhecido: ${issue.keys.join(', ')}.`
    case 'too_small':
      return issue.origin === 'number' || issue.origin === 'int' || issue.origin === 'bigint'
        ? `O valor minimo e ${String(issue.minimum)}.`
        : 'Valor curto demais.'
    case 'too_big':
      return issue.origin === 'number' || issue.origin === 'int' || issue.origin === 'bigint'
        ? `O valor maximo e ${String(issue.maximum)}.`
        : 'Valor longo demais.'
    case 'invalid_value':
      return 'Opcao invalida.'
    default:
      return 'Valor invalido.'
  }
}
