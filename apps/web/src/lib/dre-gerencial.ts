import type { DreLine, DreOutput } from '@na-regua/contracts'

/*
 * COPIA de `linhasDoDreGerencial` do contrato: o web so importa TIPOS de
 * `@na-regua/contracts`, porque o bundler nao resolve os imports `.js` do
 * pacote em tempo de execucao. `dre-gerencial.test.ts` compara as duas contra
 * o contrato de verdade, e acusa no dia em que divergirem.
 */

/**
 * Uma linha do DRE gerencial, pronta para desenhar — achado do QA, que pediu:
 *
 *     Vendas Bruta
 *     Desconto
 *     Venda Liquida
 *     ____________
 *     Custos Variaveis
 *     Impostos
 *     Tarifas de Cartao
 *     ____________
 *     Margem de Contribuicao
 *     ____________
 *     (-) Plano de Conta R$
 *     (-) Plano de Conta R$
 *     ____________
 *     Resultado Operacional R$
 *
 * Mora em contracts porque a tela do web, a do app e a exportacao para o
 * contador precisam mostrar EXATAMENTE as mesmas linhas — tres montagens
 * diferentes acabariam discordando.
 */
export type LinhaDoDreGerencial = {
  readonly chave: string
  readonly rotulo: string
  /** Sempre o valor da linha; o sinal de "subtrai" vem no rotulo, `(−)`. */
  readonly valorCents: number
  /** `total` fecha um bloco; `detalhe` e a conta que compoe a linha acima. */
  readonly nivel: 'linha' | 'total' | 'detalhe'
  /** O traco do formato: comeca um bloco novo. */
  readonly separaAntes: boolean
  /** Quantos lancamentos compoem a conta — o "clique para detalhar" (RF-086). */
  readonly lancamentos?: number
  /** Texto de apoio: a margem em %, por exemplo. */
  readonly nota?: string
}

const MENOS = '(−) '

function detalhes(linhas: readonly DreLine[], grupo: DreLine['group']): LinhaDoDreGerencial[] {
  return linhas
    .filter((l) => l.group === grupo)
    .map((l, i) => ({
      chave: `${grupo}:${l.accountId ?? l.accountName}:${i}`,
      rotulo: l.accountName,
      valorCents: l.amountCents,
      nivel: 'detalhe' as const,
      separaAntes: false,
      lancamentos: l.entryCount,
    }))
}

/** Pontos por cem com virgula: 41.75 → "41,75%". */
const emPorcento = (pontos: number) => `${String(pontos).replace('.', ',')}%`

/**
 * As linhas do DRE gerencial na ordem do formato pedido. Os totais vem
 * prontos do servidor (`domain`); aqui so se decide a ordem e o rotulo.
 *
 * Detalhe aparece quando explica algo: vendas e descontos so abrem quando ha
 * mais de uma origem (venda + outras receitas; desconto + devolucao); os
 * custos variaveis abrem sempre — imposto e tarifa de cartao sao justamente o
 * que o lojista quer ver separado.
 */
export function linhasDoDreGerencial(dre: DreOutput): LinhaDoDreGerencial[] {
  const vendas = detalhes(dre.lines, 'sales')
  const descontos = detalhes(dre.lines, 'discounts')
  const variaveis = detalhes(dre.lines, 'variable_costs')
  const despesas = dre.lines.filter((l) => l.group === 'expenses')

  return [
    {
      chave: 'vendas',
      rotulo: 'Vendas brutas',
      valorCents: dre.grossRevenueCents,
      nivel: 'linha',
      separaAntes: false,
    },
    ...(vendas.length > 1 ? vendas : []),
    {
      chave: 'descontos',
      rotulo: `${MENOS}Descontos`,
      valorCents: dre.discountsCents,
      nivel: 'linha',
      separaAntes: false,
    },
    ...(descontos.length > 1 ? descontos : []),
    {
      chave: 'venda-liquida',
      rotulo: 'Venda líquida',
      valorCents: dre.netSalesCents,
      nivel: 'total',
      separaAntes: false,
    },
    {
      chave: 'custos-variaveis',
      rotulo: `${MENOS}Custos variáveis`,
      valorCents: dre.variableCostsCents,
      nivel: 'linha',
      separaAntes: true,
    },
    ...variaveis,
    {
      chave: 'margem',
      rotulo: 'Margem de contribuição',
      valorCents: dre.contributionMarginCents,
      nivel: 'total',
      separaAntes: true,
      ...(dre.contributionMarginPoints === null
        ? {}
        : { nota: `${emPorcento(dre.contributionMarginPoints)} da venda líquida` }),
    },
    ...(despesas.length === 0
      ? [
          {
            chave: 'despesas',
            rotulo: `${MENOS}Despesas do plano de contas`,
            valorCents: 0,
            nivel: 'linha' as const,
            separaAntes: true,
          },
        ]
      : despesas.map((l, i) => ({
          chave: `despesa:${l.accountId ?? l.accountName}:${i}`,
          rotulo: `${MENOS}${l.accountName}`,
          valorCents: l.amountCents,
          nivel: 'linha' as const,
          separaAntes: i === 0,
          lancamentos: l.entryCount,
        }))),
    {
      chave: 'resultado',
      rotulo: 'Resultado operacional',
      valorCents: dre.operatingResultCents,
      nivel: 'total',
      separaAntes: true,
    },
  ]
}
