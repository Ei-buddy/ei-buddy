import { z } from 'zod'
import { idSchema } from '../common/primitives.js'

/** Movimentacao de estoque — glossario `InventoryMovement`. RF-022 a RF-024. */

/**
 * Por que o saldo muda. Um valor por CAUSA, nao por sinal.
 *
 * Separar `sale` de `adjustment` e o que permite responder "quanto sumiu por
 * divergencia de inventario este mes?" sem cruzar com venda. Um enum de
 * `entrada`/`saida` responderia o quanto e nunca o porque, e e o porque que faz
 * alguem agir.
 */
export const movementKindSchema = z.enum([
  /** Ajuste manual, contado na prateleira — RF-023. */
  'adjustment',
  /** Baixa ao fechar a venda — RF-024. */
  'sale',
  /** Saldo devolvido quando a venda e cancelada — RF-024. */
  'sale_cancelled',
  /** Saldo devolvido em devolucao total ou parcial — RF-024. */
  'sale_returned',
])

export type MovementKind = z.infer<typeof movementKindSchema>

/**
 * Ajuste de inventario — RF-023.
 *
 * A entrada e o saldo CONTADO, nao a diferenca. O lojista conta a prateleira e
 * digita o que viu; quem calcula a diferenca e o sistema. Pedir a diferenca
 * seria pedir que ele fizesse a subtracao de cabeca contra um numero que ele
 * desconfia — e o ajuste existe justamente porque aquele numero esta errado.
 */
export const adjustStockInputSchema = z
  .object({
    productId: idSchema,
    /** Quantas unidades existem de fato, agora, na prateleira. */
    countedQuantity: z
      .number()
      .int('A contagem deve ser um numero inteiro de unidades.')
      .min(0, 'A contagem nao pode ser negativa.')
      .max(1_000_000, 'Contagem alta demais. Confira o numero.'),
    /**
     * Obrigatorio, e nao opcional: RF-023 pede motivo. Ajuste sem motivo vira
     * um numero que mudou sozinho, e daqui a tres meses ninguem reconstroi por
     * que o saldo caiu — que e exatamente o que a trilha existe para responder.
     */
    reason: z.string().trim().min(3, 'Diga o motivo do ajuste.').max(280, 'Motivo muito longo.'),
  })
  .strict()

export type AdjustStockInput = z.infer<typeof adjustStockInputSchema>

/** Consulta de estoque de um produto — RF-022. */
export const checkStockInputSchema = z.object({ productId: idSchema }).strict()

export type CheckStockInput = z.infer<typeof checkStockInputSchema>

/** Busca textual de produto para a consulta conversacional de estoque — NR-115. */
export const checkStockByQueryInputSchema = z
  .object({
    query: z.string().trim().min(1, 'Informe o produto que deseja consultar.'),
  })
  .strict()

export type CheckStockByQueryInput = z.infer<typeof checkStockByQueryInputSchema>

/** Consulta conversacional de contas a pagar — sem argumento controlado pelo usuário. */
export const listPayablesInputSchema = z.object({}).strict()

export type ListPayablesInput = z.infer<typeof listPayablesInputSchema>

export const inventoryMovementOutputSchema = z.object({
  id: idSchema,
  productId: idSchema,
  kind: movementKindSchema,
  /** Assinado: negativo tira do saldo, positivo devolve. */
  quantityDelta: z.number().int(),
  /** Saldo depois deste movimento — dispensa refazer a soma para conferir. */
  balanceAfter: z.number().int(),
  reason: z.string().nullable(),
  /** Preenchido quando a causa e uma venda, para a trilha fechar com ela. */
  saleId: idSchema.nullable(),
  /**
   * Sempre presente, e sem FK para `users` — a mesma regra da `audit_log`.
   *
   * Guardar o id de quem fez, sem referencia viva, e o que permite a pessoa
   * sair da empresa sem que o movimento dela deixe de valer (US-061).
   *
   * A migration 0016 alinhou a coluna a esta promessa. Antes ela era anulavel
   * com `ON DELETE SET NULL`, o que numa trilha somente-insercao nao funciona:
   * `SET NULL` e um UPDATE, o gatilho de imutabilidade o recusa, e apagar um
   * usuario que ja mexeu no estoque falhava com uma mensagem que nao apontava
   * para nada.
   */
  createdBy: idSchema,
  createdAt: z.string(),
})

export type InventoryMovementOutput = z.infer<typeof inventoryMovementOutputSchema>

/**
 * O que a consulta de estoque devolve — RF-022.
 *
 * `stockQuantity` e `location` sao anulaveis por motivos DIFERENTES, e a
 * diferenca importa:
 *
 * - `stockQuantity: null` significa **produto sem controle de estoque**, que
 *   nao e saldo zero. Zero e "acabou"; nulo e "nao se conta este". Responder
 *   zero para um produto a granel faria o balconista dizer ao cliente que nao
 *   tem, com a caixa cheia atras dele.
 * - `location: null` significa que ninguem cadastrou a localizacao ainda.
 */
export const stockViewOutputSchema = z.object({
  productId: idSchema,
  description: z.string(),
  salePriceCents: z.number().int(),
  stockQuantity: z.number().int().nullable(),
  location: z.string().nullable(),
  minStock: z.number().int().nullable(),
  /** Abaixo do minimo definido — RF-025 usa isto para a lista de reposicao. */
  belowMinimum: z.boolean(),
})

export type StockViewOutput = z.infer<typeof stockViewOutputSchema>
