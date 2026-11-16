import type { DreGroup, DreInput, DreLine, DreOutput } from '@na-regua/contracts'
import {
  calcularDre,
  calcularDreGerencial,
  type GrupoDoDre,
  type LancamentoDoPeriodo,
} from '@na-regua/domain'
import type { ExecutionContext } from '../context.js'
import type {
  ChartOfAccountsRepository,
  LancamentoClassificado,
} from '../ports/chart-of-accounts.js'

export type BuildDreDeps = {
  readonly accounts: ChartOfAccountsRepository
}

/** Conta que o DRE usa para o que ninguem classificou. */
const SEM_CLASSIFICACAO = 'Sem classificação'

/**
 * As linhas que a VENDA abre no DRE. Sem elas, o DRE so via titulos: imposto,
 * tarifa e custo da mercadoria ficavam de fora e a margem bruta saia 100%
 * (achado do QA).
 */
const ROTULO_DA_VENDA: Readonly<Record<string, string>> = {
  vendas: 'Vendas',
  descontos: 'Descontos concedidos',
  devolucoes: 'Devoluções',
  impostos: 'Impostos sobre vendas',
  cmv: 'Custo das mercadorias vendidas',
  tarifas_cartao: 'Tarifas de cartão',
}

/**
 * Ordem das linhas da VENDA dentro do bloco, no formato pedido pelo QA:
 * "Custos variaveis — Impostos, Tarifas de cartao", e o custo da mercadoria
 * depois. As contas do plano vem em seguida, da maior para a menor.
 */
const ORDEM_DA_VENDA: readonly string[] = [
  'vendas',
  'descontos',
  'devolucoes',
  'impostos',
  'tarifas_cartao',
  'cmv',
]

/** Conta de deducao que e abatimento da venda, e nao custo que cresce com ela. */
const E_DESCONTO = /devolu|desconto|abatimento|cancelamento/i

/**
 * O bloco do DRE gerencial de cada lancamento — achado do QA.
 *
 * A venda chega com codigo, e o codigo decide: bruto e venda; desconto e
 * devolucao abatem a venda; imposto, tarifa e mercadoria sao custos que
 * crescem com ela. As contas do plano vao pelo tipo: receita e venda, custo e
 * custo variavel, despesa e despesa. A DEDUCAO se divide: "Devolucoes e
 * cancelamentos" abate a venda; "Impostos sobre venda" e "Taxas de cartao"
 * (as outras deducoes do plano padrao) sao custo variavel.
 */
function grupoDe(l: LancamentoClassificado): GrupoDoDre {
  if (l.entryKind === 'sale') {
    if (l.accountName === 'vendas') return 'vendas'
    if (l.accountName === 'descontos' || l.accountName === 'devolucoes') return 'descontos'
    return 'custos_variaveis'
  }
  switch (l.accountType) {
    case 'revenue':
      return 'vendas'
    case 'deduction':
      return E_DESCONTO.test(l.accountName ?? '') ? 'descontos' : 'custos_variaveis'
    case 'cost':
      return 'custos_variaveis'
    case 'expense':
      return 'despesas'
  }
}

const PARA_O_CONTRATO: Readonly<Record<GrupoDoDre, DreGroup>> = {
  vendas: 'sales',
  descontos: 'discounts',
  custos_variaveis: 'variable_costs',
  despesas: 'expenses',
}

/**
 * DRE do periodo, com as linhas que compoem cada total — RF-085, RF-086.
 *
 * Leitura: nao passa por `assertCanWrite`. `accountant` e somente leitura, e e
 * quem mais abre este relatorio.
 *
 * A ordem das subtracoes vem de `domain` (`calcularDre`), e nao daqui, porque e
 * exatamente a parte que nao pode variar entre a tela do web, o resumo do
 * assistente (RF-108) e a exportacao do contador.
 */
export async function buildDre(
  deps: BuildDreDeps,
  ctx: ExecutionContext,
  input: DreInput,
): Promise<DreOutput> {
  const lancamentos = await deps.accounts.entriesBetween(ctx.companyId, input.from, input.to)

  const dre = calcularDre(lancamentos.map(paraDomain))
  const gerencial = calcularDreGerencial(
    lancamentos.map((l) => ({ grupo: grupoDe(l), amountCents: l.amountCents })),
  )

  return {
    from: input.from,
    to: input.to,
    grossRevenueCents: Number(dre.receitaBruta.cents),
    deductionsCents: Number(dre.deducoes.cents),
    netRevenueCents: Number(dre.receitaLiquida.cents),
    costCents: Number(dre.custo.cents),
    grossProfitCents: Number(dre.lucroBruto.cents),
    expensesCents: Number(dre.despesas.cents),
    resultCents: Number(dre.resultado.cents),
    grossMarginPoints: dre.margemBrutaPontos,
    discountsCents: Number(gerencial.descontos.cents),
    netSalesCents: Number(gerencial.vendaLiquida.cents),
    variableCostsCents: Number(gerencial.custosVariaveis.cents),
    contributionMarginCents: Number(gerencial.margemDeContribuicao.cents),
    contributionMarginPoints: gerencial.margemDeContribuicaoPontos,
    operatingExpensesCents: Number(gerencial.despesas.cents),
    operatingResultCents: Number(gerencial.resultadoOperacional.cents),
    lines: agruparPorConta(lancamentos),
  }
}

const paraDomain = (l: LancamentoClassificado): LancamentoDoPeriodo => ({
  tipo: l.accountType,
  amountCents: l.amountCents,
})

/**
 * As linhas do relatorio — RF-086, o "clique para detalhar".
 *
 * Uma linha por conta, com o total e a CONTAGEM de lancamentos. A contagem, e
 * nao os lancamentos em si: um mes movimentado tem milhares, e devolve-los
 * todos junto com o DRE faria a tela de resumo carregar o detalhe que ninguem
 * pediu ainda. O clique busca os lancamentos daquela conta.
 *
 * Lancamento sem conta aparece numa linha propria em vez de sumir. Some-lo
 * mudaria o total do DRE — que continua somando tudo, classificado ou nao — e
 * o lojista veria um relatorio cujas linhas nao fecham com o resultado.
 */
function agruparPorConta(lancamentos: readonly LancamentoClassificado[]): DreLine[] {
  const porConta = new Map<string, DreLine>()
  const codigoDaVenda = new Map<string, string | null>()

  for (const l of lancamentos) {
    /* `null` vira uma chave propria por TIPO: sem isso, uma despesa e uma
       receita nao classificadas cairiam na mesma linha. A venda abre uma
       linha por componente (bruto, imposto, custo...). */
    const chave =
      l.entryKind === 'sale'
        ? `venda:${l.accountName}`
        : (l.accountId ?? `sem-conta:${l.accountType}`)
    const atual = porConta.get(chave)

    if (atual === undefined) {
      codigoDaVenda.set(chave, l.entryKind === 'sale' ? l.accountName : null)
      porConta.set(chave, {
        accountId: l.accountId,
        accountName:
          l.entryKind === 'sale'
            ? (ROTULO_DA_VENDA[l.accountName] ?? l.accountName)
            : l.accountId === null
              ? SEM_CLASSIFICACAO
              : l.accountName,
        type: l.accountType,
        group: PARA_O_CONTRATO[grupoDe(l)],
        amountCents: l.amountCents,
        entryCount: 1,
      })
      continue
    }

    porConta.set(chave, {
      ...atual,
      amountCents: atual.amountCents + l.amountCents,
      entryCount: atual.entryCount + 1,
    })
  }

  /* Impostos e tarifas de cartao sao linhas FIXAS do formato pedido pelo QA
     ("Custos Variaveis / Impostos / Tarifas de Cartao"): aparecem zeradas
     quando o periodo nao teve — mes sem nota emitida nao tem imposto (NR-185),
     e a linha zerada diz isso; a linha sumida deixaria a duvida. */
  for (const [codigo, tipo] of [
    ['impostos', 'deduction'],
    ['tarifas_cartao', 'expense'],
  ] as const) {
    const chave = `venda:${codigo}`
    if (porConta.has(chave)) continue
    codigoDaVenda.set(chave, codigo)
    porConta.set(chave, {
      accountId: null,
      accountName: ROTULO_DA_VENDA[codigo]!,
      type: tipo,
      group: 'variable_costs',
      amountCents: 0,
      entryCount: 0,
    })
  }

  /* Na ordem do DRE gerencial (o bloco), e dentro do bloco: primeiro as linhas
     da venda, na ordem do formato pedido; depois as contas do plano, da maior
     para a menor — quem abre o relatorio quer ver primeiro a despesa que mais
     pesou. */
  const blocos: readonly DreGroup[] = ['sales', 'discounts', 'variable_costs', 'expenses']
  const posicaoNaVenda = (chave: string) => {
    const codigo = codigoDaVenda.get(chave) ?? null
    return codigo === null ? ORDEM_DA_VENDA.length : ORDEM_DA_VENDA.indexOf(codigo)
  }
  return [...porConta.entries()]
    .sort(
      ([ca, a], [cb, b]) =>
        blocos.indexOf(a.group) - blocos.indexOf(b.group) ||
        posicaoNaVenda(ca) - posicaoNaVenda(cb) ||
        b.amountCents - a.amountCents,
    )
    .map(([, linha]) => linha)
}
