import { z } from 'zod'
import {
  dateTimeSchema,
  idSchema,
  moneyCentsSchema,
  unitOfMeasureSchema,
} from '../common/primitives.js'
import { paymentMethodSchema } from '../sale/sale.js'

/**
 * Nota fiscal — glossario `Invoice`. RF-045 a RF-054.
 *
 * Estes schemas sao o contrato entre `core` e o adapter `fiscal`. Ficam aqui, e
 * nao em `core`, por um motivo estrutural: a regra `adapter-nao-importa-core`
 * proibe `fiscal` de conhecer `core`, entao os dois lados precisam de um
 * vocabulario comum que nenhum dos dois possua. E o que `contracts` e.
 *
 * Valida forma, nunca regra: "o NCM tem 8 digitos" e aqui; "esta nota ainda
 * esta no prazo legal de cancelamento" e `core`.
 */

/**
 * NCM — 8 digitos, a classificacao da mercadoria.
 *
 * Valida so o formato. Se o 8 digitos existe na tabela vigente e pergunta para
 * a SEFAZ, nao para um regex: a tabela muda por ato normativo e uma copia dela
 * aqui envelheceria em silencio.
 */
export const ncmSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((d) => d.length === 8, { message: 'NCM invalido. Deve ter 8 digitos.' })

/** CFOP — 4 digitos, a natureza da operacao. */
export const cfopSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((d) => d.length === 4, { message: 'CFOP invalido. Deve ter 4 digitos.' })

/**
 * CST ou CSOSN — 2 ou 3 digitos.
 *
 * Sao dois codigos diferentes no mesmo campo: quem esta no Simples Nacional
 * usa CSOSN (3 digitos, `101`, `102`, `500`), quem esta no regime normal usa
 * CST (2 digitos, `00`, `40`, `60`). Qual dos dois vale depende do regime da
 * empresa — e isso e regra, entao mora em `core`, nao aqui.
 */
export const taxSituationCodeSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((d) => d.length === 2 || d.length === 3, {
    message: 'CST/CSOSN invalido. Deve ter 2 digitos (CST) ou 3 (CSOSN).',
  })

/**
 * CSOSN — 3 digitos. O unico aceito no CADASTRO de produto.
 *
 * O produto so atende empresa do Simples Nacional e MEI, e as duas usam CSOSN.
 * Aceitar CST de dois digitos no cadastro era deixar entrar um codigo que a
 * SEFAZ recusaria na primeira nota. A nota em si segue aceitando os dois
 * (`taxSituationCodeSchema`): produto antigo com CST gravado precisa ao menos
 * chegar a emissao, que diz qual item corrigir.
 */
export const csosnSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((d) => d.length === 3, {
    message: 'CSOSN invalido. Deve ter 3 digitos, por exemplo 102.',
  })

/**
 * Chave de acesso — os 44 digitos que identificam a nota — RF-045.
 *
 * E o que o lojista informa ao contador e o que o cliente usa para consultar a
 * nota no portal da SEFAZ. Sem ela a nota existe para a SEFAZ e nao existe
 * para ninguem mais, e por isso ela e obrigatoria no resultado autorizado.
 */
export const accessKeySchema = z
  .string()
  .regex(/^\d{44}$/, 'Chave de acesso invalida. Deve ter 44 digitos.')

/** Estado fiscal da venda, explicito — RF-054. */
export const invoiceStatusSchema = z.enum(['authorized', 'contingency', 'rejected', 'cancelled'], {
  error: 'Estado fiscal invalido.',
})
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>

/** Item da nota, com a classificacao fiscal que a SEFAZ exige — RF-046. */
export const invoiceItemSchema = z
  .object({
    productId: idSchema,
    description: z.string().trim().min(1, 'Descricao obrigatoria.').max(120, 'Descricao longa.'),
    quantity: z.number().int('Quantidade precisa ser inteira.').positive('Quantidade minima e 1.'),
    unitPriceCents: moneyCentsSchema,
    unitOfMeasure: unitOfMeasureSchema,
    ncm: ncmSchema,
    cfop: cfopSchema,
    taxSituationCode: taxSituationCodeSchema,
  })
  .strict()

export type InvoiceItem = z.infer<typeof invoiceItemSchema>

/**
 * Destinatario. Opcional inteiro: NFC-e de balcao sai sem identificacao, que e
 * a maioria das vendas ("CPF na nota?" costuma ser nao).
 */
export const invoiceRecipientSchema = z
  .object({
    name: z.string().trim().min(2, 'Nome muito curto.').max(120, 'Nome muito longo.').optional(),
    /** CPF ou CNPJ, so digitos. Validacao de digito verificador esta em `common/document`. */
    document: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .refine((d) => d.length === 11 || d.length === 14, {
        message: 'Documento invalido. Informe CPF ou CNPJ.',
      })
      .optional(),
  })
  .strict()

export type InvoiceRecipient = z.infer<typeof invoiceRecipientSchema>

/** O que `core` entrega ao adapter para emitir — RF-045. */
export const issueInvoiceRequestSchema = z
  .object({
    companyId: idSchema,
    /**
     * A venda que originou a nota. E tambem a chave de idempotencia da
     * emissao: a mesma venda nunca gera duas notas, por mais vezes que o job
     * seja reprocessado. Nota duplicada e problema fiscal, nao inconveniencia
     * — RNF-043.
     */
    saleId: idSchema,
    series: z.number().int().min(1, 'Serie invalida.').max(999, 'Serie invalida.'),
    items: z
      .array(invoiceItemSchema)
      .min(1, 'A nota precisa de ao menos um item.')
      .max(200, 'Nota com itens demais. Divida em duas.'),
    payments: z
      .array(z.object({ method: paymentMethodSchema, amountCents: moneyCentsSchema }).strict())
      .min(1, 'Informe ao menos uma forma de pagamento.'),
    recipient: invoiceRecipientSchema.optional(),
    requestedAt: dateTimeSchema,
  })
  .strict()

export type IssueInvoiceRequest = z.infer<typeof issueInvoiceRequestSchema>

/**
 * Rejeicao da SEFAZ — RF-047.
 *
 * Dois campos porque servem a duas pessoas: `code` e o codigo cru, que o
 * contador e o suporte precisam para procurar na documentacao; `message` e o
 * que aparece na tela, em portugues, dizendo o que fazer. Mostrar "Rejeicao
 * 539" ao lojista nao ajuda ninguem.
 */
export const invoiceRejectionSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict()

export type InvoiceRejection = z.infer<typeof invoiceRejectionSchema>

/**
 * Rejeicoes que o proprio adapter produz, sem transmitir nada.
 *
 * Ficam no contrato, e nao dentro de `fiscal`, porque `core` precisa
 * distinguir uma delas de uma rejeicao vinda da SEFAZ: a primeira e erro de
 * dado nosso, a segunda e resposta do fisco. Sem um vocabulario combinado,
 * `core` compararia string solta com o codigo de um adapter especifico — e a
 * troca de provedor quebraria a regra em silencio.
 */
export const LOCAL_REJECTION_CODES = {
  /** Faltou ou veio errado um dado fiscal obrigatorio — RF-046. */
  validation: 'LOCAL-VALIDACAO',
  /** Chave desconhecida, ou de outra empresa. Nunca "proibido" — RF-122. */
  notFound: 'LOCAL-NOTA-NAO-ENCONTRADA',
} as const

export type LocalRejectionCode = (typeof LOCAL_REJECTION_CODES)[keyof typeof LOCAL_REJECTION_CODES]

/**
 * Resultado da emissao.
 *
 * Uniao discriminada, e nao objeto com campos nulos, de proposito: rejeicao e
 * contingencia sao RESULTADOS, nao excecoes. Se fossem excecoes, o `catch` mais
 * proximo poderia desfazer a transacao da venda — e RF-047 e RF-052 dizem
 * exatamente o contrario, que a venda permanece registrada. O tipo obriga quem
 * chama a decidir o que fazer nos tres casos.
 *
 * Excecao no adapter fica reservada ao que e falha de infraestrutura de
 * verdade: token invalido, certificado vencido, resposta ilegivel.
 */
export const invoiceIssueResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('authorized'),
      accessKey: accessKeySchema,
      number: z.number().int().positive(),
      series: z.number().int().positive(),
      /** Link do DANFE, para enviar ao cliente — RF-048, RF-049. */
      danfeUrl: z.string().url('Link do DANFE invalido.'),
      /** XML autorizado. Guardar por >= 5 anos e de quem persiste — RNF-037. */
      xml: z.string().min(1),
      issuedAt: dateTimeSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('contingency'),
      accessKey: accessKeySchema,
      number: z.number().int().positive(),
      series: z.number().int().positive(),
      xml: z.string().min(1),
      issuedAt: dateTimeSchema,
      /** Por que caiu em contingencia, para a tela explicar — RF-054. */
      reason: z.string().min(1),
    })
    .strict(),
  z
    .object({
      status: z.literal('rejected'),
      rejection: invoiceRejectionSchema,
    })
    .strict(),
])

export type InvoiceIssueResult = z.infer<typeof invoiceIssueResultSchema>

/**
 * Cancelamento — RF-050.
 *
 * `reason` tem minimo de 15 caracteres porque a SEFAZ exige justificativa de 15
 * a 255 caracteres. Recusar aqui, na entrada, e melhor que descobrir na
 * rejeicao: a mensagem fica em portugues e o lojista corrige antes de gastar
 * uma transmissao.
 *
 * O PRAZO legal de cancelamento nao e verificado aqui — e regra, e mora em
 * `core` (RF-051).
 */
export const cancelInvoiceRequestSchema = z
  .object({
    companyId: idSchema,
    accessKey: accessKeySchema,
    reason: z
      .string()
      .trim()
      .min(15, 'A justificativa precisa de ao menos 15 caracteres.')
      .max(255, 'A justificativa passa de 255 caracteres.'),
    requestedAt: dateTimeSchema,
  })
  .strict()

export type CancelInvoiceRequest = z.infer<typeof cancelInvoiceRequestSchema>

export const invoiceCancellationSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('cancelled'),
      accessKey: accessKeySchema,
      /** Protocolo do evento de cancelamento, a prova de que ele ocorreu. */
      protocol: z.string().min(1),
      xml: z.string().min(1),
      cancelledAt: dateTimeSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('rejected'),
      rejection: invoiceRejectionSchema,
    })
    .strict(),
])

export type InvoiceCancellation = z.infer<typeof invoiceCancellationSchema>
