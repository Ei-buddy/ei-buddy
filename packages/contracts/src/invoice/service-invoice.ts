import { z } from 'zod'
import { dateSchema, dateTimeSchema, idSchema, moneyCentsSchema } from '../common/primitives.js'
import {
  invoiceRejectionSchema,
  issRatePercentSchema,
  nationalServiceCodeSchema,
  nbsCodeSchema,
} from './invoice.js'

/**
 * NFS-e no padrao nacional — DEC-031, NR-240.
 *
 * Contrato a parte da NFC-e, e nao um campo a mais nela, porque os dois
 * documentos so tem o nome em comum:
 *
 * - **A NFS-e e ASSINCRONA.** O provedor aceita o pedido e responde
 *   "processando"; autorizacao ou rejeicao vem depois, por consulta. Por isso o
 *   resultado tem o estado `processing`, que a NFC-e nao tem.
 * - **Um servico por nota.** A DPS (Declaracao de Prestacao de Servico) leva UM
 *   codigo de tributacao, UMA descricao e UM valor — nao uma lista de itens com
 *   NCM. Quem junta os servicos da venda numa descricao e `core`.
 * - **O municipio importa.** O ISS e municipal: a nota diz onde a loja esta e
 *   onde o servico foi prestado, pelo codigo IBGE de 7 digitos.
 *
 * Valida forma, nunca regra — como o resto de `contracts`.
 */

/** Codigo IBGE do municipio — 7 digitos. */
export const ibgeCityCodeSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((d) => d.length === 7, {
    message: 'Codigo IBGE do municipio invalido. Deve ter 7 digitos.',
  })

/**
 * Situacao da loja no Simples Nacional, como a NFS-e pede (`opSimpNac`).
 *
 * MEI e separado de ME/EPP porque a nota trata os dois de um jeito diferente:
 * o MEI paga ISS fixo no DAS e nao informa aliquota.
 */
export const simplesNacionalOptionSchema = z.enum(['not_optant', 'mei', 'me_epp'], {
  error: 'Situacao no Simples Nacional invalida.',
})
export type SimplesNacionalOption = z.infer<typeof simplesNacionalOptionSchema>

/** CPF ou CNPJ, so digitos. Digito verificador e conferido em `common/document`. */
const documentoSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((d) => d.length === 11 || d.length === 14, {
    message: 'Documento invalido. Informe CPF ou CNPJ.',
  })

/** O que `core` entrega ao adapter para emitir a NFS-e de uma venda. */
export const serviceInvoiceRequestSchema = z
  .object({
    companyId: idSchema,
    /**
     * A venda que originou a nota, e a base da referencia no provedor. A mesma
     * venda nunca gera duas NFS-e — RNF-043. Depois de uma rejeicao, a nota
     * corrigida sai com a MESMA referencia: a Focus aceita o reenvio enquanto a
     * nota nao foi autorizada.
     */
    saleId: idSchema,
    provider: z
      .object({
        cnpj: z
          .string()
          .transform((v) => v.replace(/\D/g, ''))
          .refine((d) => d.length === 14, { message: 'CNPJ da loja invalido.' }),
        municipalRegistration: z.string().trim().min(1).max(15).optional(),
        /** Onde a loja esta: emite e presta o servico no proprio municipio. */
        cityIbgeCode: ibgeCityCodeSchema,
        simplesNacional: simplesNacionalOptionSchema,
      })
      .strict(),
    service: z
      .object({
        nationalServiceCode: nationalServiceCodeSchema,
        nbsCode: nbsCodeSchema.optional(),
        description: z
          .string()
          .trim()
          .min(1, 'Descricao do servico obrigatoria.')
          .max(1000, 'Descricao do servico passa de 1000 caracteres.'),
        /** Valor do servico, antes do desconto. */
        amountCents: moneyCentsSchema.refine((c) => c > 0, {
          message: 'Valor do servico precisa ser maior que zero.',
        }),
        /** Desconto dado na venda (incondicionado). */
        discountCents: moneyCentsSchema.optional(),
        /** Aliquota do ISS da loja. Ausente, o Ambiente Nacional usa a do municipio. */
        issRatePercent: issRatePercentSchema.optional(),
      })
      .strict()
      .refine((s) => (s.discountCents ?? 0) < s.amountCents, {
        message: 'O desconto nao pode ser igual ou maior que o valor do servico.',
        path: ['discountCents'],
      }),
    /** Tomador. Ausente quando o cliente nao se identificou. */
    recipient: z
      .object({
        document: documentoSchema,
        name: z
          .string()
          .trim()
          .min(2, 'Nome muito curto.')
          .max(150, 'Nome muito longo.')
          .optional(),
        email: z.string().trim().email('E-mail do cliente invalido.').max(80).optional(),
      })
      .strict()
      .optional(),
    /** Dia em que o servico foi prestado (competencia do ISS). */
    competenceDate: dateSchema,
    requestedAt: dateTimeSchema,
  })
  .strict()

export type ServiceInvoiceRequest = z.input<typeof serviceInvoiceRequestSchema>

/**
 * Chave de acesso da NFS-e nacional — 50 digitos.
 *
 * Nao e a de 44 da NFC-e: o padrao nacional tem o proprio formato.
 */
export const serviceAccessKeySchema = z
  .string()
  .regex(/^\d{50}$/, 'Chave da NFS-e invalida. Deve ter 50 digitos.')

/**
 * Resultado da emissao ou da consulta.
 *
 * Uniao discriminada, como na NFC-e: rejeicao e resultado, nao excecao, e a
 * venda continua registrada. `processing` e o estado normal logo depois do
 * pedido — nao e erro nem demora anormal.
 */
export const serviceInvoiceResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('processing') }).strict(),
  z
    .object({
      status: z.literal('authorized'),
      /** Numero da NFS-e, dado pelo Ambiente Nacional. */
      number: z.string().min(1),
      accessKey: serviceAccessKeySchema.optional(),
      verificationCode: z.string().min(1).optional(),
      /** O PDF da nota (DANFSe), para mandar ao cliente. */
      danfseUrl: z.string().url('Link do DANFSe invalido.'),
      /** A nota no portal publico da NFS-e. */
      publicUrl: z.string().url().optional(),
      /** Onde o provedor guarda o XML. Guardar por >= 5 anos e de quem persiste. */
      xmlPath: z.string().min(1),
      issuedAt: dateTimeSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('rejected'),
      rejection: invoiceRejectionSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('cancelled'),
      number: z.string().min(1).optional(),
      accessKey: serviceAccessKeySchema.optional(),
    })
    .strict(),
])

export type ServiceInvoiceResult = z.infer<typeof serviceInvoiceResultSchema>

/** Pedido de cancelamento. A justificativa segue o minimo de 15 caracteres da NFC-e. */
export const cancelServiceInvoiceRequestSchema = z
  .object({
    companyId: idSchema,
    saleId: idSchema,
    reason: z
      .string()
      .trim()
      .min(15, 'A justificativa precisa de ao menos 15 caracteres.')
      .max(255, 'A justificativa passa de 255 caracteres.'),
  })
  .strict()

export type CancelServiceInvoiceRequest = z.input<typeof cancelServiceInvoiceRequestSchema>

export const serviceInvoiceCancellationSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('rejected'), rejection: invoiceRejectionSchema }).strict(),
])

export type ServiceInvoiceCancellation = z.infer<typeof serviceInvoiceCancellationSchema>
