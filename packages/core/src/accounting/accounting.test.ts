import type { DreOutput } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ExecutionContext } from '../context.js'
import type { LancamentoClassificado } from '../ports/chart-of-accounts.js'
import { buildDre } from './build-dre.js'
import { classifyEntry, suggestAccount } from './classify.js'
import { PLANO_DE_CONTAS_PADRAO } from './default-chart.js'
import { InMemoryChartOfAccounts } from './fakes.js'
import { createAccount, deleteAccount, renameAccount } from './manage-accounts.js'

const AGORA = new Date('2026-09-02T12:00:00.000Z')

function contexto(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: 'empresa-1',
    userId: 'usuario-1',
    role: 'owner',
    channel: 'app',
    requestId: 'req-1',
    now: AGORA,
    ...over,
  }
}

function cenario() {
  const accounts = new InMemoryChartOfAccounts()
  const audit = new InMemoryAuditTrail()
  accounts.semearPadrao('empresa-1')
  return { deps: { accounts, audit }, accounts, audit }
}

const lanc = (
  over: Partial<LancamentoClassificado> & Pick<LancamentoClassificado, 'accountType'>,
): LancamentoClassificado => ({
  entryKind: 'payable',
  entryId: 'ent-x',
  accountId: 'acc-1',
  accountName: 'Conta',
  amountCents: 10_000,
  occurredOn: '2026-09-10',
  ...over,
})

/** As linhas que vieram de lancamento — sem as fixas zeradas (impostos e tarifas). */
const comMovimento = (dre: DreOutput) => dre.lines.filter((l) => l.entryCount > 0)

describe('plano de contas padrao — RF-081', () => {
  it('cobre os quatro tipos do DRE', () => {
    const tipos = new Set(PLANO_DE_CONTAS_PADRAO.map((c) => c.type))
    expect([...tipos].sort()).toEqual(['cost', 'deduction', 'expense', 'revenue'])
  })

  /* Curto de proposito: escolher entre trezentas opcoes e mais dificil que
     escolher entre catorze. */
  it('e curto o bastante para alguem escolher', () => {
    expect(PLANO_DE_CONTAS_PADRAO.length).toBeLessThanOrEqual(20)
  })

  it('nao tem nome repetido', () => {
    const nomes = PLANO_DE_CONTAS_PADRAO.map((c) => c.name)
    expect(new Set(nomes).size).toBe(nomes.length)
  })

  it('as contas semeadas nascem marcadas como padrao', async () => {
    const c = cenario()

    const contas = await c.accounts.list('empresa-1')

    expect(contas.every((x) => x.isDefault)).toBe(true)
  })
})

describe('editar o plano — RF-082', () => {
  it('cria conta nova, que nasce apagavel', async () => {
    const c = cenario()

    const conta = await createAccount(c.deps, contexto(), { name: 'Combustivel', type: 'expense' })

    expect(conta.isDefault).toBe(false)
  })

  /* Duas contas "Aluguel" fazem o DRE mostrar duas linhas de aluguel, e o
     lojista conclui que pagou duas vezes. */
  it('recusa nome repetido', async () => {
    const c = cenario()

    try {
      await createAccount(c.deps, contexto(), { name: 'Aluguel', type: 'expense' })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('CONFLICT')
    }
  })

  it('renomear conta do plano padrao e PERMITIDO', async () => {
    const c = cenario()
    const energia = c.accounts.contaPorNome('empresa-1', 'Energia, água e internet')!

    const r = await renameAccount(c.deps, contexto(), {
      accountId: energia.id,
      name: 'Contas fixas',
    })

    expect(r.name).toBe('Contas fixas')
  })

  it('renomear para um nome que ja existe e recusado', async () => {
    const c = cenario()
    const energia = c.accounts.contaPorNome('empresa-1', 'Energia, água e internet')!

    await expect(
      renameAccount(c.deps, contexto(), { accountId: energia.id, name: 'Aluguel' }),
    ).rejects.toThrow()
  })

  it('renomear para o proprio nome nao e colisao', async () => {
    const c = cenario()
    const aluguel = c.accounts.contaPorNome('empresa-1', 'Aluguel')!

    const r = await renameAccount(c.deps, contexto(), { accountId: aluguel.id, name: 'Aluguel' })

    expect(r.name).toBe('Aluguel')
  })

  it('conta do plano padrao nao pode ser apagada', async () => {
    const c = cenario()
    const aluguel = c.accounts.contaPorNome('empresa-1', 'Aluguel')!

    try {
      await deleteAccount(c.deps, contexto(), { accountId: aluguel.id })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('CONFLICT')
    }
  })

  it('conta criada a mao e sem lancamento pode ser apagada', async () => {
    const c = cenario()
    const nova = await createAccount(c.deps, contexto(), { name: 'Combustivel', type: 'expense' })

    await deleteAccount(c.deps, contexto(), { accountId: nova.id })

    expect(await c.accounts.findById('empresa-1', nova.id)).toBeUndefined()
  })

  /**
   * O coracao da RF-082. Apagar a conta faria os lancamentos dela sumirem da
   * linha e o resultado do mes JA FECHADO mudar — e relatorio que muda depois
   * de fechado nao serve para decidir nada.
   */
  it('conta com lancamento nao pode ser apagada, e a mensagem diz quantos', async () => {
    const c = cenario()
    const nova = await createAccount(c.deps, contexto(), { name: 'Combustivel', type: 'expense' })
    c.accounts.registrarHistorico('empresa-1', 'payable', 'Posto', nova.id, 42)

    try {
      await deleteAccount(c.deps, contexto(), { accountId: nova.id })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.message).toContain('42')
    }
  })

  it('conta de outra empresa responde NOT_FOUND', async () => {
    const c = cenario()
    const aluguel = c.accounts.contaPorNome('empresa-1', 'Aluguel')!

    try {
      await deleteAccount(c.deps, contexto({ companyId: 'empresa-2' }), { accountId: aluguel.id })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
    }
  })
})

describe('classificar — RF-083', () => {
  it('grava a classificacao', async () => {
    const c = cenario()
    const aluguel = c.accounts.contaPorNome('empresa-1', 'Aluguel')!

    await classifyEntry(c.deps, contexto(), {
      entryKind: 'payable',
      entryId: 'pay-1',
      accountId: aluguel.id,
    })

    expect(await c.accounts.countEntries('empresa-1', aluguel.id)).toBe(1)
  })

  it('recusa conta que nao existe', async () => {
    const c = cenario()

    try {
      await classifyEntry(c.deps, contexto(), {
        entryKind: 'payable',
        entryId: 'pay-1',
        accountId: 'acc-inexistente',
      })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
    }
  })

  it('accountant nao classifica', async () => {
    const c = cenario()
    const aluguel = c.accounts.contaPorNome('empresa-1', 'Aluguel')!

    await expect(
      classifyEntry(c.deps, contexto({ role: 'accountant' }), {
        entryKind: 'payable',
        entryId: 'pay-1',
        accountId: aluguel.id,
      }),
    ).rejects.toThrow()
  })
})

describe('sugerir pelo historico — RF-084', () => {
  it('sugere a conta mais usada pela mesma contraparte', async () => {
    const c = cenario()
    const energia = c.accounts.contaPorNome('empresa-1', 'Energia, água e internet')!
    c.accounts.registrarHistorico('empresa-1', 'payable', 'Copel', energia.id, 11)

    const s = await suggestAccount(c.deps, contexto(), {
      entryKind: 'payable',
      counterparty: 'Copel',
    })

    expect(s?.account.id).toBe(energia.id)
    expect(s?.times).toBe(11)
  })

  it('a confianca sai em pontos', async () => {
    const c = cenario()
    const energia = c.accounts.contaPorNome('empresa-1', 'Energia, água e internet')!
    const outras = c.accounts.contaPorNome('empresa-1', 'Outras despesas')!
    c.accounts.registrarHistorico('empresa-1', 'payable', 'Copel', energia.id, 8)
    c.accounts.registrarHistorico('empresa-1', 'payable', 'Copel', outras.id, 2)

    const s = await suggestAccount(c.deps, contexto(), {
      entryKind: 'payable',
      counterparty: 'Copel',
    })

    expect(s?.confidencePoints).toBe(80)
  })

  /* Sugerir a primeira conta da lista seria um palpite com cara de
     recomendacao. Sem historico, sem sugestao. */
  it('sem historico nao sugere nada', async () => {
    const c = cenario()

    const s = await suggestAccount(c.deps, contexto(), {
      entryKind: 'payable',
      counterparty: 'Fornecedor novo',
    })

    expect(s).toBeUndefined()
  })

  it('nao sugere conta apagada depois de classificar', async () => {
    const c = cenario()
    const nova = await createAccount(c.deps, contexto(), { name: 'Combustivel', type: 'expense' })
    c.accounts.registrarHistorico('empresa-1', 'payable', 'Posto', nova.id, 5)
    await c.accounts.remove('empresa-1', nova.id)

    const s = await suggestAccount(c.deps, contexto(), {
      entryKind: 'payable',
      counterparty: 'Posto',
    })

    expect(s).toBeUndefined()
  })

  it('nao mistura historico de outra empresa', async () => {
    const c = cenario()
    const energia = c.accounts.contaPorNome('empresa-1', 'Energia, água e internet')!
    c.accounts.registrarHistorico('empresa-2', 'payable', 'Copel', energia.id, 9)

    const s = await suggestAccount(c.deps, contexto(), {
      entryKind: 'payable',
      counterparty: 'Copel',
    })

    expect(s).toBeUndefined()
  })

  /* Somente leitura nao e sem acesso. */
  it('accountant recebe sugestao', async () => {
    const c = cenario()
    const energia = c.accounts.contaPorNome('empresa-1', 'Energia, água e internet')!
    c.accounts.registrarHistorico('empresa-1', 'payable', 'Copel', energia.id, 3)

    const s = await suggestAccount(c.deps, contexto({ role: 'accountant' }), {
      entryKind: 'payable',
      counterparty: 'Copel',
    })

    expect(s?.account.id).toBe(energia.id)
  })
})

describe('DRE do periodo — RF-085, RF-086', () => {
  function comLancamentos(...ls: LancamentoClassificado[]) {
    const c = cenario()
    for (const l of ls) c.accounts.adicionarLancamento('empresa-1', l)
    return c
  }

  const periodo = { from: '2026-09-01', to: '2026-09-30' }

  it('fecha o resultado do periodo', async () => {
    const c = comLancamentos(
      lanc({ accountType: 'revenue', amountCents: 1_000_000 }),
      lanc({ accountType: 'deduction', amountCents: 80_000 }),
      lanc({ accountType: 'cost', amountCents: 600_000 }),
      lanc({ accountType: 'expense', amountCents: 200_000 }),
    )

    const dre = await buildDre(c.deps, contexto(), periodo)

    expect(dre.grossRevenueCents).toBe(1_000_000)
    expect(dre.resultCents).toBe(120_000)
    expect(dre.grossMarginPoints).toBe(32)
  })

  /* Achado do QA: margem bruta 100% porque a venda nao entrava no DRE. */
  it('a venda abre linhas proprias, com imposto e custo da mercadoria', async () => {
    const venda = (
      accountName: string,
      accountType: LancamentoClassificado['accountType'],
      amountCents: number,
    ) =>
      lanc({
        entryKind: 'sale',
        entryId: 'v1',
        accountId: null,
        accountName,
        accountType,
        amountCents,
      })
    const c = comLancamentos(
      venda('vendas', 'revenue', 10_000),
      venda('impostos', 'deduction', 600),
      venda('cmv', 'cost', 6_000),
      venda('tarifas_cartao', 'expense', 300),
    )

    const dre = await buildDre(c.deps, contexto(), periodo)

    expect(dre.lines.map((l) => [l.accountName, l.amountCents])).toEqual(
      expect.arrayContaining([
        ['Vendas', 10_000],
        ['Impostos sobre vendas', 600],
        ['Custo das mercadorias vendidas', 6_000],
        ['Tarifas de cartão', 300],
      ]),
    )
    expect(dre.resultCents).toBe(3_100)
    expect(dre.grossMarginPoints).not.toBe(100)
  })

  /**
   * DRE gerencial — achado do QA: "Vendas Bruta, Desconto, Venda Liquida /
   * Custos Variaveis, Impostos, Tarifas de Cartao / Margem de Contribuicao /
   * (-) Plano de Conta / Resultado Operacional".
   */
  it('monta o formato da margem de contribuicao, com o mesmo resultado', async () => {
    const venda = (
      accountName: string,
      accountType: LancamentoClassificado['accountType'],
      amountCents: number,
    ) =>
      lanc({
        entryKind: 'sale',
        entryId: 'v1',
        accountId: null,
        accountName,
        accountType,
        amountCents,
      })
    const c = comLancamentos(
      venda('vendas', 'revenue', 10_000),
      venda('descontos', 'deduction', 500),
      venda('devolucoes', 'deduction', 200),
      venda('impostos', 'deduction', 600),
      venda('cmv', 'cost', 5_000),
      venda('tarifas_cartao', 'expense', 300),
      lanc({
        accountId: 'acc-1',
        accountName: 'Aluguel',
        accountType: 'expense',
        amountCents: 1_500,
      }),
      lanc({
        accountId: 'acc-2',
        accountName: 'Energia',
        accountType: 'expense',
        amountCents: 400,
      }),
      lanc({
        accountId: 'acc-3',
        accountName: 'Frete sobre compra',
        accountType: 'cost',
        amountCents: 100,
      }),
      lanc({
        accountId: 'acc-4',
        accountName: 'Outras receitas',
        accountType: 'revenue',
        amountCents: 1_000,
      }),
    )

    const dre = await buildDre(c.deps, contexto(), periodo)

    expect(dre.grossRevenueCents).toBe(11_000)
    expect(dre.discountsCents).toBe(700)
    expect(dre.netSalesCents).toBe(10_300)
    /* imposto 600 + tarifa 300 + mercadoria 5.000 + frete 100 */
    expect(dre.variableCostsCents).toBe(6_000)
    expect(dre.contributionMarginCents).toBe(4_300)
    /* 4.300 / 10.300 = 41,747...% */
    expect(dre.contributionMarginPoints).toBe(41.75)
    expect(dre.operatingExpensesCents).toBe(1_900)
    expect(dre.operatingResultCents).toBe(2_400)
    expect(dre.operatingResultCents).toBe(dre.resultCents)

    expect(dre.lines.map((l) => [l.group, l.accountName])).toEqual([
      ['sales', 'Vendas'],
      ['sales', 'Outras receitas'],
      ['discounts', 'Descontos concedidos'],
      ['discounts', 'Devoluções'],
      ['variable_costs', 'Impostos sobre vendas'],
      ['variable_costs', 'Tarifas de cartão'],
      ['variable_costs', 'Custo das mercadorias vendidas'],
      ['variable_costs', 'Frete sobre compra'],
      ['expenses', 'Aluguel'],
      ['expenses', 'Energia'],
    ])
  })

  it('deducao do plano: devolucao abate a venda, imposto e taxa sao custo variavel', async () => {
    const c = comLancamentos(
      lanc({
        accountId: 'd1',
        accountName: 'Devoluções e cancelamentos',
        accountType: 'deduction',
        amountCents: 100,
      }),
      lanc({
        accountId: 'd2',
        accountName: 'Impostos sobre venda',
        accountType: 'deduction',
        amountCents: 200,
      }),
      lanc({
        accountId: 'd3',
        accountName: 'Taxas de cartão',
        accountType: 'deduction',
        amountCents: 300,
      }),
    )

    const dre = await buildDre(c.deps, contexto(), periodo)
    const grupo = (nome: string) => dre.lines.find((l) => l.accountName === nome)?.group

    expect(grupo('Devoluções e cancelamentos')).toBe('discounts')
    expect(grupo('Impostos sobre venda')).toBe('variable_costs')
    expect(grupo('Taxas de cartão')).toBe('variable_costs')
    expect(dre.discountsCents).toBe(100)
    expect(dre.variableCostsCents).toBe(500)
  })

  it('nao traz lancamento de fora do periodo', async () => {
    const c = comLancamentos(
      lanc({ accountType: 'revenue', amountCents: 100_000, occurredOn: '2026-09-15' }),
      lanc({ accountType: 'revenue', amountCents: 999_999, occurredOn: '2026-10-01' }),
    )

    const dre = await buildDre(c.deps, contexto(), periodo)

    expect(dre.grossRevenueCents).toBe(100_000)
  })

  it('inclui os extremos do periodo', async () => {
    const c = comLancamentos(
      lanc({ accountType: 'revenue', amountCents: 10_000, occurredOn: '2026-09-01' }),
      lanc({ accountType: 'revenue', amountCents: 20_000, occurredOn: '2026-09-30' }),
    )

    const dre = await buildDre(c.deps, contexto(), periodo)

    expect(dre.grossRevenueCents).toBe(30_000)
  })

  it('agrupa uma linha por conta, com a contagem — RF-086', async () => {
    const c = comLancamentos(
      lanc({
        accountId: 'acc-9',
        accountName: 'Aluguel',
        accountType: 'expense',
        amountCents: 200_000,
      }),
      lanc({
        accountId: 'acc-9',
        accountName: 'Aluguel',
        accountType: 'expense',
        amountCents: 100_000,
      }),
    )

    const dre = await buildDre(c.deps, contexto(), periodo)
    const aluguel = dre.lines.find((l) => l.accountId === 'acc-9')

    expect(aluguel?.amountCents).toBe(300_000)
    expect(aluguel?.entryCount).toBe(2)
  })

  /**
   * Somar as linhas tem de dar o total. Esconder o nao classificado faria o
   * lojista ver um relatorio cujas linhas nao fecham com o resultado.
   */
  it('lancamento sem conta aparece numa linha propria, nao some', async () => {
    const c = comLancamentos(
      lanc({ accountId: null, accountName: '', accountType: 'expense', amountCents: 50_000 }),
    )

    const dre = await buildDre(c.deps, contexto(), periodo)

    expect(dre.expensesCents).toBe(50_000)
    const semConta = dre.lines.find((l) => l.group === 'expenses')
    expect(semConta?.accountName).toBe('Sem classificação')
    expect(semConta?.amountCents).toBe(50_000)
  })

  /* Sem a chave por tipo, uma despesa e uma receita nao classificadas cairiam
     na mesma linha e o relatorio somaria as duas. */
  it('nao classificados de tipos diferentes nao caem na mesma linha', async () => {
    const c = comLancamentos(
      lanc({ accountId: null, accountName: '', accountType: 'expense', amountCents: 50_000 }),
      lanc({ accountId: null, accountName: '', accountType: 'revenue', amountCents: 70_000 }),
    )

    const dre = await buildDre(c.deps, contexto(), periodo)

    expect(comMovimento(dre)).toHaveLength(2)
    expect(dre.expensesCents).toBe(50_000)
    expect(dre.grossRevenueCents).toBe(70_000)
  })

  it('ordena por tipo e, dentro do tipo, do maior para o menor', async () => {
    const c = comLancamentos(
      lanc({
        accountId: 'a',
        accountName: 'Marketing',
        accountType: 'expense',
        amountCents: 10_000,
      }),
      lanc({ accountId: 'b', accountName: 'Aluguel', accountType: 'expense', amountCents: 90_000 }),
      lanc({ accountId: 'c', accountName: 'Venda', accountType: 'revenue', amountCents: 5_000 }),
    )

    const dre = await buildDre(c.deps, contexto(), periodo)

    expect(comMovimento(dre).map((l) => l.accountName)).toEqual(['Venda', 'Aluguel', 'Marketing'])
  })

  it('periodo sem movimento devolve zeros e so as linhas fixas, zeradas', async () => {
    const c = cenario()

    const dre = await buildDre(c.deps, contexto(), periodo)

    expect(dre.resultCents).toBe(0)
    /* Impostos e tarifas de cartao sao linhas fixas do formato pedido pelo QA:
       aparecem zeradas, e nenhuma outra. */
    expect(dre.lines.map((l) => [l.accountName, l.amountCents, l.entryCount])).toEqual([
      ['Impostos sobre vendas', 0, 0],
      ['Tarifas de cartão', 0, 0],
    ])
    expect(dre.grossMarginPoints).toBeNull()
  })

  it('o DRE de uma loja nao traz lancamento da outra', async () => {
    const c = cenario()
    c.accounts.adicionarLancamento('empresa-2', lanc({ accountType: 'revenue', amountCents: 999 }))

    const dre = await buildDre(c.deps, contexto(), periodo)

    expect(dre.grossRevenueCents).toBe(0)
  })

  it('accountant abre o relatorio — e quem mais abre', async () => {
    const c = comLancamentos(lanc({ accountType: 'revenue', amountCents: 100_000 }))

    const dre = await buildDre(c.deps, contexto({ role: 'accountant' }), periodo)

    expect(dre.grossRevenueCents).toBe(100_000)
  })
})
