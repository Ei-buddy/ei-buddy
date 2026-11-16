import { Money } from '@na-regua/money'
import { DomainError } from './domain-error.js'

/**
 * DRE simplificado — RF-085. US-041: "saber se o mes fechou no azul".
 *
 * **Regime de competencia, nao de caixa.** A decisao muda o numero, entao vale
 * dizer o que ela significa: a venda entra no dia em que aconteceu, mesmo que o
 * cartao so caia em trinta dias; a despesa entra no vencimento, mesmo que ainda
 * nao tenha sido paga.
 *
 * Por que assim, e nao pelo caixa — que seria mais intuitivo para o lojista:
 * um mes com muita venda no credito pareceria pessimo pelo caixa e otimo pelo
 * seguinte, sem que nada tivesse mudado no negocio. O DRE existe para responder
 * "o mes deu lucro", e essa resposta nao pode depender de quando o dinheiro
 * passeia entre contas. A pergunta "quanto tenho hoje" e outra, e o relatorio
 * dela e o fluxo de caixa.
 */

/** Para onde cada lancamento vai no relatorio. */
export type TipoDeConta = 'revenue' | 'deduction' | 'cost' | 'expense'

export type LancamentoDoPeriodo = {
  readonly tipo: TipoDeConta
  /** Sempre positivo: o SINAL vem do tipo, nao do valor. */
  readonly amountCents: number
}

export type Dre = {
  readonly receitaBruta: Money
  /** Imposto sobre venda, tarifa de cartao, devolucao. */
  readonly deducoes: Money
  readonly receitaLiquida: Money
  /** CMV — custo do que saiu do estoque. */
  readonly custo: Money
  readonly lucroBruto: Money
  /** Aluguel, energia, folha: o que nao varia com a venda. */
  readonly despesas: Money
  readonly resultado: Money
  /**
   * Margem bruta em PONTOS por cem (18 = 18%), como `marginRate` em
   * `SaleTotals` e como `rateSchema` em contracts. Fracao de um lado e ponto do
   * outro e um erro de 100x esperando a primeira tela.
   *
   * `null` quando nao houve receita: dividir por zero daria `Infinity`, e uma
   * tela que mostra "margem: Infinity%" e pior que uma que mostra "—".
   */
  readonly margemBrutaPontos: number | null
}

/**
 * Monta o DRE a partir dos lancamentos ja classificados do periodo — RF-085.
 *
 * Recebe classificado, e nao classifica: decidir que uma conta e despesa ou
 * custo depende do plano de contas da empresa, que e dado, e `domain` nao le
 * dado. Aqui e so a ordem das subtracoes — que e exatamente a parte que nao
 * pode variar entre a tela do web, o resumo do assistente (RF-108) e a
 * exportacao do contador.
 */
export function calcularDre(lancamentos: readonly LancamentoDoPeriodo[]): Dre {
  for (const l of lancamentos) {
    if (!Number.isInteger(l.amountCents) || l.amountCents < 0) {
      /* Valor negativo aqui viraria uma despesa que aumenta o lucro. O sinal e
         responsabilidade do TIPO; quem tem estorno manda o estorno como
         lancamento proprio, nao como numero negativo. */
      throw new DomainError(
        'INVALID_DRE_ENTRY',
        'Lancamento do DRE precisa ter valor inteiro e nao negativo.',
      )
    }
  }

  const somaDe = (tipo: TipoDeConta): Money =>
    Money.sum(lancamentos.filter((l) => l.tipo === tipo).map((l) => Money.fromCents(l.amountCents)))

  const receitaBruta = somaDe('revenue')
  const deducoes = somaDe('deduction')
  const custo = somaDe('cost')
  const despesas = somaDe('expense')

  const receitaLiquida = receitaBruta.subtract(deducoes)
  const lucroBruto = receitaLiquida.subtract(custo)
  const resultado = lucroBruto.subtract(despesas)

  return {
    receitaBruta,
    deducoes,
    receitaLiquida,
    custo,
    lucroBruto,
    despesas,
    resultado,
    margemBrutaPontos: margemEmPontos(lucroBruto, receitaBruta),
  }
}

/**
 * Margem bruta sobre a receita, em pontos.
 *
 * Arredonda para duas casas, e nao para inteiro: entre 12,4% e 12,6% ha
 * diferenca que o lojista enxerga na conta do mes.
 */
function margemEmPontos(lucroBruto: Money, receitaBruta: Money): number | null {
  if (receitaBruta.isZero()) return null
  const razao = Number(lucroBruto.cents) / Number(receitaBruta.cents)
  return Math.round(razao * 100 * 100) / 100
}

/**
 * Em que bloco do DRE gerencial cada lancamento entra — achado do QA, que pediu
 * o DRE no formato da margem de contribuicao.
 */
export type GrupoDoDre = 'vendas' | 'descontos' | 'custos_variaveis' | 'despesas'

export type LancamentoGerencial = {
  readonly grupo: GrupoDoDre
  /** Sempre positivo: o SINAL vem do grupo, nao do valor. */
  readonly amountCents: number
}

export type DreGerencial = {
  readonly vendasBrutas: Money
  /** Descontos concedidos e devolucoes. */
  readonly descontos: Money
  readonly vendaLiquida: Money
  /** Imposto sobre a venda, tarifa de cartao, custo da mercadoria: crescem com a venda. */
  readonly custosVariaveis: Money
  readonly margemDeContribuicao: Money
  /** Margem de contribuicao sobre a venda liquida, em pontos. `null` sem venda. */
  readonly margemDeContribuicaoPontos: number | null
  /** As contas de despesa do plano: aluguel, energia, folha. */
  readonly despesas: Money
  readonly resultadoOperacional: Money
}

/**
 * DRE gerencial — o formato pedido pelo QA:
 *
 *     Vendas brutas
 *     (-) Descontos
 *     = Venda liquida
 *     (-) Custos variaveis (impostos, tarifas de cartao, mercadoria)
 *     = Margem de contribuicao
 *     (-) cada conta de despesa do plano
 *     = Resultado operacional
 *
 * Os MESMOS lancamentos do `calcularDre`, so reagrupados: o resultado
 * operacional e sempre igual ao resultado do DRE contabil. Quem decide o grupo
 * de cada lancamento e `core`, que conhece o plano de contas da empresa.
 */
export function calcularDreGerencial(lancamentos: readonly LancamentoGerencial[]): DreGerencial {
  for (const l of lancamentos) {
    if (!Number.isInteger(l.amountCents) || l.amountCents < 0) {
      throw new DomainError(
        'INVALID_DRE_ENTRY',
        'Lancamento do DRE precisa ter valor inteiro e nao negativo.',
      )
    }
  }

  const somaDe = (grupo: GrupoDoDre): Money =>
    Money.sum(
      lancamentos.filter((l) => l.grupo === grupo).map((l) => Money.fromCents(l.amountCents)),
    )

  const vendasBrutas = somaDe('vendas')
  const descontos = somaDe('descontos')
  const custosVariaveis = somaDe('custos_variaveis')
  const despesas = somaDe('despesas')

  const vendaLiquida = vendasBrutas.subtract(descontos)
  const margemDeContribuicao = vendaLiquida.subtract(custosVariaveis)

  return {
    vendasBrutas,
    descontos,
    vendaLiquida,
    custosVariaveis,
    margemDeContribuicao,
    margemDeContribuicaoPontos: margemEmPontos(margemDeContribuicao, vendaLiquida),
    despesas,
    resultadoOperacional: margemDeContribuicao.subtract(despesas),
  }
}
