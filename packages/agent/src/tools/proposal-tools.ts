import { createTool } from '@mastra/core/tools'
import {
  adjustStockInputSchema,
  cancelSaleInputSchema,
  createAppointmentInputSchema,
  createCustomerInputSchema,
  createPayableInputSchema,
  createProductInputSchema,
  createReceivableInputSchema,
  createSaleInputSchema,
  idSchema,
  paymentMethodSchema,
  sendChargeInputSchema,
  settlePayableInputSchema,
  settleReceivableInputSchema,
  updateCustomerInputSchema,
  updateProductInputSchema,
  type CreateSaleInput,
  type PaymentMethod,
} from '@na-regua/contracts'
import { isAppError, type ConfirmationStore, type ExecutionContext } from '@na-regua/core'
import { Money } from '@na-regua/money'
import { z } from 'zod'
import type { AgentUseCases } from '../catalog.js'
import { novaConfirmacao } from '../confirmations.js'
import type { EntidadeDaConversa, IntencaoEmAndamento } from '../conversation-context.js'
import { pagamento, reais, type Recusado } from '../views.js'
import { emErroHumano, semNulos, turnoDe, type EstadoDoTurno } from './shared.js'

/**
 * Tools de gravação — PROPÕEM, não gravam (FR-012).
 *
 * Cada uma valida com o schema de `contracts`, resolve cliente e produto, e
 * grava uma `PendingConfirmation` com os dados exatos que serão gravados
 * (FR-013). O modelo recebe os fatos humanizados e redige a confirmação. A
 * gravação acontece só em `accept_proposal`, pelo `executar` daqui.
 */

/** O que fica guardado na confirmação: a entrada validada e os nomes legíveis. */
export type ArgsGuardados = {
  readonly entrada: unknown
  readonly rotulos: Readonly<Record<string, string>>
}

export type ResultadoDaExecucao = {
  readonly status: 'gravado' | 'parecido'
  readonly fatos: readonly string[]
  readonly entidades?: readonly EntidadeDaConversa[]
  readonly opcoes?: readonly {
    readonly ref: string
    readonly rotulo: string
    readonly detalhe?: string
  }[]
}

type Pronto = {
  readonly status: 'pronto'
  readonly guardado: ArgsGuardados
  readonly fatos: readonly string[]
  readonly assumido?: readonly string[]
  readonly entidades?: readonly EntidadeDaConversa[]
  /** Pedido que o cadastro proposto interrompeu — retomado depois do aceite. */
  readonly intencao?: IntencaoEmAndamento
}

type NaoPronto =
  | {
      readonly status: 'faltando'
      readonly faltando: readonly string[]
      readonly opcionais?: readonly string[]
    }
  | {
      readonly status: 'nao_encontrado'
      readonly tipo: 'cliente' | 'produto'
      readonly procurado: string
    }
  | {
      readonly status: 'varios'
      readonly tipo: 'cliente' | 'produto'
      readonly opcoes: readonly {
        readonly ref: string
        readonly rotulo: string
        readonly detalhe?: string
      }[]
    }
  | {
      readonly status: 'ja_cadastrado'
      readonly ref: string
      readonly rotulo: string
      readonly mensagem: string
    }
  | Recusado

type Preparo = Pronto | (NaoPronto & { readonly intencao?: IntencaoEmAndamento })

export type DefinicaoDeProposta = {
  readonly id: string
  readonly descricao: string
  readonly entrada: z.ZodType
  readonly preparar: (input: never, turno: EstadoDoTurno, casos: AgentUseCases) => Promise<Preparo>
  readonly executar: (
    casos: AgentUseCases,
    ctx: ExecutionContext,
    guardado: ArgsGuardados,
  ) => Promise<ResultadoDaExecucao>
}

function entrada<T extends z.ZodType>(schema: T) {
  return z.preprocess(semNulos, schema)
}

function validar<T>(schema: z.ZodType<T>, valor: unknown): T | Recusado {
  const r = schema.safeParse(valor)
  if (r.success) return r.data
  const primeira = r.error.issues[0]?.message ?? 'Dados incompletos.'
  return { status: 'recusado', mensagem: primeira }
}

function ehRecusado(v: unknown): v is Recusado {
  return typeof v === 'object' && v !== null && (v as { status?: unknown }).status === 'recusado'
}

// ---------------------------------------------------------------- resolução

function mesmoNome(a: string, b: string): boolean {
  const n = (s: string) =>
    s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ')
  return n(a) === n(b)
}

type Resolvido = {
  readonly ok: true
  readonly id: string
  readonly rotulo: string
  readonly preco?: number
}

async function resolverCliente(
  casos: AgentUseCases,
  turno: EstadoDoTurno,
  ref: string,
): Promise<Resolvido | NaoPronto> {
  const doResumo = turno.resumo.entidades.find((e) => e.tipo === 'cliente' && e.ref === ref)
  if (doResumo !== undefined) return { ok: true, id: doResumo.ref, rotulo: doResumo.rotulo }
  try {
    const id =
      casos.resolveCustomerId === undefined
        ? ref
        : await casos.resolveCustomerId(turno.execucao, ref)
    const candidatos = await casos.searchCustomers(turno.execucao, { termo: ref, limite: 5 })
    const achado = candidatos.find((c) => c.id === id)
    return { ok: true, id, rotulo: achado?.name ?? ref }
  } catch (erro) {
    if (isAppError(erro) && erro.code === 'NOT_FOUND') {
      return { status: 'nao_encontrado', tipo: 'cliente', procurado: ref }
    }
    if (isAppError(erro) && erro.code === 'VALIDATION_FAILED') {
      const candidatos = await casos.searchCustomers(turno.execucao, { termo: ref, limite: 5 })
      return {
        status: 'varios',
        tipo: 'cliente',
        opcoes: candidatos.map((c) => ({
          ref: c.id,
          rotulo: c.name,
          ...(c.phone === null ? {} : { detalhe: c.phone }),
        })),
      }
    }
    throw erro
  }
}

async function resolverProduto(
  casos: AgentUseCases,
  turno: EstadoDoTurno,
  ref: string,
): Promise<Resolvido | NaoPronto> {
  try {
    const id =
      casos.resolveProductId === undefined ? ref : await casos.resolveProductId(turno.execucao, ref)
    const visao = await casos.checkStock(turno.execucao, { productId: id })
    return { ok: true, id, rotulo: visao.description, preco: visao.salePriceCents }
  } catch (erro) {
    if (isAppError(erro) && erro.code === 'NOT_FOUND') {
      return { status: 'nao_encontrado', tipo: 'produto', procurado: ref }
    }
    if (isAppError(erro) && erro.code === 'VALIDATION_FAILED') {
      const candidatos = await casos.searchProducts(turno.execucao, {
        q: ref,
        stock: 'todos',
        page: 1,
        pageSize: 5,
      })
      return {
        status: 'varios',
        tipo: 'produto',
        opcoes: candidatos.map((p) => ({
          ref: p.id,
          rotulo: p.description,
          detalhe: reais(p.salePriceCents),
        })),
      }
    }
    throw erro
  }
}

function ok(r: Resolvido | NaoPronto): r is Resolvido {
  return 'ok' in r
}

// ---------------------------------------------------------------- rótulos

const ROTULO_DE_CAMPO: Record<string, string> = {
  name: 'nome',
  tradeName: 'nome fantasia',
  phone: 'telefone',
  email: 'e-mail',
  document: 'documento',
  notes: 'observação',
  walletLimitCents: 'limite de fiado',
  description: 'descrição',
  barcode: 'código de barras',
  unitOfMeasure: 'unidade',
  salePriceCents: 'preço de venda',
  costPriceCents: 'custo',
  taxRate: 'alíquota',
  minStock: 'estoque mínimo',
  category: 'categoria',
  supplier: 'fornecedor',
}

function camposAlterados(campos: Record<string, unknown>): string[] {
  return Object.entries(campos)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      const rotulo = ROTULO_DE_CAMPO[k] ?? 'outro dado'
      const valor = typeof v === 'number' && /Cents$/.test(k) ? reais(v) : String(v)
      return `${rotulo}: ${valor}`
    })
}

// ---------------------------------------------------------------- venda

const itemDaVendaParaOModelo = z
  .object({
    productId: z.string().min(1).describe('Nome do produto ou ref devolvido por uma consulta'),
    quantity: z.number().int().positive().optional().describe('Ausente = 1'),
    unitPriceCents: z.number().int().nonnegative().optional().describe('Ausente = preço de tabela'),
    discountCents: z.number().int().nonnegative().optional(),
  })
  .strict()

const pagamentoParaOModelo = z
  .object({
    method: paymentMethodSchema,
    amountCents: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Ausente com um só pagamento = total'),
    installments: z.number().int().min(1).max(21).optional(),
  })
  .strict()

const vendaParaOModelo = z
  .object({
    customerId: z.string().min(1).optional().describe('Nome do cliente ou ref'),
    items: z.array(itemDaVendaParaOModelo).min(1),
    payments: z.array(pagamentoParaOModelo).optional(),
    discountCents: z.number().int().nonnegative().optional(),
    notes: z.string().max(500).optional(),
  })
  .strict()

type VendaDoModelo = z.infer<typeof vendaParaOModelo>

function semDesconto(centavos: number | undefined): centavos is undefined | 0 {
  return centavos === undefined || centavos === 0
}

async function prepararVenda(
  input: VendaDoModelo,
  turno: EstadoDoTurno,
  casos: AgentUseCases,
): Promise<Preparo> {
  const intencao: IntencaoEmAndamento = {
    acao: 'create_sale',
    jaDito: input as Record<string, unknown>,
    aguardando: 'dados',
    descricao: 'venda em andamento',
  }
  const rotulos: Record<string, string> = {}
  const entidades: EntidadeDaConversa[] = []

  let customerId: string | undefined
  if (input.customerId !== undefined) {
    const c = await resolverCliente(casos, turno, input.customerId)
    if (!ok(c)) {
      return {
        ...c,
        intencao: {
          ...intencao,
          aguardando: c.status === 'nao_encontrado' ? 'cadastro_cliente' : 'escolha',
        },
      }
    }
    customerId = c.id
    rotulos.cliente = c.rotulo
    entidades.push({ tipo: 'cliente', ref: c.id, rotulo: c.rotulo })
  }

  const assumido: string[] = []
  const itens: CreateSaleInput['items'] = []
  for (const item of input.items) {
    const p = await resolverProduto(casos, turno, item.productId)
    if (!ok(p)) {
      return {
        ...p,
        intencao: {
          ...intencao,
          aguardando: p.status === 'nao_encontrado' ? 'cadastro_produto' : 'escolha',
        },
      }
    }
    entidades.push({ tipo: 'produto', ref: p.id, rotulo: p.rotulo })
    rotulos[p.id] = p.rotulo
    if (item.quantity === undefined) assumido.push(`quantidade 1 (${p.rotulo})`)
    if (item.unitPriceCents === undefined) {
      assumido.push(`preço de tabela ${reais(p.preco ?? 0)} (${p.rotulo})`)
    }
    itens.push({
      productId: p.id,
      quantity: item.quantity ?? 1,
      unitPriceCents: item.unitPriceCents ?? p.preco ?? 0,
      ...(semDesconto(item.discountCents) ? {} : { discountCents: item.discountCents }),
    })
  }

  if (input.payments === undefined || input.payments.length === 0) {
    return { status: 'faltando', faltando: ['forma de pagamento'], intencao }
  }

  const total = Money.sum(
    itens.map((i) =>
      Money.fromCents(i.unitPriceCents)
        .multiply(i.quantity)
        .subtract(Money.fromCents(i.discountCents ?? 0)),
    ),
  ).subtract(Money.fromCents(input.discountCents ?? 0))

  const semValor = input.payments.filter((p) => p.amountCents === undefined)
  if (semValor.length > 0 && input.payments.length > 1) {
    return { status: 'faltando', faltando: ['valor de cada forma de pagamento'], intencao }
  }
  const pagamentos = input.payments.map((p) => {
    const aVista = p.installments === undefined || (p.installments === 1 && p.method !== 'credit')
    return {
      method: p.method,
      amountCents: p.amountCents ?? Number(total.cents),
      ...(aVista ? {} : { installments: p.installments }),
    }
  })

  const venda = validar(createSaleInputSchema, {
    ...(customerId === undefined ? {} : { customerId }),
    items: itens,
    payments: pagamentos,
    ...(semDesconto(input.discountCents) ? {} : { discountCents: input.discountCents }),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
  })
  if (ehRecusado(venda)) return venda

  const fatos = [
    ...(rotulos.cliente === undefined
      ? ['venda sem cliente identificado']
      : [`cliente: ${rotulos.cliente}`]),
    ...venda.items.map(
      (i) => `${i.quantity}x ${rotulos[i.productId]} a ${reais(i.unitPriceCents)}`,
    ),
    ...venda.payments.map(
      (p) => `pagamento: ${pagamento(p.method as PaymentMethod)} ${reais(p.amountCents)}`,
    ),
    ...(venda.discountCents === undefined ? [] : [`desconto: ${reais(venda.discountCents)}`]),
  ]
  return { status: 'pronto', guardado: { entrada: venda, rotulos }, fatos, assumido, entidades }
}

// ---------------------------------------------------------------- retomada

/** Campo só do agente: o pedido interrompido pelo cadastro. Não vai a `core`. */
const paraRetomarSchema = z
  .object({
    acao: z.string().min(1).describe('A ferramenta do pedido interrompido, ex.: create_sale'),
    descricao: z.string().min(1).describe('O pedido em português, ex.: venda de café para o João'),
    jaDito: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .optional()
  .describe('Use quando o cadastro interrompe outro pedido, para retomá-lo depois do aceite')

type ParaRetomar = z.infer<typeof paraRetomarSchema>

/**
 * O modelo costuma mandar `jaDito` vazio. O que o pedido interrompido já
 * sabia (a venda que falhou por cliente inexistente, neste turno ou no
 * anterior) é guardado pelo código, e herdado aqui.
 */
function intencaoDoCadastro(
  paraRetomar: ParaRetomar,
  aguardando: 'cadastro_cliente' | 'cadastro_produto',
  turno: EstadoDoTurno,
): IntencaoEmAndamento | undefined {
  if (paraRetomar === undefined) return undefined
  const anterior = [turno.coletor.intencao, turno.resumo.intencao].find(
    (i) => i !== undefined && i.acao === paraRetomar.acao,
  )
  return {
    acao: paraRetomar.acao,
    descricao: paraRetomar.descricao,
    jaDito: { ...(anterior?.jaDito ?? {}), ...(paraRetomar.jaDito ?? {}) },
    aguardando,
  }
}

const clienteParaOModelo = z
  .object({ ...createCustomerInputSchema.shape, paraRetomar: paraRetomarSchema })
  .strict()

// ---------------------------------------------------------------- produto

const produtoParaOModelo = z
  .object(createProductInputSchema.shape)
  .partial()
  .extend({ paraRetomar: paraRetomarSchema })

const OBRIGATORIOS_DO_PRODUTO: readonly [string, string][] = [
  ['description', 'descrição'],
  ['unitOfMeasure', 'unidade'],
  ['costPriceCents', 'custo'],
  ['salePriceCents', 'preço de venda'],
]

const OPCIONAIS_DO_PRODUTO = [
  'código de barras',
  'categoria',
  'fornecedor',
  'estoque inicial',
  'estoque mínimo',
  'NCM',
  'CFOP',
  'CSOSN',
]

// ---------------------------------------------------------------- definições

const comId = z.object({ id: idSchema })

export function definicoesDeProposta(): readonly DefinicaoDeProposta[] {
  const defs: DefinicaoDeProposta[] = [
    {
      id: 'create_sale',
      descricao:
        'Propõe uma venda (também a "compra" de um cliente). Não grava: a dona confirma depois. ' +
        'Sem quantidade, assume 1; sem preço, o de tabela; a forma de pagamento é obrigatória.',
      entrada: vendaParaOModelo,
      preparar: (input, turno, casos) => prepararVenda(input as VendaDoModelo, turno, casos),
      executar: async (casos, ctx, g) => {
        const out = await casos.registerSale(ctx, g.entrada as CreateSaleInput)
        return {
          status: 'gravado',
          fatos: [
            out.replayed
              ? `a venda nº ${out.sale.number} já estava registrada`
              : `venda nº ${out.sale.number} registrada`,
            `total ${reais(out.sale.netAmountCents)}`,
          ],
          entidades: [{ tipo: 'venda', ref: out.sale.id, rotulo: `venda nº ${out.sale.number}` }],
        }
      },
    },
    {
      id: 'create_product',
      descricao:
        'Propõe cadastrar um produto. Obrigatórios: descrição, unidade, custo e preço de venda. ' +
        'Opcionais: código de barras, categoria, fornecedor, estoque inicial e mínimo, NCM, CFOP, CSOSN.',
      entrada: produtoParaOModelo,
      preparar: async (input, turno) => {
        const { paraRetomar, ...dados } = input as { paraRetomar?: ParaRetomar } & Record<
          string,
          unknown
        >
        const intencao = intencaoDoCadastro(paraRetomar, 'cadastro_produto', turno)
        const faltando = OBRIGATORIOS_DO_PRODUTO.filter(([k]) => dados[k] === undefined).map(
          ([, n]) => n,
        )
        if (faltando.length > 0) {
          return {
            status: 'faltando',
            faltando,
            opcionais: OPCIONAIS_DO_PRODUTO,
            ...(intencao === undefined ? {} : { intencao }),
          }
        }
        const produto = validar(createProductInputSchema, dados)
        if (ehRecusado(produto)) return produto
        return {
          status: 'pronto',
          ...(intencao === undefined ? {} : { intencao }),
          guardado: { entrada: produto, rotulos: {} },
          fatos: [
            `cadastrar o produto ${produto.description}`,
            `unidade: ${produto.unitOfMeasure}`,
            `custo: ${reais(produto.costPriceCents)}`,
            `preço de venda: ${reais(produto.salePriceCents)}`,
          ],
        }
      },
      executar: async (casos, ctx, g) => {
        const out = await casos.registerProduct(ctx, g.entrada as never)
        return {
          status: 'gravado',
          fatos: [
            `produto ${out.description} cadastrado`,
            `preço de venda ${reais(out.salePriceCents)}`,
          ],
          entidades: [{ tipo: 'produto', ref: out.id, rotulo: out.description }],
        }
      },
    },
    {
      id: 'create_customer',
      descricao:
        'Propõe cadastrar um cliente. Só o nome é obrigatório. Se o cadastro interrompe outro pedido, preencha paraRetomar.',
      entrada: clienteParaOModelo,
      preparar: async (input, turno) => {
        const { paraRetomar, ...dados } = input as { paraRetomar?: ParaRetomar } & Record<
          string,
          unknown
        >
        const c = validar(createCustomerInputSchema, dados)
        if (ehRecusado(c)) return c
        const conhecido = turno.resumo.entidades.find(
          (e) => e.tipo === 'cliente' && mesmoNome(e.rotulo, c.name),
        )
        if (conhecido !== undefined) {
          return {
            status: 'ja_cadastrado',
            ref: conhecido.ref,
            rotulo: conhecido.rotulo,
            mensagem: 'Esse cliente já está cadastrado. Use o ref dele e siga com o pedido.',
          }
        }
        const intencao = intencaoDoCadastro(paraRetomar, 'cadastro_cliente', turno)
        return {
          status: 'pronto',
          ...(intencao === undefined ? {} : { intencao }),
          guardado: { entrada: c, rotulos: {} },
          fatos: [
            `cadastrar o cliente ${c.name}`,
            ...(c.phone === undefined ? [] : [`telefone: ${c.phone}`]),
          ],
        }
      },
      executar: async (casos, ctx, g) => {
        const out = await casos.registerCustomer(ctx, g.entrada as never)
        if (out.status === 'duplicate_found') {
          return {
            status: 'parecido',
            fatos: ['já existe cadastro parecido; nada foi criado'],
            opcoes: out.candidates.map((c) => ({
              ref: c.id,
              rotulo: c.name,
              ...(c.phone === null ? {} : { detalhe: c.phone }),
            })),
          }
        }
        return {
          status: 'gravado',
          fatos: [`cliente ${out.customer.name} cadastrado`],
          entidades: [{ tipo: 'cliente', ref: out.customer.id, rotulo: out.customer.name }],
        }
      },
    },
    {
      id: 'update_customer',
      descricao: 'Propõe alterar dados de um cliente (id: nome ou ref). Informe só o que muda.',
      entrada: comId.and(updateCustomerInputSchema),
      preparar: async (input, turno, casos) => {
        const { id, ...campos } = input as { id: string } & Record<string, unknown>
        const c = await resolverCliente(casos, turno, id)
        if (!ok(c)) return c
        return {
          status: 'pronto',
          guardado: { entrada: { id: c.id, campos }, rotulos: { cliente: c.rotulo } },
          fatos: [`alterar o cliente ${c.rotulo}`, ...camposAlterados(campos)],
          entidades: [{ tipo: 'cliente', ref: c.id, rotulo: c.rotulo }],
        }
      },
      executar: async (casos, ctx, g) => {
        const { id, campos } = g.entrada as { id: string; campos: Record<string, unknown> }
        const out = await casos.updateCustomer(ctx, id, campos as never)
        return {
          status: 'gravado',
          fatos: [`cliente ${out.name} atualizado`, ...camposAlterados(campos)],
        }
      },
    },
    {
      id: 'mark_customer_deleted',
      descricao: 'Propõe marcar um cliente como deletado (o histórico continua guardado).',
      entrada: comId.strict(),
      preparar: async (input, turno, casos) => {
        const c = await resolverCliente(casos, turno, (input as { id: string }).id)
        if (!ok(c)) return c
        return {
          status: 'pronto',
          guardado: { entrada: { id: c.id }, rotulos: { cliente: c.rotulo } },
          fatos: [`marcar o cliente ${c.rotulo} como deletado`],
        }
      },
      executar: async (casos, ctx, g) => {
        await casos.deleteCustomer(ctx, (g.entrada as { id: string }).id)
        return {
          status: 'gravado',
          fatos: [`cliente ${g.rotulos.cliente ?? ''} deletado`.replace('  ', ' ')],
        }
      },
    },
    {
      id: 'update_product',
      descricao: 'Propõe alterar dados de um produto (id: nome ou ref). Informe só o que muda.',
      entrada: comId.and(updateProductInputSchema),
      preparar: async (input, turno, casos) => {
        const { id, ...campos } = input as { id: string } & Record<string, unknown>
        const p = await resolverProduto(casos, turno, id)
        if (!ok(p)) return p
        return {
          status: 'pronto',
          guardado: { entrada: { id: p.id, campos }, rotulos: { produto: p.rotulo } },
          fatos: [`alterar o produto ${p.rotulo}`, ...camposAlterados(campos)],
          entidades: [{ tipo: 'produto', ref: p.id, rotulo: p.rotulo }],
        }
      },
      executar: async (casos, ctx, g) => {
        const { id, campos } = g.entrada as { id: string; campos: Record<string, unknown> }
        const out = await casos.updateProduct(ctx, id, campos as never)
        return {
          status: 'gravado',
          fatos: [
            `produto ${out.description} atualizado`,
            `preço de venda ${reais(out.salePriceCents)}`,
            `custo ${reais(out.costPriceCents)}`,
          ],
        }
      },
    },
    {
      id: 'mark_product_deleted',
      descricao: 'Propõe marcar um produto como deletado (o histórico continua guardado).',
      entrada: comId.strict(),
      preparar: async (input, turno, casos) => {
        const p = await resolverProduto(casos, turno, (input as { id: string }).id)
        if (!ok(p)) return p
        return {
          status: 'pronto',
          guardado: { entrada: { id: p.id }, rotulos: { produto: p.rotulo } },
          fatos: [`marcar o produto ${p.rotulo} como deletado`],
        }
      },
      executar: async (casos, ctx, g) => {
        await casos.deleteProduct(ctx, (g.entrada as { id: string }).id)
        return { status: 'gravado', fatos: [`produto ${g.rotulos.produto ?? ''} deletado`] }
      },
    },
    {
      id: 'cancel_sale',
      descricao:
        'Propõe cancelar uma venda inteira, com motivo (também para "apague a venda"). A venda fica no histórico como cancelada.',
      entrada: cancelSaleInputSchema,
      preparar: async (input, turno) => {
        const c = input as z.infer<typeof cancelSaleInputSchema>
        const venda = turno.resumo.entidades.find((e) => e.tipo === 'venda' && e.ref === c.saleId)
        return {
          status: 'pronto',
          guardado: { entrada: c, rotulos: { venda: venda?.rotulo ?? 'a venda' } },
          fatos: [`cancelar ${venda?.rotulo ?? 'a venda'}`, `motivo: ${c.reason}`],
        }
      },
      executar: async (casos, ctx, g) => {
        await casos.cancelSale(ctx, g.entrada as never)
        return {
          status: 'gravado',
          fatos: [
            `${g.rotulos.venda ?? 'venda'} cancelada`,
            'o estoque voltou e os recebíveis dela foram cancelados',
          ],
        }
      },
    },
    {
      id: 'create_payable',
      descricao: 'Propõe lançar uma conta a pagar. Não invente valor nem vencimento.',
      entrada: createPayableInputSchema,
      preparar: async (input) => {
        const c = input as z.infer<typeof createPayableInputSchema>
        return {
          status: 'pronto',
          guardado: { entrada: c, rotulos: {} },
          fatos: [
            `conta a pagar de ${c.supplier}: ${c.description}`,
            `valor: ${reais(c.amountCents)}`,
            `vence: ${c.dueDate}`,
            ...(c.recurrence === undefined ? [] : ['repete nos próximos meses']),
          ],
        }
      },
      executar: async (casos, ctx, g) => {
        const out = await casos.createPayable(ctx, g.entrada as never)
        const primeira = out[0]
        return {
          status: 'gravado',
          fatos:
            primeira === undefined
              ? ['nenhuma conta foi lançada']
              : [
                  out.length > 1
                    ? `${out.length} contas lançadas para ${primeira.supplier}`
                    : `conta de ${primeira.supplier} lançada`,
                  `valor ${reais(primeira.amountCents)}`,
                  `primeiro vencimento ${primeira.dueDate}`,
                ],
        }
      },
    },
    {
      id: 'create_receivable',
      descricao:
        'Propõe lançar um valor a receber que NÃO vem de venda (para venda, use create_sale).',
      entrada: createReceivableInputSchema,
      preparar: async (input, turno, casos) => {
        const c = input as z.infer<typeof createReceivableInputSchema>
        let rotulo: string | undefined
        let entrada = c
        if (c.customerId !== undefined) {
          const r = await resolverCliente(casos, turno, c.customerId)
          if (!ok(r)) return r
          rotulo = r.rotulo
          entrada = { ...c, customerId: r.id }
        }
        return {
          status: 'pronto',
          guardado: { entrada, rotulos: {} },
          fatos: [
            `a receber: ${c.description}`,
            ...(rotulo === undefined ? [] : [`de ${rotulo}`]),
            `valor: ${reais(c.amountCents)}`,
            `vence: ${c.dueDate}`,
          ],
        }
      },
      executar: async (casos, ctx, g) => {
        const out = await casos.createReceivable(ctx, g.entrada as never)
        return {
          status: 'gravado',
          fatos: [
            `a receber lançado: ${out.description}`,
            `valor ${reais(out.amountCents)}`,
            `vence ${out.dueDate}`,
          ],
        }
      },
    },
    {
      id: 'settle_payable',
      descricao: 'Propõe dar baixa numa conta a pagar (payableId: ref de list_payables).',
      entrada: settlePayableInputSchema,
      preparar: async (input) => {
        const c = input as z.infer<typeof settlePayableInputSchema>
        return {
          status: 'pronto',
          guardado: { entrada: c, rotulos: {} },
          fatos: [
            `baixar ${reais(c.amountCents)} da conta`,
            `em ${c.settledOn}`,
            `pela conta ${c.bankAccount}`,
          ],
        }
      },
      executar: async (casos, ctx, g) => {
        const out = await casos.settlePayable(ctx, g.entrada as never)
        return {
          status: 'gravado',
          fatos: [`baixa de ${reais(out.amountCents)} registrada em ${out.settledOn}`],
        }
      },
    },
    {
      id: 'settle_receivable',
      descricao: 'Propõe registrar um recebimento (receivableId: ref de list_receivables).',
      entrada: settleReceivableInputSchema,
      preparar: async (input) => {
        const c = input as z.infer<typeof settleReceivableInputSchema>
        return {
          status: 'pronto',
          guardado: { entrada: c, rotulos: {} },
          fatos: [
            `registrar recebimento de ${reais(c.amountCents)}`,
            `em ${c.settledOn}`,
            `por ${pagamento(c.method)}`,
          ],
        }
      },
      executar: async (casos, ctx, g) => {
        const out = await casos.settleReceivable(ctx, g.entrada as never)
        return {
          status: 'gravado',
          fatos: [`recebimento de ${reais(out.amountCents)} registrado em ${out.settledOn}`],
        }
      },
    },
    {
      id: 'adjust_stock',
      descricao:
        'Propõe corrigir o estoque para a quantidade CONTADA (não a diferença), com motivo.',
      entrada: adjustStockInputSchema,
      preparar: async (input, turno, casos) => {
        const c = input as z.infer<typeof adjustStockInputSchema>
        const p = await resolverProduto(casos, turno, c.productId)
        if (!ok(p)) return p
        return {
          status: 'pronto',
          guardado: { entrada: { ...c, productId: p.id }, rotulos: { produto: p.rotulo } },
          fatos: [
            `ajustar o estoque de ${p.rotulo} para ${c.countedQuantity} un.`,
            `motivo: ${c.reason}`,
          ],
          entidades: [{ tipo: 'produto', ref: p.id, rotulo: p.rotulo }],
        }
      },
      executar: async (casos, ctx, g) => {
        const out = await casos.adjustStock(ctx, g.entrada as never)
        const sinal = out.quantityDelta > 0 ? `+${out.quantityDelta}` : `${out.quantityDelta}`
        return {
          status: 'gravado',
          fatos: [
            `estoque de ${g.rotulos.produto ?? 'produto'} ajustado em ${sinal} un.`,
            `saldo agora ${out.balanceAfter} un.`,
          ],
        }
      },
    },
    {
      id: 'create_appointment',
      descricao: 'Propõe marcar um compromisso na agenda. Não invente data nem hora.',
      entrada: createAppointmentInputSchema,
      preparar: async (input, turno, casos) => {
        const c = input as z.infer<typeof createAppointmentInputSchema>
        let entrada = c
        let rotulo: string | undefined
        if (c.customerId !== undefined) {
          const r = await resolverCliente(casos, turno, c.customerId)
          if (!ok(r)) return r
          entrada = { ...c, customerId: r.id }
          rotulo = r.rotulo
        }
        return {
          status: 'pronto',
          guardado: { entrada, rotulos: {} },
          fatos: [
            `marcar "${c.title}"`,
            `início: ${c.startsAt}`,
            ...(c.location === undefined ? [] : [`local: ${c.location}`]),
            ...(rotulo === undefined ? [] : [`com ${rotulo}`]),
          ],
        }
      },
      executar: async (casos, ctx, g) => {
        const out = await casos.createAppointment(ctx, g.entrada as never)
        return {
          status: 'gravado',
          fatos: [`compromisso "${out.title}" marcado`, `início ${out.startsAt}`],
          entidades: [{ tipo: 'compromisso', ref: out.id, rotulo: out.title }],
        }
      },
    },
    {
      id: 'send_charge',
      descricao:
        'Propõe enviar cobrança por mensagem a um cliente com dívida em aberto (customerId: nome ou ref).',
      entrada: sendChargeInputSchema,
      preparar: async (input, turno, casos) => {
        const c = input as z.infer<typeof sendChargeInputSchema>
        if (c.customerId === undefined) {
          return {
            status: 'pronto',
            guardado: { entrada: c, rotulos: {} },
            fatos: [`enviar cobrança para o telefone ${c.phone ?? ''}`],
          }
        }
        const r = await resolverCliente(casos, turno, c.customerId)
        if (!ok(r)) return r
        return {
          status: 'pronto',
          guardado: { entrada: { ...c, customerId: r.id }, rotulos: { cliente: r.rotulo } },
          fatos: [`enviar cobrança para ${r.rotulo}`],
          entidades: [{ tipo: 'cliente', ref: r.id, rotulo: r.rotulo }],
        }
      },
      executar: async (casos, ctx, g) => {
        const out = await casos.sendCustomerCharge(ctx, g.entrada as never)
        if (out.status === 'nothing_to_charge') {
          return {
            status: 'gravado',
            fatos: [`${out.customerName} não tem dívida em aberto; nada foi enviado`],
          }
        }
        if (out.status === 'rejected') {
          return {
            status: 'gravado',
            fatos: [`não deu para enviar a cobrança para ${out.customerName}`],
          }
        }
        return {
          status: 'gravado',
          fatos: [`cobrança de ${reais(out.amountCents)} enviada para ${out.customerName}`],
        }
      },
    },
  ]
  return defs
}

/** Monta as tools de proposta. `put()` encerra a pendente anterior da conversa. */
export function ferramentasDeProposta(casos: AgentUseCases, confirmations: ConfirmationStore) {
  const tools: Record<string, ReturnType<typeof createTool>> = {}
  for (const def of definicoesDeProposta()) {
    tools[def.id] = createTool({
      id: def.id,
      description: def.descricao,
      inputSchema: entrada(def.entrada),
      execute: async (input, context) => {
        const turno = turnoDe(context)
        if (turno.coletor.propostaNova !== undefined) {
          return {
            status: 'ja_tem_proposta',
            orientacao:
              'Uma proposta por vez: espere a dona confirmar a que já foi feita antes de propor outra.',
          }
        }
        return emErroHumano(async () => {
          const preparo = await def.preparar(input as never, turno, casos)
          if (preparo.status !== 'pronto') {
            if ('intencao' in preparo && preparo.intencao !== undefined) {
              turno.coletor.intencao = preparo.intencao
            }
            const { intencao: _intencao, ...resposta } = preparo as NaoPronto & {
              intencao?: unknown
            }
            return resposta
          }

          const pendente = novaConfirmacao({
            companyId: turno.execucao.companyId,
            conversationKey: turno.conversationKey,
            toolId: def.id,
            args: preparo.guardado,
            summary: preparo.fatos.join('; '),
            expiresAt: new Date(turno.execucao.now.getTime() + turno.ttlMs),
          })
          await confirmations.put(pendente)
          turno.coletor.propostaNova = { id: pendente.id }
          turno.coletor.intencao = preparo.intencao
          turno.coletor.registrar(...(preparo.entidades ?? []))
          return { status: 'proposta', fatos: preparo.fatos, assumido: preparo.assumido ?? [] }
        })
      },
    })
  }
  return tools
}
