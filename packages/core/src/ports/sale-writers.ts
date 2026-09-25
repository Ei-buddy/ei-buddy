import type { CardBrand, PaymentMethod } from '@na-regua/contracts'
import type { CardFeeTable, DiscountPolicy, TaxRules } from '@na-regua/domain'
import type { CompanyId, UserId } from '../context.js'
import type { TransactionalAuditTrail } from './audit-trail.js'

/**
 * Portas da escrita da venda — NR-022, RNF-046.
 *
 * A fronteira de transacao e o CASO DE USO, nunca o repositorio
 * ([principio 6](../../../../docs/arquitetura/principios.md)). Por isso a porta
 * principal aqui e `UnitOfWork`: ela empresta um escopo transacional, e os
 * escritores existem **dentro** dele. Repositorio que abre a propria transacao
 * impossibilita compor — e venda, estoque e recebivel precisam entrar juntos
 * ou nao entrar.
 */

/**
 * Configuracao da empresa que o calculo precisa.
 *
 * `domain` e puro: aliquota, tarifa de cartao e teto de desconto chegam nele
 * por parametro, resolvidos. Descobrir que `staff` tem 10% de alcada e leitura
 * de dado da empresa, portanto de `core` — e e esta porta.
 *
 * **Nenhum dos tres tem tabela ainda.** O regime esta em `companies`
 * (`tax_regime`), mas aliquota, tabela de tarifas (RF-007) e limite de desconto
 * por papel (RF-008) nao. Esta porta existe para tornar essa falta explicita em
 * vez de espalhar valor chutado pelo caso de uso: quem implementa hoje devolve
 * a configuracao que tiver, e quando as tabelas existirem muda so o
 * implementador.
 */
export type SaleSettings = {
  readonly taxRules: TaxRules
  readonly cardFees: CardFeeTable
  /** Teto do papel de quem opera, ja resolvido — RF-008, RF-031. */
  readonly discountPolicy: DiscountPolicy
}

export type CompanySettingsRepository = {
  forSale(companyId: CompanyId, role: string): Promise<SaleSettings>
}

/** Produto como ele estava quando a venda foi fechada. */
export type SaleProductSnapshot = {
  readonly id: string
  readonly description: string
  readonly unitOfMeasure: string
  readonly salePriceCents: number
  readonly costPriceCents: number
  readonly stockQuantity: number
  readonly taxRate: number | null
}

export type SaleProductReader = {
  /**
   * Le os produtos da venda de uma vez.
   *
   * De uma vez, e nao um por item, por dois motivos: uma consulta por item num
   * carrinho de trinta produtos e trinta idas ao banco dentro de uma transacao
   * aberta — e transacao aberta por mais tempo e lock por mais tempo. E porque
   * a venda precisa decidir sobre o conjunto (algum item nao existe?) antes de
   * comecar a gravar.
   *
   * Devolve o que encontrou. Quem compara com o que foi pedido e o caso de uso:
   * saber que produto sumiu do cadastro e regra, nao consulta.
   */
  findManyByIds(ids: readonly string[]): Promise<readonly SaleProductSnapshot[]>
}

export type NewSaleItem = {
  readonly productId: string
  readonly description: string
  readonly unitOfMeasure: string
  readonly quantity: number
  readonly unitPriceCents: number
  readonly costPriceCents: number
  readonly discountCents: number
  readonly totalCents: number
}

export type NewSalePayment = {
  readonly method: PaymentMethod
  readonly amountCents: number
  readonly installments?: number | undefined
  readonly brand?: CardBrand | undefined
  readonly cardFeeCents: number
}

export type NewReceivable = {
  readonly description: string
  readonly customerId?: string | undefined
  readonly amountCents: number
  readonly netAmountCents: number
  /** AAAA-MM-DD. Vencimento ou data prevista de repasse. */
  readonly dueDate: string
  readonly installmentNumber: number
  readonly installmentCount: number
  /** `cash` e `pix` nascem liquidados; `credit` e `wallet`, em aberto — RF-064. */
  readonly settledAt?: string | undefined
  /**
   * Esta divida e do CLIENTE — RF-013, migration 0037.
   *
   * Decidido aqui, no nascimento, por `nasceComoDividaDoCliente`. Antes o
   * repositorio deduzia depois, de `MIN(p.method)` sobre os pagamentos da
   * venda — e numa venda mista o fiado saia lido como dinheiro.
   */
  readonly isCustomerDebt: boolean
}

export type NewSale = {
  readonly customerId?: string | undefined
  readonly channel: string
  readonly grossAmountCents: number
  readonly discountCents: number
  readonly taxAmountCents: number
  readonly cardFeeAmountCents: number
  readonly costAmountCents: number
  readonly netAmountCents: number
  readonly changeCents: number
  readonly notes?: string | undefined
  readonly idempotencyKey?: string | undefined
  readonly items: readonly NewSaleItem[]
  readonly payments: readonly NewSalePayment[]
  readonly receivables: readonly NewReceivable[]
  readonly createdBy: UserId
  readonly createdAt: Date
}

/** O que a venda gravada devolve. Numero e sequencial por empresa. */
/**
 * A venda como ela ficou gravada.
 *
 * Traz a decomposicao inteira — bruto, custo, imposto, tarifa e liquido — e nao
 * so bruto e liquido. US-020 pede exatamente esses numeros no resumo, e a
 * alternativa seria a tela recalcular a partir do carrinho: o mesmo calculo em
 * dois lugares, com o do cliente usando a tabela de tarifas que ele achar. Os
 * valores ja existem nas colunas de `sales`; o que faltava era devolve-los.
 */
export type RegisteredSale = {
  readonly id: string
  readonly number: number
  readonly grossAmountCents: number
  readonly costAmountCents: number
  readonly taxAmountCents: number
  readonly cardFeeAmountCents: number
  readonly netAmountCents: number
  readonly changeCents: number
  readonly createdAt: string
}

/**
 * Autoria da baixa de estoque feita pela venda — RF-024, NR-023.
 *
 * A baixa da venda e o movimento de estoque mais frequente da loja. Sem estes
 * tres campos ela seria o unico que nao entra na trilha, e a trilha passaria a
 * responder "por que o saldo caiu?" com um silencio exatamente onde a resposta
 * quase sempre esta.
 *
 * Vem como parametro, e nao lido do contexto pelo implementador, porque quem
 * implementa a porta e `db` — e `db` nao conhece `ExecutionContext`.
 */
export type StockMovementOrigin = {
  readonly saleId: string
  readonly createdBy: UserId
  readonly createdAt: Date
}

/**
 * Escopo transacional emprestado pelo `UnitOfWork`.
 *
 * Tudo aqui roda na MESMA transacao. Se qualquer passo falhar, nao sobra venda
 * pela metade — nem estoque baixado sem venda, nem recebivel de venda que nao
 * existe (RNF-046).
 */
/*
 * Inclui a trilha (NR-087): auditar aqui e auditar DENTRO da transacao.
 * O motivo esta em `TransactionalAuditTrail` — fora dela, a trilha
 * sobrevive ao rollback e passa a registrar o que nao aconteceu, e uma
 * segunda conexao por transacao esgota o pool.
 */
export type SaleTransaction = TransactionalAuditTrail & {
  readonly products: SaleProductReader

  /**
   * Grava venda, itens, pagamentos e recebiveis.
   *
   * Junto, e nao em quatro chamadas, porque nao existe estado intermediario
   * valido: venda sem item nao e venda, e recebivel sem venda e divida de
   * ninguem. Quem quiser gravar so a venda esta querendo outra coisa.
   */
  insertSale(sale: NewSale): Promise<RegisteredSale>

  /**
   * Baixa o estoque dos itens.
   *
   * Permite estoque negativo de proposito: RF-028 diz que o operador pode
   * prosseguir sem saldo, porque o balcao vende o que esta na prateleira e a
   * contagem do sistema atrasa. Recusar aqui seria travar a venda por causa de
   * um numero, e o produto esta na mao do cliente.
   */
  decreaseStock(
    itens: readonly { productId: string; quantity: number }[],
    origem: StockMovementOrigin,
  ): Promise<void>

  /**
   * Procura venda ja gravada com esta chave — RF-036, RNF-043.
   *
   * Dentro da transacao, e nao antes: entre uma consulta fora e a gravacao cabe
   * um segundo envio do PDV. O indice unico do banco e a garantia final; esta
   * consulta existe para o reenvio devolver a venda original em vez de um erro
   * de chave duplicada.
   */
  findByIdempotencyKey(key: string): Promise<RegisteredSale | undefined>

  /**
   * Soma no que o cliente deve — RF-013.
   *
   * Incremento, e nao valor absoluto, pelo mesmo motivo da baixa: aqui se sabe
   * QUANTO nasceu de divida, nao qual o saldo final. Ler para somar em
   * JavaScript abriria a corrida que o `+ delta` no proprio UPDATE evita.
   *
   * Nada chamava isto ate agora — o saldo so era DECREMENTADO, na baixa, no
   * cancelamento e na devolucao. Vender no fiado nao somava nada, entao o
   * filtro "Fiado" da lista (`wallet_balance_cents > 0`) nunca casava com
   * ninguem, e cancelar uma venda fiada deixava o saldo NEGATIVO.
   */
  adjustCustomerBalance(customerId: string, deltaCents: number): Promise<void>
}

export type UnitOfWork = {
  /**
   * Abre a transacao com o tenant do contexto definido e empresta o escopo.
   *
   * `companyId` explicito na assinatura, e nao implicito: e ele que vira
   * `app.company_id` na sessao, e a politica de RLS nao funciona sem isso
   * (ADR-0001). Quem implementa e `packages/db`, com `withTenant`.
   */
  transaction<T>(companyId: CompanyId, fn: (tx: SaleTransaction) => Promise<T>): Promise<T>
}
