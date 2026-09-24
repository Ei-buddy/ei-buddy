import { z } from 'zod'
import {
  addressOutputSchema,
  addressSchema,
  documentSchema,
  tipoDePessoa,
} from '../common/document.js'
import {
  emailSchema,
  idSchema,
  moneyCentsSchema,
  nameSchema,
  phoneSchema,
} from '../common/primitives.js'

/**
 * Cliente da loja — glossario `Customer`. Nunca `Client`, que fica reservado
 * para cliente HTTP.
 */

/**
 * A regra de PJ, escrita uma vez e aplicada nos dois schemas.
 *
 * `.partial()` do zod recusa um schema que ja tenha `.refine`, entao a
 * alternativa era duplicar o predicado — e predicado duplicado e predicado que
 * diverge. Aqui ele e uma funcao, e cada schema a aplica depois de decidir
 * quais campos sao obrigatorios.
 */
function pjTemFantasia(c: {
  readonly document?: string | undefined
  readonly tradeName?: string | undefined
}): boolean {
  return tipoDePessoa(c.document ?? null) !== 'juridica' || Boolean(c.tradeName?.trim())
}

const EXIGE_FANTASIA = {
  message: 'Informe o nome fantasia do cliente pessoa juridica.',
  path: ['tradeName'],
}

/**
 * Os campos, sem regra composta.
 *
 * Existe separado porque `.partial()` do zod recusa qualquer schema que
 * carregue `.refine` — inclusive indiretamente. Os dois schemas de verdade
 * saem daqui e aplicam a regra DEPOIS de decidir o que e obrigatorio.
 */
const camposDoCliente = z
  .object({
    name: nameSchema,
    /**
     * Documento e telefone sao opcionais de proposito: no balcao a venda
     * acontece antes do cadastro completo, e exigir CPF para vender empurra
     * o lojista de volta para o caderno.
     */
    document: documentSchema.optional(),
    /**
     * Nome fantasia — obrigatorio quando o cliente e PJ (regra logo abaixo).
     *
     * `name` guarda a RAZAO SOCIAL, que e o que sai na nota. O fantasia e como
     * a loja conhece o cliente, e e por ele que o lojista procura no balcao:
     * "a padaria do Ze", nao "ZE SILVA COMERCIO DE ALIMENTOS LTDA".
     */
    tradeName: nameSchema.optional(),
    phone: phoneSchema.optional(),
    email: emailSchema.optional(),
    notes: z.string().trim().max(500, 'Observacao muito longa.').optional(),
    /** Teto do fiado. Ausente = sem fiado liberado. */
    walletLimitCents: moneyCentsSchema.optional(),
    /**
     * O endereco, inteiro opcional — RF-009.
     *
     * Aninhado e nao achatado: os sete campos so fazem sentido juntos, e um
     * `city` sem `state` e um endereco que ninguem acha. Agrupar tambem deixa a
     * ausencia explicita — `address` ausente e "nao informou", em vez de sete
     * campos vazios espalhados pelo corpo.
     */
    address: addressSchema.optional(),
  })
  .strict()

/**
 * Cadastro — RF-009.
 *
 * PJ precisa de nome fantasia.
 *
 * A regra mora no CONTRATO, e nao num CHECK no banco, porque ela depende de
 * saber que o documento e um CNPJ. Essa leitura ja existe em `tipoDePessoa`;
 * reimplementa-la em SQL criaria duas respostas para a mesma pergunta, e a
 * primeira mudanca deixaria uma das duas para tras.
 *
 * Sem documento nao ha PJ conhecida, e a regra nao se aplica: o balcao cadastra
 * com nome e telefone e completa depois (RF-009).
 */
export const createCustomerInputSchema = camposDoCliente.refine(pjTemFantasia, EXIGE_FANTASIA)

export type CreateCustomerInput = z.infer<typeof createCustomerInputSchema>

/**
 * Edicao — os mesmos campos, todos opcionais, e a MESMA regra de PJ.
 *
 * Ela vale aqui pelo payload que chega: quem manda um CNPJ nesta atualizacao
 * precisa mandar o fantasia junto. O que ela NAO alcanca e a atualizacao que
 * so mexe noutro campo de um cliente que ja esta PJ sem fantasia — para isso
 * seria preciso ler o valor guardado, e schema nao le banco. Esse caso nao
 * existe hoje: a regra entrou junto com a coluna, e todo PJ nasce com
 * fantasia.
 */
export const updateCustomerInputSchema = camposDoCliente
  .partial()
  .refine(pjTemFantasia, EXIGE_FANTASIA)
export type UpdateCustomerInput = z.infer<typeof updateCustomerInputSchema>

/** Busca textual de cliente para a consulta conversacional de fiado — NR-115. */
export const checkCustomerWalletInputSchema = z
  .object({
    query: z.string().trim().min(1, 'Informe o cliente que deseja consultar.'),
  })
  .strict()

export type CheckCustomerWalletInput = z.infer<typeof checkCustomerWalletInputSchema>

export const customerOutputSchema = z.object({
  id: idSchema,
  name: z.string(),
  /** Nulo em pessoa fisica, que nao tem fantasia. */
  tradeName: z.string().nullable(),
  document: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  notes: z.string().nullable(),
  walletLimitCents: z.number().int(),
  /** Saldo devedor. Positivo = o cliente deve para a loja. */
  walletBalanceCents: z.number().int(),
  /**
   * O endereco. Tudo anulavel — a RF-009 pede "apenas nome e telefone".
   *
   * Ate a migration 0019 nao havia onde guardar: a tela pedia sete campos, com
   * busca automatica por CEP, e o dado era descartado.
   *
   * Tipo de pessoa e DDD NAO estao aqui de proposito. Sao derivados do
   * documento e do telefone — ver `tipoDePessoa` e `dddDe` em `common/document`.
   */
  address: addressOutputSchema,
  createdAt: z.string(),
  /**
   * Quando os dados pessoais foram removidos a pedido do titular — RF-127.
   *
   * Nulo enquanto nao houve pedido, que e o caso da esmagadora maioria.
   *
   * Sai no output porque a TELA precisa saber: sem isto, a ficha de um cliente
   * ja anonimizado ofereceria "atender pedido de exclusao" de novo, e o clique
   * voltaria 409. Pior que o erro, o lojista poderia achar que o pedido
   * anterior nao foi atendido.
   */
  anonymizedAt: z.string().nullable(),
})

export type CustomerOutput = z.infer<typeof customerOutputSchema>

/**
 * Importacao de clientes em lote — NR-072, US-008.
 *
 * Mesma forma da importacao de produtos, e de proposito: as duas telas usam o
 * mesmo dialogo, e formas diferentes fariam o relatorio significar uma coisa
 * numa e outra na outra.
 *
 * `TETO_DA_IMPORTACAO_DE_CLIENTES` existe pelo mesmo motivo do teto de
 * produtos: o lote roda numa requisicao so.
 */
export const TETO_DA_IMPORTACAO_DE_CLIENTES = 500

export const importCustomersInputSchema = z
  .object({
    customers: z
      .array(createCustomerInputSchema)
      .min(1, 'Nenhuma linha valida para importar.')
      .max(
        TETO_DA_IMPORTACAO_DE_CLIENTES,
        `A importacao aceita ate ${TETO_DA_IMPORTACAO_DE_CLIENTES} linhas por vez.`,
      ),
  })
  .strict()

export type ImportCustomersInput = z.infer<typeof importCustomersInputSchema>

export const importCustomersOutputSchema = z.object({
  imported: z.number().int(),
  rejected: z.array(
    z.object({
      index: z.number().int(),
      description: z.string(),
      reason: z.string(),
    }),
  ),
})

export type ImportCustomersOutput = z.infer<typeof importCustomersOutputSchema>

/**
 * A lista de clientes — NR-072, RF-011.
 *
 * Separada do cadastro (`createCustomerInputSchema`) porque responde outra
 * pergunta: quem sao meus clientes e como cada um se comporta. Por isso ela
 * traz o historico de compra, que o cadastro nao tem.
 */
export const PAGINA_PADRAO_DE_CLIENTES = 24
export const PAGINA_MAXIMA_DE_CLIENTES = 100

/** Quantos dias sem comprar tornam um cliente "inativo" — US-036. */
export const DIAS_PARA_INATIVO = 60

export const customerFilterSchema = z.enum(['todos', 'inativos', 'fiado'])

export type CustomerFilter = z.infer<typeof customerFilterSchema>

export const customerListInputSchema = z
  .object({
    /** Nome, documento ou telefone. */
    q: z.string().trim().max(140).optional(),
    filter: customerFilterSchema.default('todos'),
    page: z.coerce.number().int().min(1, 'A primeira pagina e a 1.').default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(PAGINA_MAXIMA_DE_CLIENTES, `A pagina vai ate ${PAGINA_MAXIMA_DE_CLIENTES} clientes.`)
      .default(PAGINA_PADRAO_DE_CLIENTES),
  })
  .strict()

export type CustomerListInput = z.infer<typeof customerListInputSchema>

/**
 * Um cliente na lista, com o que ele ja comprou.
 *
 * O historico vem JUNTO e nao numa segunda chamada: a tela mostra "ultima
 * compra" em toda linha, e busca-lo por cliente daria vinte e cinco idas ao
 * banco para uma pagina.
 */
export const customerListItemSchema = customerOutputSchema.extend({
  /** Nulo = nunca comprou. NAO e "comprou ha muito tempo". */
  lastSaleOn: z.string().nullable(),
  salesCount: z.number().int(),
  totalSpentCents: z.number().int(),
})

export type CustomerListItem = z.infer<typeof customerListItemSchema>

export const customerListOutputSchema = z.object({
  customers: z.array(customerListItemSchema),
  /** Quantos casam com o filtro — nao quantos vieram nesta pagina. */
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
})

export type CustomerListOutput = z.infer<typeof customerListOutputSchema>
