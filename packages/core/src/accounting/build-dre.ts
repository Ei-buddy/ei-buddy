import type { AccountType, DreInput, DreLine, DreOutput } from '@na-regua/contracts'
import { calcularDre, type LancamentoDoPeriodo } from '@na-regua/domain'
import type { ExecutionContext } from '../context.js'
import type {
  ChartOfAccountsRepository,
  LancamentoClassificado,
} from '../ports/chart-of-accounts.js'

export type BuildDreDeps = {
  readonly accounts: ChartOfAccountsRepository
}

/** Conta que o DRE usa para o que ninguem classificou. */
const SEM_CLASSIFICACAO = 'Sem classificacao'

/**
 * As linhas que a VENDA abre no DRE. Sem elas, o DRE so via titulos: imposto,
 * tarifa e custo da mercadoria ficavam de fora e a margem bruta saia 100%
 * (achado do QA).
 */
const ROTULO_DA_VENDA: Readonly<Record<string, string>> = {
  vendas: 'Vendas',
  descontos: 'Descontos concedidos',
  devolucoes: 'Devolucoes',
  impostos: 'Impostos sobre vendas',
  cmv: 'Custo das mercadorias vendidas',
  tarifas_cartao: 'Tarifas de cartao',
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
      porConta.set(chave, {
        accountId: l.accountId,
        accountName:
          l.entryKind === 'sale'
            ? (ROTULO_DA_VENDA[l.accountName] ?? l.accountName)
            : l.accountId === null
              ? SEM_CLASSIFICACAO
              : l.accountName,
        type: l.accountType,
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

  /* Na ordem do DRE, e dentro do tipo do maior para o menor: quem abre o
     relatorio quer ver primeiro a despesa que mais pesou. */
  const ordem: readonly AccountType[] = ['revenue', 'deduction', 'cost', 'expense']
  return [...porConta.values()].sort(
    (a, b) => ordem.indexOf(a.type) - ordem.indexOf(b.type) || b.amountCents - a.amountCents,
  )
}
