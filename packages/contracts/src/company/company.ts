import { z } from 'zod'
import { addressOutputSchema, addressSchema, cnpjSchema } from '../common/document.js'
import { emailSchema, idSchema, nameSchema, phoneSchema, roleSchema } from '../common/primitives.js'
import { issRatePercentSchema, nationalServiceCodeSchema } from '../invoice/invoice.js'

/**
 * Empresa (o tenant) e seus usuarios — glossario `Company` e `User`.
 *
 * `.strict()` em toda entrada: chave desconhecida vira erro em vez de ser
 * descartada em silencio. E o que faz o principio 8 valer na pratica — um
 * `companyId` enfiado no corpo e recusado alto, nao ignorado.
 */

/**
 * Inscricao estadual — RF-046.
 *
 * SEM formato validado, e nao por descuido: cada estado tem o seu. Sao Paulo
 * usa doze digitos com dois verificadores, o Parana usa dez, a Bahia aceita
 * oito e nove — e "ISENTO" e um valor legitimo em varios. Um formato so
 * recusaria empresa de verdade; aceitar todos nao validaria nada. A conferencia
 * por UF entra com a emissao, onde ha a quem perguntar.
 */
export const stateRegistrationSchema = z
  .string()
  .trim()
  .min(2, 'Inscricao estadual muito curta.')
  .max(20, 'Inscricao estadual muito longa.')

export const municipalRegistrationSchema = z
  .string()
  .trim()
  .min(2, 'Inscricao municipal muito curta.')
  .max(20, 'Inscricao municipal muito longa.')

/**
 * Ramo de atividade — RF-003.
 *
 * Texto corrente, e NAO o CNAE. A tela oferece uma lista de segmentos em
 * portugues — "Mercearia e minimercado", "Pet shop", "Oficina e autopecas" —,
 * que e o que o lojista sabe responder.
 *
 * CNAE e outra coisa: sete digitos, definidos pelo contador, e e ele que decide
 * codigo de servico na NFS-e. Modelar o segmento como CNAE criaria um campo que
 * a tela nunca consegue preencher direito, e no dia da primeira NFS-e alguem
 * leria "Pet shop" onde esperava um codigo. O CNAE entra quando houver quem o
 * informe.
 */
export const businessSegmentSchema = z
  .string()
  .trim()
  .min(2, 'Ramo de atividade muito curto.')
  .max(80, 'Ramo de atividade muito longo.')

export const createCompanyInputSchema = z
  .object({
    /** Razao social, como consta no CNPJ. */
    legalName: nameSchema,
    /** Nome de fachada. Ausente = usa a razao social. */
    tradeName: nameSchema.optional(),
    cnpj: cnpjSchema,
    email: emailSchema,
    phone: phoneSchema,
    /**
     * Os fiscais, todos opcionais — RF-001.
     *
     * MEI nao tem inscricao estadual; loja que so vende produto nao tem
     * municipal. Exigi-los aqui quebraria o cadastro de conta, que e a
     * primeira coisa que o lojista faz. Quem cobra e a EMISSAO, no momento em
     * que fazem falta, com a mensagem certa.
     */
    stateRegistration: stateRegistrationSchema.optional(),
    municipalRegistration: municipalRegistrationSchema.optional(),
    businessSegment: businessSegmentSchema.optional(),
    /**
     * Os da NFS-e — DEC-031. Opcionais pela mesma razao dos fiscais acima:
     * loja que so vende mercadoria nunca os preenche. A emissao da NFS-e e
     * quem cobra, na hora.
     */
    nationalServiceCode: nationalServiceCodeSchema.optional(),
    issRatePercent: issRatePercentSchema.optional(),
    address: addressSchema.optional(),
  })
  .strict()

export type CreateCompanyInput = z.infer<typeof createCompanyInputSchema>

/** Atualizacao e parcial, menos o CNPJ: trocar CNPJ e outra empresa. */
export const updateCompanyInputSchema = createCompanyInputSchema
  .omit({ cnpj: true })
  .partial()
  .strict()

export type UpdateCompanyInput = z.infer<typeof updateCompanyInputSchema>

export const companyOutputSchema = z.object({
  id: idSchema,
  legalName: z.string(),
  tradeName: z.string(),
  cnpj: z.string(),
  email: z.string(),
  phone: z.string(),
  /**
   * O endereco da loja — RF-003.
   *
   * Anulavel: ele chega pela busca de CNPJ e pode faltar. Exigir aqui travaria
   * o cadastro de quem instala o sistema antes de ter a inscricao pronta.
   */
  address: addressOutputSchema,
  /**
   * Os fiscais. Nulos ate serem informados — nem toda loja tem os tres.
   *
   * Ate a migration 0021 nao havia onde guardar: a tela pedia os tres e eles
   * eram descartados. Nao era so perda de cadastro — os tres entram na NOTA,
   * e a emissao ia falhar na primeira nota de verdade.
   */
  stateRegistration: z.string().nullable(),
  municipalRegistration: z.string().nullable(),
  businessSegment: z.string().nullable(),
  /** Codigo de Tributacao Nacional da NFS-e (6 digitos) — DEC-031. */
  nationalServiceCode: z.string().nullable(),
  /** Aliquota do ISS em pontos percentuais — DEC-031. */
  issRatePercent: z.number().nullable(),
  createdAt: z.string(),
})

export type CompanyOutput = z.infer<typeof companyOutputSchema>

export const createUserInputSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    role: roleSchema,
  })
  .strict()

export type CreateUserInput = z.infer<typeof createUserInputSchema>

export const userOutputSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.string(),
  role: roleSchema,
})

export type UserOutput = z.infer<typeof userOutputSchema>
