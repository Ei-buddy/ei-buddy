import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { CreateSaleInput, Role } from '@na-regua/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import { FakeCompanySettingsRepository, InMemoryUnitOfWork } from './fakes.js'
import { registerSale } from './register-sale.js'

const AGORA = new Date('2026-09-02T13:00:00.000Z')
const EMPRESA = 'emp-1'

function contexto(sobrescreve: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: EMPRESA,
    userId: 'usr-1',
    role: 'owner' as Role,
    channel: 'app',
    requestId: 'req-1',
    now: AGORA,
    ...sobrescreve,
  }
}

let unitOfWork: InMemoryUnitOfWork
const settings = new FakeCompanySettingsRepository()
const deps = () => ({ unitOfWork, settings })

/** Cafe a R$ 19,90, custo R$ 12,00, 10 em estoque. */
const CAFE = {
  id: 'prod-cafe',
  description: 'Cafe torrado 500g',
  unitOfMeasure: 'un',
  salePriceCents: 1990,
  costPriceCents: 1200,
  stockQuantity: 10,
  taxRate: null,
}

function venda(sobrescreve: Partial<CreateSaleInput> = {}): CreateSaleInput {
  return {
    items: [{ productId: CAFE.id, quantity: 1, unitPriceCents: 1990 }],
    payments: [{ method: 'cash', amountCents: 1990 }],
    ...sobrescreve,
  }
}

beforeEach(() => {
  unitOfWork = new InMemoryUnitOfWork(new InMemoryAuditTrail())
  unitOfWork.adicionarProduto(EMPRESA, CAFE)
  /* Cliente com fiado liberado ate R$ 50,00. */
  unitOfWork.definirLimite('cli-1', 5000)
})

describe('registerSale — o caminho comum', () => {
  it('grava a venda com os totais calculados por domain', async () => {
    const r = await registerSale(deps(), contexto(), venda())

    expect(r.replayed).toBe(false)
    expect(r.sale.grossAmountCents).toBe(1990)
    /* 6% de imposto sobre 19,90 = 1,19; liquido = 18,71. Dinheiro nao tem
       tarifa de cartao. */
    expect(r.sale.netAmountCents).toBe(1990 - 119)
  })

  it('numera a venda por empresa', async () => {
    await registerSale(deps(), contexto(), venda())
    const segunda = await registerSale(deps(), contexto(), venda())
    expect(segunda.sale.number).toBe(2)

    const outraLoja = await registerSale(
      { unitOfWork, settings },
      contexto({ companyId: 'emp-2' }),
      venda(),
    ).catch((e) => e)
    /* A outra loja nao ve o produto, entao a venda nem chega a numerar — o
       importante e nao ter herdado a sequencia da primeira. */
    expect(isAppError(outraLoja) && outraLoja.code).toBe('NOT_FOUND')
  })

  it('baixa o estoque na mesma operacao', async () => {
    await registerSale(
      deps(),
      contexto(),
      venda({
        items: [{ productId: CAFE.id, quantity: 3, unitPriceCents: 1990 }],
        payments: [{ method: 'cash', amountCents: 5970 }],
      }),
    )

    expect(unitOfWork.estoque.get(CAFE.id)).toBe(7)
  })

  /**
   * A baixa da venda e o movimento de estoque mais frequente da loja — RF-024.
   * Sem esta linha, a trilha responderia "por que o saldo caiu?" com silencio
   * exatamente onde a resposta quase sempre esta.
   */
  it('a baixa deixa rastro na trilha, com a venda e quem operou', async () => {
    const resultado = await registerSale(
      deps(),
      contexto({ userId: 'joana' }),
      venda({
        items: [{ productId: CAFE.id, quantity: 3, unitPriceCents: 1990 }],
        payments: [{ method: 'cash', amountCents: 5970 }],
      }),
    )

    expect(unitOfWork.movimentos).toHaveLength(1)
    const [mov] = unitOfWork.movimentos
    expect(mov?.kind).toBe('sale')
    expect(mov?.quantityDelta).toBe(-3)
    expect(mov?.balanceAfter).toBe(7)
    expect(mov?.saleId).toBe(resultado.sale.id)
    expect(mov?.createdBy).toBe('joana')
  })

  it('guarda o preco praticado e o custo do cadastro', async () => {
    /* O balcao negociou 15,00 num produto de 19,90. */
    await registerSale(
      deps(),
      contexto(),
      venda({
        items: [{ productId: CAFE.id, quantity: 1, unitPriceCents: 1500 }],
        payments: [{ method: 'cash', amountCents: 1500 }],
      }),
    )

    const item = unitOfWork.vendas[0]!.dados.items[0]!
    expect(item.unitPriceCents).toBe(1500)
    /* Custo vem do cadastro: custo nao se negocia na hora. */
    expect(item.costPriceCents).toBe(1200)
  })
})

describe('o saldo do fiado — RF-013', () => {
  /*
   * O bug que este bloco tranca: nada somava no saldo quando a divida nascia.
   * So a baixa, o cancelamento e a devolucao mexiam, e os tres para MENOS —
   * entao o filtro "Fiado" da lista (`wallet_balance_cents > 0`) nunca casava
   * com ninguem, e cancelar uma venda fiada levava o saldo a negativo.
   */
  it('venda no fiado soma no que o cliente deve', async () => {
    await registerSale(
      deps(),
      contexto(),
      venda({
        customerId: 'cli-1',
        payments: [{ method: 'wallet', amountCents: 1990 }],
      }),
    )

    expect(unitOfWork.saldoDe('cli-1')).toBe(1990)
  })

  it('venda em dinheiro nao soma: nao ha divida', async () => {
    await registerSale(deps(), contexto(), venda({ customerId: 'cli-1' }))

    expect(unitOfWork.saldoDe('cli-1')).toBe(0)
  })

  /*
   * O caso que a deducao por `MIN(p.method)` errava: metade agora, metade
   * fiado. `MIN('cash','wallet')` e `'cash'`, entao o "Fiado" da venda era
   * lido como recebimento em dinheiro — e so a parte fiada e divida.
   */
  it('venda mista soma so a parte fiada', async () => {
    await registerSale(
      deps(),
      contexto(),
      venda({
        customerId: 'cli-1',
        payments: [
          { method: 'cash', amountCents: 990 },
          { method: 'wallet', amountCents: 1000 },
        ],
      }),
    )

    expect(unitOfWork.saldoDe('cli-1')).toBe(1000)
  })

  /* Venda no fiado sem cliente nao existe — o contrato ja recusa —, mas sem
     cliente nao ha saldo de ninguem para mexer. */
  it('sem cliente, nada e somado', async () => {
    await registerSale(deps(), contexto(), venda())

    expect(unitOfWork.saldoDe('cli-1')).toBe(0)
  })
})

describe('o limite do fiado — RF-013', () => {
  const fiado = (amountCents: number) =>
    venda({
      customerId: 'cli-1',
      items: [{ productId: CAFE.id, quantity: 1, unitPriceCents: amountCents }],
      payments: [{ method: 'wallet', amountCents }],
    })

  it('recusa a venda que passa do limite e nao grava nada', async () => {
    await registerSale(deps(), contexto(), fiado(4000))

    const erro = await registerSale(deps(), contexto(), fiado(1990)).catch((e) => e)

    expect(isAppError(erro) && erro.code).toBe('VALIDATION_FAILED')
    expect(String(erro.message)).toContain('ainda cabem R$ 10,00')
    expect(unitOfWork.saldoDe('cli-1')).toBe(4000)
    expect(unitOfWork.vendas).toHaveLength(1)
  })

  it('cliente sem limite nao vende no fiado', async () => {
    unitOfWork.definirLimite('cli-2', 0)

    const erro = await registerSale(deps(), contexto(), {
      ...fiado(1990),
      customerId: 'cli-2',
    }).catch((e) => e)

    expect(String(erro.message)).toContain('nao tem fiado liberado')
  })

  it('cliente que nao existe da 404, nao 500', async () => {
    const erro = await registerSale(deps(), contexto(), {
      ...fiado(1990),
      customerId: 'cli-x',
    }).catch((e) => e)

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })
})

describe('pagamento — RF-034, RF-037', () => {
  it('recusa quando a soma dos pagamentos nao fecha o total', async () => {
    const erro = await registerSale(
      deps(),
      contexto(),
      venda({ payments: [{ method: 'pix', amountCents: 1000 }] }),
    ).catch((e) => e)

    /* Regra de negocio, nao falha inesperada: se a excecao de `domain` subisse
       crua, o handler responderia 500 para "faltam R$ 9,90". */
    expect(isAppError(erro)).toBe(true)
    expect(isAppError(erro) && erro.code).toBe('VALIDATION_FAILED')
  })

  it('aceita pagamento dividido entre formas', async () => {
    const r = await registerSale(
      deps(),
      contexto(),
      venda({
        payments: [
          { method: 'pix', amountCents: 1000 },
          { method: 'cash', amountCents: 990 },
        ],
      }),
    )

    expect(r.sale.grossAmountCents).toBe(1990)
    expect(unitOfWork.vendas[0]!.dados.payments).toHaveLength(2)
  })

  it('calcula troco e registra apenas o que fica na gaveta — RF-035', async () => {
    const r = await registerSale(
      deps(),
      contexto(),
      venda({ payments: [{ method: 'cash', amountCents: 5000 }] }),
    )

    expect(r.sale.changeCents).toBe(5000 - 1990)
    /*
     * O pagamento gravado e 19,90, nao 50,00. Registrar os 50 infliaria o
     * faturamento do dia em 30,10 — e o caixa fecharia errado justamente onde
     * alguem confere.
     */
    expect(unitOfWork.vendas[0]!.dados.payments[0]!.amountCents).toBe(1990)
  })

  it('nao da troco em pix', async () => {
    /* Pix nao "paga a mais e devolve em especie"; tratar assim esconderia erro
       de digitacao virando saida de caixa. */
    const erro = await registerSale(
      deps(),
      contexto(),
      venda({ payments: [{ method: 'pix', amountCents: 5000 }] }),
    ).catch((e) => e)

    expect(isAppError(erro) && erro.code).toBe('VALIDATION_FAILED')
  })

  it('exige cliente no fiado — RF-033', async () => {
    const erro = await registerSale(
      deps(),
      contexto(),
      venda({ payments: [{ method: 'wallet', amountCents: 1990 }] }),
    ).catch((e) => e)

    expect(isAppError(erro) && erro.message).toMatch(/fiado exige cliente/i)
  })
})

describe('recebiveis — RF-038, RF-063, RF-064', () => {
  it('cash nasce liquidado', async () => {
    await registerSale(deps(), contexto(), venda())

    const [rec] = unitOfWork.vendas[0]!.dados.receivables
    expect(rec?.settledAt).toBe(AGORA.toISOString())
    expect(rec?.netAmountCents).toBe(1990)
  })

  it('wallet fica em aberto', async () => {
    await registerSale(
      deps(),
      contexto(),
      venda({
        customerId: 'cli-1',
        payments: [{ method: 'wallet', amountCents: 1990 }],
      }),
    )

    const [rec] = unitOfWork.vendas[0]!.dados.receivables
    expect(rec?.settledAt).toBeUndefined()
    expect(rec?.customerId).toBe('cli-1')
  })

  it('debito desconta a tarifa do liquido previsto', async () => {
    await registerSale(
      deps(),
      contexto(),
      venda({ payments: [{ method: 'debit', amountCents: 1990, brand: 'visa' }] }),
    )

    const [rec] = unitOfWork.vendas[0]!.dados.receivables
    /* 2% de 19,90 = 0,398 -> 0,40 (arredonda). Liquido = 19,50. */
    expect(rec?.amountCents).toBe(1990)
    expect(rec?.netAmountCents).toBeLessThan(1990)
    expect(rec?.settledAt).toBeUndefined()
  })

  it('gera um recebivel por parcela no credito — RF-038', async () => {
    await registerSale(
      deps(),
      contexto(),
      venda({
        items: [{ productId: CAFE.id, quantity: 1, unitPriceCents: 30000 }],
        payments: [{ method: 'credit', amountCents: 30000, installments: 3, brand: 'visa' }],
      }),
    )

    const recebiveis = unitOfWork.vendas[0]!.dados.receivables
    expect(recebiveis).toHaveLength(3)
    expect(recebiveis.map((r) => r.installmentNumber)).toEqual([1, 2, 3])

    /* A soma das parcelas e exatamente o pagamento — RNF-045, Money.allocate. */
    expect(recebiveis.reduce((s, r) => s + r.amountCents, 0)).toBe(30000)

    /* Vencimentos escalonados: 30, 60, 90 dias. */
    expect(recebiveis.map((r) => r.dueDate)).toEqual(['2026-10-02', '2026-11-01', '2026-12-01'])
  })
})

describe('idempotencia — RF-036', () => {
  it('reenvio com a mesma chave devolve a venda original', async () => {
    const entrada = venda()
    const comChave = contexto({ idempotencyKey: 'pdv-abc' })

    const primeira = await registerSale(deps(), comChave, entrada)
    const segunda = await registerSale(deps(), comChave, entrada)

    expect(segunda.sale.id).toBe(primeira.sale.id)
    /* A distincao importa: sem ela a tela mostraria "venda registrada" duas
       vezes para o mesmo fato. */
    expect(segunda.replayed).toBe(true)
    expect(unitOfWork.vendas).toHaveLength(1)
  })

  it('reenvio nao baixa o estoque de novo', async () => {
    const entrada = venda()
    const comChave = contexto({ idempotencyKey: 'pdv-xyz' })

    await registerSale(deps(), comChave, entrada)
    await registerSale(deps(), comChave, entrada)

    /* Baixar duas vezes deixaria o estoque devendo uma unidade que nao saiu. */
    expect(unitOfWork.estoque.get(CAFE.id)).toBe(9)
  })

  it('venda sem chave nao colide com outra sem chave', async () => {
    await registerSale(deps(), contexto(), venda())
    await registerSale(deps(), contexto(), venda())
    expect(unitOfWork.vendas).toHaveLength(2)
  })
})

describe('atomicidade — RNF-046', () => {
  it('falha no meio nao deixa venda nem baixa de estoque', async () => {
    unitOfWork.falharDepoisDeGravar = true

    await expect(registerSale(deps(), contexto(), venda())).rejects.toThrow(/falha simulada/)

    /*
     * O ponto da RNF-046. A venda foi gravada e o passo seguinte falhou; se a
     * transacao nao desfizesse, sobraria venda sem baixa de estoque — ou pior,
     * estoque baixado sem venda.
     */
    expect(unitOfWork.vendas).toHaveLength(0)
    expect(unitOfWork.estoque.get(CAFE.id)).toBe(10)
  })
})

describe('estoque e produto', () => {
  it('avisa da falta de saldo e deixa prosseguir — RF-028', async () => {
    const r = await registerSale(
      deps(),
      contexto(),
      venda({
        items: [{ productId: CAFE.id, quantity: 15, unitPriceCents: 1990 }],
        payments: [{ method: 'cash', amountCents: 29850 }],
      }),
    )

    /* O produto esta na mao do cliente; recusar por causa de um numero
       travaria a venda. */
    expect(r.stockWarnings).toEqual([
      { productId: CAFE.id, description: CAFE.description, requested: 15, available: 10 },
    ])
    expect(unitOfWork.estoque.get(CAFE.id)).toBe(-5)
  })

  it('recusa venda de produto que nao existe, sem dizer qual id', async () => {
    const erro = await registerSale(
      deps(),
      contexto(),
      venda({ items: [{ productId: 'prod-fantasma', quantity: 1, unitPriceCents: 100 }] }),
    ).catch((e) => e)

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
    /* Listar o id confirmaria a existencia de algo que o RLS acabou de
       esconder — produto de outra empresa responde igual a inexistente. */
    expect(isAppError(erro) && erro.message).not.toContain('prod-fantasma')
  })

  it('nao vende produto de outra empresa', async () => {
    unitOfWork.adicionarProduto('emp-2', { ...CAFE, id: 'prod-da-outra' })

    const erro = await registerSale(
      deps(),
      contexto(),
      venda({ items: [{ productId: 'prod-da-outra', quantity: 1, unitPriceCents: 1990 }] }),
    ).catch((e) => e)

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })
})

describe('desconto no total — RF-031', () => {
  /* O PDV oferecia "Dar desconto" e a venda era recusada no fechamento. */
  it('grava o desconto e o bruto, e os pagamentos fecham o total com desconto', async () => {
    const r = await registerSale(
      deps(),
      contexto(),
      venda({ discountCents: 100, payments: [{ method: 'cash', amountCents: 1890 }] }),
    )

    expect(r.sale.grossAmountCents).toBe(1990)
    expect(r.sale.discountCents).toBe(100)
    /* Imposto sobre os 18,90 cobrados: 6% = 1,13. */
    expect(r.sale.taxAmountCents).toBe(113)
  })

  it('recusa desconto acima da alcada do papel', async () => {
    /* Teto do falso: 10%. R$ 5,00 em R$ 19,90 sao 25%. */
    const erro = await registerSale(
      deps(),
      contexto(),
      venda({ discountCents: 500, payments: [{ method: 'cash', amountCents: 1490 }] }),
    ).catch((e) => e)

    expect(isAppError(erro) && erro.code).toBe('VALIDATION_FAILED')
  })

  it('recusa pagamento que ignora o desconto', async () => {
    const erro = await registerSale(
      deps(),
      contexto(),
      venda({ discountCents: 100, payments: [{ method: 'pix', amountCents: 1990 }] }),
    ).catch((e) => e)

    expect(isAppError(erro) && erro.message).toMatch(/desconto/i)
  })
})

describe('o que ainda nao existe, recusado em vez de calculado errado', () => {
  it('recusa acrescimo', async () => {
    const erro = await registerSale(deps(), contexto(), venda({ surchargeRate: 5 })).catch((e) => e)

    expect(isAppError(erro) && erro.message).toMatch(/acrescimo/i)
  })
})

describe('autorizacao', () => {
  it('recusa quem so pode ler', async () => {
    await expect(
      registerSale(deps(), contexto({ role: 'accountant' as Role }), venda()),
    ).rejects.toThrow(/somente de leitura/i)
  })
})
