import { z } from 'zod'
import { dateSchema } from '../common/primitives.js'
import { customerFilterSchema } from '../customer/customer.js'
import { productSituationSchema, stockLevelSchema } from '../product/product.js'

/**
 * Exportar listas em CSV ou PDF — NR-155.
 *
 * Cada exportacao aceita os MESMOS filtros da tela que a origina, sem pagina:
 * o arquivo leva a lista inteira que o lojista esta vendo filtrada, e nao so as
 * 24 linhas da pagina aberta. CSV e o padrao (abre no Excel).
 */
export const formatoDeExportacaoSchema = z.enum(['csv', 'pdf']).default('csv')

export type FormatoDeExportacao = z.infer<typeof formatoDeExportacaoSchema>

/** Teto de linhas por arquivo. Acima disso, filtre — o arquivo diz quando cortou. */
export const LIMITE_DA_EXPORTACAO = 5000

const periodo = <T extends { from?: string | undefined; to?: string | undefined }>(p: T) =>
  p.from === undefined || p.to === undefined || p.from <= p.to

const PERIODO_INVALIDO = {
  message: 'O inicio do periodo nao pode ser depois do fim.',
  path: ['from'],
}

export const exportCustomersInputSchema = z
  .object({
    formato: formatoDeExportacaoSchema,
    q: z.string().trim().max(140).optional(),
    filter: customerFilterSchema.default('todos'),
  })
  .strict()

export const exportProductsInputSchema = z
  .object({
    formato: formatoDeExportacaoSchema,
    q: z.string().trim().max(120).optional(),
    stock: stockLevelSchema.default('todos'),
    situacao: productSituationSchema.default('ativos'),
  })
  .strict()

export const exportSalesInputSchema = z
  .object({
    formato: formatoDeExportacaoSchema,
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    q: z.string().trim().max(120).optional(),
  })
  .strict()
  .refine(periodo, PERIODO_INVALIDO)

/** Relatorios e DRE: o periodo e obrigatorio, como nas telas. */
export const exportPeriodInputSchema = z
  .object({
    formato: formatoDeExportacaoSchema,
    from: dateSchema,
    to: dateSchema,
  })
  .strict()
  .refine(periodo, PERIODO_INVALIDO)

export type ExportCustomersInput = z.infer<typeof exportCustomersInputSchema>
export type ExportProductsInput = z.infer<typeof exportProductsInputSchema>
export type ExportSalesInput = z.infer<typeof exportSalesInputSchema>
export type ExportPeriodInput = z.infer<typeof exportPeriodInputSchema>
