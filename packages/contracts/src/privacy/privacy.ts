import { z } from 'zod'
import { dateTimeSchema, idSchema } from '../common/primitives.js'

/** Exportacao completa e anonimizacao — RF-125, RF-127, RF-128. */

/**
 * As colecoes que a exportacao cobre.
 *
 * Lista fechada, e nao "tudo que houver no banco". Duas razoes: o titular tem
 * direito aos dados DELE, e uma exportacao que despejasse tabela de controle
 * interno entregaria mais do que ele pediu e menos do que ele entende; e uma
 * lista fechada e verificavel — da para afirmar num teste que nenhuma colecao
 * de negocio ficou de fora, o que "tudo" nao permite.
 *
 * Quando uma tabela de negocio nova nascer, ela entra aqui. O teste que compara
 * esta lista com o que o repositorio sabe ler e o que impede o esquecimento.
 */
export const exportCollectionSchema = z.enum([
  'company',
  'users',
  'customers',
  'products',
  'categories',
  'sales',
  'sale_items',
  'payments',
  'receivables',
  'payables',
  'settlements',
  'inventory_movements',
  'appointments',
  'ledger_accounts',
  'bank_transactions',
  'audit_logs',
  /*
   * Estas cinco entraram na NR-086, ao escrever o repositorio que le tudo.
   *
   * A lista de cima tinha dezesseis nomes e parecia completa; `invoices` nao
   * estava nela. Uma exportacao de portabilidade sem os DOCUMENTOS FISCAIS
   * entrega um pacote que parece completo e nao tem justamente o que o lojista
   * e obrigado a guardar por cinco anos — e ninguem descobriria pelo uso.
   *
   * `confereQueNadaFicouDeFora` nao pega isso: ele compara o repositorio com
   * esta lista, e uma tabela ausente das DUAS passa. Quem pega e o teste em
   * `packages/db/src/privacidade.test.ts`, que compara esta lista com as
   * tabelas de negocio que existem no banco.
   */
  'invoices',
  'sale_returns',
  'sale_return_items',
  'support_tickets',
  'ticket_messages',
  /*
   * Cobranca a distancia (NR-044). Quanto foi cobrado do cliente, quando e por
   * qual link — e quais titulos aquela cobranca cobriu. Deixar de fora faria a
   * portabilidade entregar os recebiveis sem as cobrancas que os acompanharam,
   * que e metade da conversa entre loja e cliente.
   */
  'customer_charges',
  'customer_charge_receivables',
])

export type ExportCollection = z.infer<typeof exportCollectionSchema>

/**
 * O manifesto do pacote exportado.
 *
 * Vai junto com os dados porque um arquivo de dados sem manifesto nao e
 * portavel de verdade (RNF-050): quem recebe precisa saber o que esperava vir,
 * para conseguir dizer se o pacote esta completo. `rows` por colecao e o que
 * transforma "recebi um zip" em "recebi 1.482 vendas".
 */
export const exportManifestSchema = z.object({
  companyId: idSchema,
  generatedAt: dateTimeSchema,
  /**
   * Versao do formato, nao do sistema.
   *
   * Quem escreveu um importador contra o pacote de hoje precisa saber que o de
   * amanha mudou de forma. Amarrar na versao do produto faria o importador
   * quebrar a cada release que nao muda nada do formato.
   */
  formatVersion: z.literal(1),
  collections: z.array(
    z.object({
      name: exportCollectionSchema,
      rows: z.number().int().nonnegative(),
      /** Nome do arquivo dentro do pacote. */
      file: z.string(),
    }),
  ),
})

export type ExportManifest = z.infer<typeof exportManifestSchema>

/** Pedido de exclusao de dados pessoais — RF-127. */
export const anonymizeCustomerInputSchema = z
  .object({
    customerId: idSchema,
    /**
     * Por que, em texto livre.
     *
     * Obrigatorio porque o pedido do titular e o fundamento legal da operacao,
     * e a anonimizacao e IRREVERSIVEL. Sem o motivo registrado, sobra uma
     * pessoa apagada da base sem nada que explique por quem foi pedido — e e
     * exatamente isso que a fiscalizacao pergunta depois.
     */
    reason: z.string().trim().min(10, 'Descreva o pedido de exclusao.').max(500),
  })
  .strict()

export type AnonymizeCustomerInput = z.infer<typeof anonymizeCustomerInputSchema>

/**
 * O comprovante da anonimizacao.
 *
 * Existe para o lojista poder responder ao titular — e, se preciso, a ANPD —
 * dizendo o que foi apagado e o que foi mantido, com o motivo de cada um. Um
 * "ok" nao serve: o titular pediu exclusao e recebeu anonimizacao, e a
 * diferenca precisa estar escrita.
 */
export const anonymizationReceiptSchema = z.object({
  customerId: idSchema,
  anonymizedAt: dateTimeSchema,
  anonymizedBy: idSchema,
  /** Campos pessoais substituidos. */
  scrubbedFields: z.array(z.string()),
  /**
   * O que ficou, e por que — RF-127, RF-128.
   *
   * Nao e detalhe de implementacao: e a resposta ao titular. "Suas 14 compras
   * foram mantidas sem seus dados pessoais, porque a lei fiscal obriga a
   * guardar a venda por cinco anos" e uma frase que alguem precisa poder dizer.
   */
  preserved: z.array(
    z.object({
      what: z.string(),
      rows: z.number().int().nonnegative(),
      because: z.string(),
    }),
  ),
  /** O que foi apagado de verdade, porque nao havia obrigacao de retencao. */
  deleted: z.array(z.object({ what: z.string(), rows: z.number().int().nonnegative() })),
})

export type AnonymizationReceipt = z.infer<typeof anonymizationReceiptSchema>
