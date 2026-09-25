import type { CreateSaleInput, PaymentMethod } from '@na-regua/contracts'
import {
  calculateCardFeeAmount,
  calculateChange,
  calculateInstallmentPlan,
  calculateSaleTotals,
  DEFAULT_SETTLEMENT_DAYS,
  DomainError,
  type PaymentInput,
  type SaleItemInput,
} from '@na-regua/domain'
import { Money } from '@na-regua/money'
import { AppError } from '../app-error.js'
import { nasceComoDividaDoCliente } from '../settlements/customer-balance.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type {
  CompanySettingsRepository,
  NewReceivable,
  NewSaleItem,
  NewSalePayment,
  RegisteredSale,
  SaleProductSnapshot,
  UnitOfWork,
} from '../ports/sale-writers.js'

/**
 * Todo recebivel de cartao comeca assim. Quem deve esse dinheiro e a
 * OPERADORA, e nao o cliente, que ja pagou no balcao — a ficha do cliente usa
 * este prefixo para nao listar parcela de cartao como divida dele.
 */
export const PREFIXO_RECEBIVEL_DE_CARTAO = 'Cartao de '

export type RegisterSaleDeps = {
  readonly unitOfWork: UnitOfWork
  readonly settings: CompanySettingsRepository
}

/** Item vendido sem saldo — aviso, nao erro (RF-028). */
export type StockWarning = {
  readonly productId: string
  readonly description: string
  readonly requested: number
  readonly available: number
}

export type RegisterSaleResult = {
  readonly sale: RegisteredSale
  /**
   * `true` quando a chave de idempotencia ja tinha venda: e reenvio do PDV, e
   * nao venda nova. Quem chama precisa distinguir para nao mostrar "venda
   * registrada" duas vezes.
   */
  readonly replayed: boolean
  readonly stockWarnings: readonly StockWarning[]
}

/**
 * Fecha a venda — RF-034 a RF-039, RNF-043, RNF-046.
 *
 * Venda, baixa de estoque e recebiveis entram na MESMA transacao. Se qualquer
 * passo falhar, nao sobra venda pela metade — nem estoque baixado sem venda,
 * nem recebivel de venda que nao existe. A transacao e aberta aqui, pelo caso
 * de uso, e nao pelo repositorio: repositorio que abre a propria transacao
 * impossibilita compor (principio 6).
 *
 * O que **nao** entra na transacao: emitir nota e enviar mensagem. Efeito
 * externo vai para a fila pelo padrao outbox, senao um erro de rede com a
 * SEFAZ desfaz uma venda ja concluida. O enfileiramento entra com a NR-041.
 */
export async function registerSale(
  deps: RegisterSaleDeps,
  ctx: ExecutionContext,
  input: CreateSaleInput,
): Promise<RegisterSaleResult> {
  assertCanWrite(ctx)

  /*
   * Desconto e acrescimo recusados, e nao ignorados em silencio.
   *
   * `applyDiscount` existe em `domain` (NR-024) e `calculateSaleTotals`
   * tambem — mas o segundo nao recebe desconto: ele exige que a soma dos
   * pagamentos seja exatamente o bruto dos itens. Compor os dois hoje daria
   * total errado, e total errado numa venda e dinheiro errado.
   *
   * A integracao pede `calculateSaleTotals` aceitar o desconto, que e mudanca
   * em `domain`. Recusar aqui e a alternativa honesta a calcular errado.
   */
  if (input.discountCents !== undefined && input.discountCents > 0) {
    throw AppError.validation(
      'Desconto na venda ainda nao esta disponivel. Registre a venda sem desconto.',
      [{ path: 'discountCents', message: 'Desconto indisponivel nesta versao.' }],
    )
  }
  if (input.surchargeRate !== undefined && input.surchargeRate > 0) {
    throw AppError.validation(
      'Acrescimo na venda ainda nao esta disponivel. Registre a venda sem acrescimo.',
      [{ path: 'surchargeRate', message: 'Acrescimo indisponivel nesta versao.' }],
    )
  }

  /* Fiado sem cliente e divida de ninguem — RF-033. O schema de `contracts` ja
     recusa, e a regra fica aqui tambem porque o agente monta a entrada dele. */
  const temCarteira = input.payments.some((p) => p.method === 'wallet')
  if (temCarteira && input.customerId === undefined) {
    throw AppError.validation('Venda no fiado exige cliente identificado.', [
      { path: 'customerId', message: 'Informe o cliente para vender no fiado.' },
    ])
  }

  const settings = await deps.settings.forSale(ctx.companyId, ctx.role)

  return deps.unitOfWork.transaction(ctx.companyId, async (tx) => {
    /*
     * Idempotencia DENTRO da transacao — RF-036. Entre uma consulta fora e a
     * gravacao cabe um segundo envio do PDV; aqui a leitura e a escrita estao
     * na mesma transacao, e o indice unico do banco e a garantia final.
     *
     * A chave vem do CONTEXTO, e nao do corpo da venda: ela identifica a
     * TENTATIVA, nao o que esta sendo vendido. No corpo, o cliente poderia
     * mudar os itens mantendo a chave, e o reenvio devolveria uma venda que
     * nao corresponde ao que foi pedido.
     */
    if (ctx.idempotencyKey !== undefined) {
      const anterior = await tx.findByIdempotencyKey(ctx.idempotencyKey)
      if (anterior) {
        return { sale: anterior, replayed: true, stockWarnings: [] }
      }
    }

    const produtos = await tx.products.findManyByIds(input.items.map((i) => i.productId))
    const porId = new Map(produtos.map((p) => [p.id, p]))

    const ausentes = input.items.map((i) => i.productId).filter((id) => !porId.has(id))
    if (ausentes.length > 0) {
      /*
       * Nao diz QUAIS ids faltaram: produto de outra empresa e produto
       * inexistente respondem igual, e listar o id confirmaria a existencia
       * de um id que o RLS acabou de esconder.
       */
      throw AppError.notFound(
        ausentes.length === 1
          ? 'Um dos produtos da venda nao foi encontrado. Refaca o carrinho.'
          : `${ausentes.length} produtos da venda nao foram encontrados. Refaca o carrinho.`,
      )
    }

    const itensDeDominio: SaleItemInput[] = input.items.map((item) => {
      const produto = porId.get(item.productId)!
      return {
        productId: item.productId,
        quantity: item.quantity,
        /*
         * O preco praticado vem da ENTRADA, nao do cadastro: o balcao negocia,
         * e a venda registra o que foi cobrado de fato. O custo vem do
         * cadastro, porque custo nao se negocia na hora.
         */
        unitPrice: Money.fromCents(item.unitPriceCents),
        unitCost: Money.fromCents(produto.costPriceCents),
        ...(produto.taxRate === null ? {} : { taxRate: produto.taxRate }),
      }
    })

    const bruto = Money.sum(itensDeDominio.map((i) => i.unitPrice.multiply(i.quantity)))

    const pagamentosDaEntrada: PaymentInput[] = input.payments.map((p) => ({
      method: p.method,
      amount: Money.fromCents(p.amountCents),
      ...(p.installments === undefined ? {} : { installments: p.installments }),
      ...(p.brand === undefined ? {} : { brand: p.brand }),
    }))

    /*
     * Troco antes dos totais, e nao depois, porque um depende do outro na ordem
     * certa: `calculateChange` valida a cobertura e mede a sobra EM DINHEIRO;
     * `calculateSaleTotals` exige que a soma dos pagamentos seja exatamente o
     * bruto. Com R$ 50 em dinheiro numa venda de R$ 30, os dois nao podem
     * receber a mesma lista — o troco de R$ 20 nao e receita.
     */
    const troco = comErroDeDominio(() => calculateChange(bruto, pagamentosDaEntrada))

    const pagamentos = troco.isZero()
      ? pagamentosDaEntrada
      : descontarTroco(pagamentosDaEntrada, troco)

    const totais = comErroDeDominio(() =>
      calculateSaleTotals(
        [...itensDeDominio],
        [...pagamentos],
        settings.taxRules,
        settings.cardFees,
        ctx.now,
      ),
    )

    const avisos = avisosDeEstoque(input.items, porId)

    const itens: NewSaleItem[] = input.items.map((item) => {
      const produto = porId.get(item.productId)!
      return {
        productId: item.productId,
        description: produto.description,
        unitOfMeasure: produto.unitOfMeasure,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        costPriceCents: produto.costPriceCents,
        discountCents: item.discountCents ?? 0,
        totalCents: item.unitPriceCents * item.quantity - (item.discountCents ?? 0),
      }
    })

    const pagamentosGravados: NewSalePayment[] = []
    const recebiveis: NewReceivable[] = []

    for (const pagamento of pagamentos) {
      const { registro, gerados } = recebiveisDoPagamento(
        pagamento,
        settings.cardFees,
        ctx.now,
        input.customerId,
      )
      pagamentosGravados.push(registro)
      recebiveis.push(...gerados)
    }

    const venda = await tx.insertSale({
      customerId: input.customerId,
      channel: ctx.channel,
      grossAmountCents: Number(totais.grossAmount.cents),
      discountCents: 0,
      taxAmountCents: Number(totais.taxAmount.cents),
      cardFeeAmountCents: Number(totais.cardFeeAmount.cents),
      costAmountCents: Number(totais.costAmount.cents),
      netAmountCents: Number(totais.netAmount.cents),
      changeCents: Number(troco.cents),
      notes: input.notes,
      idempotencyKey: ctx.idempotencyKey,
      items: itens,
      payments: pagamentosGravados,
      receivables: recebiveis,
      createdBy: ctx.userId,
      createdAt: ctx.now,
    })

    /*
     * O que nasceu de divida sobe no saldo do cliente — RF-013.
     *
     * Na MESMA transacao do `insertSale`: um titulo de fiado gravado com o
     * saldo intacto e uma divida que o sistema nao sabe que existe, e era
     * exatamente esse o estado ate aqui.
     *
     * Uma soma so, e nao uma por titulo: e um UPDATE a menos na venda mais
     * comum, e o saldo final e o mesmo.
     */
    const dividaNova = recebiveis
      .filter((r) => r.isCustomerDebt)
      .reduce((soma, r) => soma + r.amountCents, 0)

    if (dividaNova > 0 && input.customerId !== undefined) {
      await tx.adjustCustomerBalance(input.customerId, dividaNova)
    }

    /* A baixa carrega autoria para virar linha na trilha de estoque — RF-024.
       Depois do insertSale porque so aqui a venda tem id. */
    await tx.decreaseStock(
      input.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      { saleId: venda.id, createdBy: ctx.userId, createdAt: ctx.now },
    )

    return { sale: venda, replayed: false, stockWarnings: avisos }
  })
}

/**
 * Traduz `DomainError` em `AppError` de validacao.
 *
 * `domain` fala em codigo (`PAYMENT_TOTAL_MISMATCH`), que a api usa para
 * escolher o status HTTP. Deixar a excecao de `domain` subir crua faria o
 * handler de erro tratar regra de negocio como falha inesperada — e responder
 * 500 para "faltam R$ 10 para fechar a venda".
 */
function comErroDeDominio<T>(calcular: () => T): T {
  try {
    return calcular()
  } catch (erro) {
    if (erro instanceof DomainError) {
      /* A mensagem de `domain` ja e para o usuario: "Faltam R$ 10 para fechar
         a venda". O codigo fica no `cause` para o log correlacionar. */
      throw AppError.validation(erro.message)
    }
    throw erro
  }
}

/**
 * Abate o troco do pagamento em dinheiro.
 *
 * O que fica registrado como pago em dinheiro e o que fica na gaveta, nao o
 * que a pessoa entregou: numa venda de R$ 30 paga com R$ 50, o pagamento e de
 * R$ 30 e o troco de R$ 20 e devolvido. Registrar R$ 50 inflaria o faturamento
 * do dia em R$ 20 — e o caixa fecharia errado justamente onde alguem confere.
 */
function descontarTroco(pagamentos: readonly PaymentInput[], troco: Money): PaymentInput[] {
  let restante = troco

  return pagamentos.map((pagamento) => {
    if (pagamento.method !== 'cash' || restante.isZero()) return pagamento

    const abater = restante.compare(pagamento.amount) === 1 ? pagamento.amount : restante
    restante = restante.subtract(abater)
    return { ...pagamento, amount: pagamento.amount.subtract(abater) }
  })
}

/** RF-028: avisa, e deixa prosseguir. O produto esta na mao do cliente. */
function avisosDeEstoque(
  itens: CreateSaleInput['items'],
  porId: ReadonlyMap<string, SaleProductSnapshot>,
): StockWarning[] {
  const avisos: StockWarning[] = []

  for (const item of itens) {
    const produto = porId.get(item.productId)
    if (!produto || produto.stockQuantity >= item.quantity) continue
    avisos.push({
      productId: produto.id,
      description: produto.description,
      requested: item.quantity,
      available: produto.stockQuantity,
    })
  }

  return avisos
}

/** AAAA-MM-DD em UTC — a coluna e `date`, sem hora. */
const soData = (instante: Date): string => instante.toISOString().slice(0, 10)

const somarDias = (instante: Date, dias: number): Date => {
  const saida = new Date(instante)
  saida.setUTCDate(saida.getUTCDate() + dias)
  return saida
}

/**
 * Um pagamento vira um registro e zero ou mais recebiveis — RF-063, RF-064.
 *
 * | Forma    | Recebivel                                                    |
 * | -------- | ------------------------------------------------------------ |
 * | `cash`   | liquidado no ato                                             |
 * | `pix`    | liquidado no ato                                             |
 * | `debit`  | aberto, vence no repasse, liquido descontada a tarifa        |
 * | `credit` | **um por parcela**, cada um com vencimento e tarifa proprios |
 * | `wallet` | aberto, vence na data da venda — fiado e divida sem prazo    |
 */
function recebiveisDoPagamento(
  pagamento: PaymentInput,
  cardFees: Parameters<typeof calculateCardFeeAmount>[1],
  agora: Date,
  customerId: string | undefined,
): { registro: NewSalePayment; gerados: NewReceivable[] } {
  const metodo = pagamento.method as PaymentMethod
  const valor = Number(pagamento.amount.cents)

  if (metodo === 'credit') {
    const plano = calculateInstallmentPlan(pagamento, cardFees, agora)

    return {
      registro: {
        method: metodo,
        amountCents: valor,
        installments: plano.installments.length,
        ...(pagamento.brand === undefined ? {} : { brand: pagamento.brand }),
        cardFeeCents: Number(plano.cardFeeAmount.cents),
      },
      gerados: plano.installments.map((parcela) => ({
        description: `${PREFIXO_RECEBIVEL_DE_CARTAO}credito ${parcela.number}/${plano.installments.length}`,
        customerId,
        amountCents: Number(parcela.grossAmount.cents),
        netAmountCents: Number(parcela.netAmount.cents),
        dueDate: soData(parcela.dueDate),
        installmentNumber: parcela.number,
        installmentCount: plano.installments.length,
        /* Parcela de cartao e divida da ADQUIRENTE, nunca do cliente. */
        isCustomerDebt: false,
      })),
    }
  }

  if (metodo === 'debit') {
    const tarifa = calculateCardFeeAmount(pagamento.amount, cardFees, pagamento.brand, 1)
    const vencimento = somarDias(agora, cardFees.settlementDays ?? DEFAULT_SETTLEMENT_DAYS)

    return {
      registro: {
        method: metodo,
        amountCents: valor,
        ...(pagamento.brand === undefined ? {} : { brand: pagamento.brand }),
        cardFeeCents: Number(tarifa.cents),
      },
      gerados: [
        {
          description: `${PREFIXO_RECEBIVEL_DE_CARTAO}debito`,
          customerId,
          amountCents: valor,
          netAmountCents: Number(pagamento.amount.subtract(tarifa).cents),
          dueDate: soData(vencimento),
          installmentNumber: 1,
          installmentCount: 1,
          isCustomerDebt: nasceComoDividaDoCliente(customerId, metodo),
        },
      ],
    }
  }

  /* `cash` e `pix` entram liquidados; `wallet` fica em aberto — RF-064. */
  const liquidado = metodo === 'cash' || metodo === 'pix'

  return {
    registro: { method: metodo, amountCents: valor, cardFeeCents: 0 },
    gerados: [
      {
        description: liquidado ? `Recebimento em ${metodo}` : 'Fiado',
        customerId,
        amountCents: valor,
        netAmountCents: valor,
        dueDate: soData(agora),
        installmentNumber: 1,
        installmentCount: 1,
        isCustomerDebt: nasceComoDividaDoCliente(customerId, metodo),
        ...(liquidado ? { settledAt: agora.toISOString() } : {}),
      },
    ],
  }
}
