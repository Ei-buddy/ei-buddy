import type { BankTransactionDirection, EntryKind, SuggestMatchesInput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import type {
  LancamentoConciliavel,
  ReconciliationQueries,
  ReconciliationUnitOfWork,
} from '../ports/reconciliation-repository.js'

export type ReconciliationDeps = {
  readonly uow: ReconciliationUnitOfWork
  readonly queries: ReconciliationQueries
  /*
   * Sem `audit` aqui desde a NR-087.
   *
   * A auditoria deste caso de uso acontece DENTRO da transacao, por
   * `tx.record` — ver `TransactionalAuditTrail`. Manter a trilha nas
   * dependencias faria todo construtor montar uma que ninguem usa, e o proximo
   * leitor suporia que o caso de uso audita por ali.
   */
}

/**
 * Quantos dias antes e depois do vencimento o extrato ainda conta.
 *
 * Existe janela na DATA e nao existe no VALOR, e a assimetria e o ponto:
 *
 * - data desliza por motivo bancario. Conta agendada para o dia 10 que cai num
 *   sabado e debitada na segunda; boleto pago no caixa aparece no extrato no
 *   dia seguinte. Nada aconteceu com o dinheiro — mudou o dia do registro.
 * - valor diferente e informacao. Faltaram R$ 12: houve multa, desconto, taxa,
 *   ou o titulo esta errado. Cada um desses e um fato que alguem precisa
 *   registrar, e absorver a diferenca dentro de uma conciliacao a esconderia
 *   no unico estado em que ninguem olha de novo — o de "conferido".
 *
 * Cinco dias cobrem feriado prolongado com fim de semana em volta, que e o
 * maior atraso normal.
 */
export const JANELA_DE_DIAS = 5

/** Uma sugestao de casamento, com o quanto o sistema confia nela. */
export type SugestaoDeConciliacao = {
  readonly entry: LancamentoConciliavel
  /** Quantos dias de diferenca entre o vencimento e o lancamento no banco. */
  readonly daysApart: number
  /** Confianca em pontos (100 = mesmo dia e sem concorrente). */
  readonly confidencePoints: number
  /** O valor que se esperava ver no extrato: liquido quando ha taxa. */
  readonly expectedAmountCents: number
}

/**
 * Sugere lancamentos compativeis com uma transacao do extrato — RF-078.
 *
 * **Sugere, nao concilia.** O mesmo motivo de `suggestAccount`: aplicar sozinho
 * economiza um toque e cria um erro que ninguem revisou dentro do registro que
 * serve justamente para provar que os numeros batem.
 *
 * Devolve lista vazia quando nada bate — e diferente de sugerir o mais
 * proximo, que seria um palpite com cara de conferencia. Fila vazia manda o
 * lojista para o caminho certo, que e criar o lancamento (RF-079).
 */
export async function suggestMatches(
  deps: ReconciliationDeps,
  ctx: ExecutionContext,
  input: SuggestMatchesInput,
): Promise<readonly SugestaoDeConciliacao[]> {
  /* Leitura: `accountant` concilia de olho como qualquer um. Escrever, nao. */
  const transacao = await deps.uow.transaction(ctx.companyId, (tx) =>
    tx.findTransaction(ctx.companyId, input.transactionId),
  )

  if (transacao === undefined) throw AppError.notFound('Transação não encontrada.')

  /* Conciliada nao tem sugestao: ela ja tem resposta. Devolver candidatos aqui
     convidaria a trocar por outro sem passar pelo desfazer, e o desfazer e o
     que deixa rastro (RF-080). */
  if (transacao.reconciledEntryId !== null) return []

  const kind = tipoQueCasaCom(transacao.direction)

  const { de, ate } = janela(transacao.postedOn)
  const candidatos = await deps.queries.findCandidates(ctx.companyId, kind, de, ate)

  const compativeis = candidatos
    .filter((c) => !c.reconciled && c.status !== 'cancelled')
    .map((c) => ({ entry: c, esperado: valorEsperadoNoBanco(c) }))
    .filter((c) => c.esperado === transacao.amountCents)
    .map((c) => ({
      entry: c.entry,
      expectedAmountCents: c.esperado,
      daysApart: Math.abs(diferencaEmDias(c.entry.dueDate, transacao.postedOn)),
    }))

  return comConfianca(compativeis)
}

/**
 * Debito casa com conta a pagar, credito com recebivel.
 *
 * Filtro rigido, e nao mais um ponto de confianca. Uma saida de dinheiro nao
 * pode corresponder a algo que alguem devia a loja, por mais que o valor e a
 * data batam — seria conciliar dois fatos opostos e dar a conferencia como
 * feita.
 */
function tipoQueCasaCom(direction: BankTransactionDirection): EntryKind {
  return direction === 'debit' ? 'payable' : 'receivable'
}

/**
 * O que se espera encontrar no extrato.
 *
 * Liquido quando existe, bruto quando nao. Sem isto, nenhuma venda no cartao
 * conciliaria: o recebivel de R$ 100 chega como R$ 97,50 e a diferenca e a taxa
 * que o sistema ja calculou na venda. Nao e tolerancia de valor — e comparar
 * com o numero certo.
 */
function valorEsperadoNoBanco(entry: LancamentoConciliavel): number {
  return entry.netAmountCents ?? entry.amountCents
}

function janela(postedOn: string): { de: string; ate: string } {
  return {
    de: somaDias(postedOn, -JANELA_DE_DIAS),
    ate: somaDias(postedOn, JANELA_DE_DIAS),
  }
}

/**
 * Aritmetica de data em UTC, sobre `AAAA-MM-DD`.
 *
 * `Date.UTC` e nao `new Date(iso)` com fuso local: vencimento e dia, nao
 * instante, e somar dias no fuso de Sao Paulo faria a janela deslizar meio dia
 * — o suficiente para incluir ou excluir uma conta na borda dela.
 */
function somaDias(data: string, dias: number): string {
  const [a, m, d] = data.split('-').map(Number)
  const t = Date.UTC(a!, m! - 1, d!) + dias * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

function diferencaEmDias(de: string, ate: string): number {
  const emMs = (s: string) => {
    const [a, m, d] = s.split('-').map(Number)
    return Date.UTC(a!, m! - 1, d!)
  }
  return Math.round((emMs(ate) - emMs(de)) / 86_400_000)
}

/**
 * Confianca por proximidade de data, dividida entre indistinguiveis.
 *
 * Duas partes:
 *
 * 1. **Distancia.** Mesmo dia vale 100, e cada dia de diferenca custa dez
 *    pontos. Nao e estatistica: e ordenacao com um numero que o lojista
 *    interpreta sem manual.
 * 2. **Empate.** Duas contas de R$ 480 vencendo no mesmo dia sao
 *    indistinguiveis pelos dados que existem — o sistema NAO sabe qual e. Dar
 *    100% para as duas seria mentir com precisao. A confianca do grupo empatado
 *    e dividida entre seus membros: duas viram 50, tres viram 33.
 *
 * O efeito pratico e o que interessa: a tela que mostra "50%" em duas linhas
 * iguais faz o lojista abrir e conferir, que e exatamente o que ele deve fazer
 * nesse caso. Um "100%" nas duas o faria clicar na primeira.
 */
function comConfianca(
  itens: readonly {
    entry: LancamentoConciliavel
    daysApart: number
    expectedAmountCents: number
  }[],
): readonly SugestaoDeConciliacao[] {
  const quantosNaDistancia = new Map<number, number>()
  for (const i of itens) {
    quantosNaDistancia.set(i.daysApart, (quantosNaDistancia.get(i.daysApart) ?? 0) + 1)
  }

  return itens
    .map((i) => ({
      ...i,
      confidencePoints: Math.round((100 - i.daysApart * 10) / quantosNaDistancia.get(i.daysApart)!),
    }))
    .sort(
      (a, b) =>
        b.confidencePoints - a.confidencePoints ||
        a.daysApart - b.daysApart ||
        /* Desempate estavel: sem ele, duas sugestoes de confianca igual sairiam
           em ordem de banco, que muda entre consultas e faria a tela embaralhar
           sozinha entre dois carregamentos. */
        a.entry.id.localeCompare(b.entry.id),
    )
}
