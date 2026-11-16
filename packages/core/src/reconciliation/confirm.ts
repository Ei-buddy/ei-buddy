import type {
  AutoMatchOutput,
  AutoMatchPair,
  BankTransactionListItem,
  ConfirmReconciliationsInput,
  ConfirmReconciliationsOutput,
  EntryKind,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type {
  ConciliacaoComBaixaTransaction,
  LancamentoConciliavel,
} from '../ports/reconciliation-repository.js'
import { contaCadastrada, lancarBaixa } from '../settlements/settle.js'
import { conferePodeCasar, exigeBaixas, registra } from './regras.js'
import {
  comConfianca,
  diferencaEmDias,
  JANELA_DE_DIAS,
  janela,
  tipoQueCasaCom,
  valorEsperadoNoBanco,
  type ReconciliationDeps,
} from './suggest-matches.js'

/**
 * Conciliar da baixa — DEC-026 (decisao de 15/11).
 *
 * Antes, conciliar so ligava a linha do extrato ao titulo, e o titulo seguia
 * "em aberto" — a pessoa conferia o extrato inteiro e depois tinha de dar
 * baixa conta por conta, de novo. O fluxo decidido:
 *
 * 1. a loja importa o extrato;
 * 2. o sistema casa cada linha com uma conta a pagar ou a receber
 *    (`autoMatch`);
 * 3. extrato e contas ficam lado a lado, e a pessoa confirma cada par;
 * 4. no fim, o sistema da baixa em tudo o que foi confirmado
 *    (`confirmReconciliations`);
 * 5. **a ordem das baixas e a do extrato**, para os dois baterem na conferencia.
 *
 * O que continua igual: valor tem de bater exato (diferenca e informacao —
 * ver `JANELA_DE_DIAS`), e a baixa e a MESMA da tela de contas
 * (`lancarBaixa`), com as mesmas recusas.
 */

/**
 * A fila inteira casada, na ordem do extrato.
 *
 * O casamento e GLOBAL, e nao linha a linha: duas contas de R$ 480 e duas
 * linhas de R$ 480 no extrato — a linha do dia 10 fica com a conta que vence
 * no dia 10, e nao com a primeira que aparecer. Por isso os pares candidatos
 * sao ordenados pela distancia em dias antes de alguem ganhar um lancamento,
 * e cada lancamento vai para uma linha so.
 *
 * Sugere, nao concilia: a pessoa confirma cada par (passo 3).
 */
export async function autoMatch(
  deps: ReconciliationDeps,
  ctx: ExecutionContext,
): Promise<AutoMatchOutput> {
  const fila = await deps.queries.listTransactions(ctx.companyId, 'pending')
  if (fila.length === 0) return { pairs: [] }

  /* Duas leituras (uma por tipo) cobrindo a fila toda, e nao uma por linha: um
     extrato mensal tem centenas de linhas. */
  const datas = fila.map((t) => t.postedOn).sort()
  const de = janela(datas[0]!).de
  const ate = janela(datas[datas.length - 1]!).ate
  const porTipo = new Map<EntryKind, readonly LancamentoConciliavel[]>()
  for (const kind of new Set(fila.map((t) => tipoQueCasaCom(t.direction)))) {
    porTipo.set(kind, await deps.queries.findCandidates(ctx.companyId, kind, de, ate))
  }

  /* Para cada linha, os compativeis — com a confianca de `suggestMatches`. */
  const compativeisDe = fila.map((t) => {
    const kind = tipoQueCasaCom(t.direction)
    const itens = (porTipo.get(kind) ?? [])
      .filter((c) => !c.reconciled && c.status !== 'cancelled')
      .map((c) => ({
        entry: c,
        expectedAmountCents: valorEsperadoNoBanco(c),
        daysApart: Math.abs(diferencaEmDias(c.dueDate, t.postedOn)),
      }))
      .filter((c) => c.expectedAmountCents === t.amountCents && c.daysApart <= JANELA_DE_DIAS)
    return comConfianca(itens)
  })

  /* Arestas linha→lancamento, da mais proxima para a mais distante; empate
     fica com a linha que vem antes no extrato. */
  const arestas = compativeisDe
    .flatMap((lista, i) => lista.map((s) => ({ i, s })))
    .sort((a, b) => a.s.daysApart - b.s.daysApart || a.i - b.i)

  const escolhida = new Map<number, (typeof arestas)[number]['s']>()
  const usados = new Set<string>()
  for (const { i, s } of arestas) {
    if (escolhida.has(i) || usados.has(s.entry.id)) continue
    escolhida.set(i, s)
    usados.add(s.entry.id)
  }

  return {
    pairs: fila.map((t, i): AutoMatchPair => {
      const s = escolhida.get(i)
      return {
        transaction: semResumo(t),
        suggestion:
          s === undefined
            ? null
            : {
                entry: {
                  kind: s.entry.entryKind,
                  id: s.entry.id,
                  counterparty: s.entry.counterparty,
                  description: s.entry.description,
                  dueDate: s.entry.dueDate,
                  amountCents: s.entry.amountCents,
                  netAmountCents: s.entry.netAmountCents,
                },
                expectedAmountCents: s.expectedAmountCents,
                daysApart: s.daysApart,
                confidencePoints: s.confidencePoints,
                alternatives: compativeisDe[i]!.length - 1,
              },
      }
    }),
  }
}

/**
 * Confirma os pares conferidos e da baixa — DEC-026, passos 4 e 5.
 *
 * Tudo numa transacao so: um par que nao fecha (valor mudou, outra aba
 * conciliou, titulo cancelado) recusa a confirmacao inteira, e a mensagem diz
 * qual linha. Metade lancada deixaria extrato e contas fora de ordem.
 *
 * A ORDEM e a do extrato — a mesma da fila (data do banco e, no mesmo dia, a
 * posicao no arquivo), e nao a ordem em que os pares chegaram: a tela pode
 * mandar na ordem em que a pessoa clicou.
 */
export async function confirmReconciliations(
  deps: ReconciliationDeps,
  ctx: ExecutionContext,
  input: ConfirmReconciliationsInput,
): Promise<ConfirmReconciliationsOutput> {
  assertCanWrite(ctx)
  const baixas = exigeBaixas(deps)
  const conta = await contaCadastrada(deps.bankAccounts, ctx, input.bankAccount)

  const fila = await deps.queries.listTransactions(ctx.companyId, 'pending')
  const posicao = new Map(fila.map((t, i) => [t.id, i]))
  /* Fora da fila = ja conciliada ou de outra loja: a transacao recusa com a
     mensagem certa. Vai para o fim, para nao mudar a ordem das outras. */
  const pares = [...input.pairs].sort(
    (a, b) =>
      (posicao.get(a.transactionId) ?? Number.MAX_SAFE_INTEGER) -
      (posicao.get(b.transactionId) ?? Number.MAX_SAFE_INTEGER),
  )

  return baixas.transaction(ctx.companyId, async (tx) => {
    const order: ConfirmReconciliationsOutput['order'][number][] = []
    for (const par of pares) {
      order.push(await conciliarEBaixar(tx, ctx, par, conta))
    }
    return {
      reconciled: order.length,
      settled: order.filter((o) => o.settlementId !== null).length,
      order,
    }
  })
}

/**
 * Um par: confere, liga, e da baixa no que falta do titulo.
 *
 * Titulo ja quitado (o recebivel do cartao nasce liquidado, RF-064) so e
 * ligado — baixar de novo seria receber duas vezes. Titulo com baixa parcial
 * recebe o restante.
 */
export async function conciliarEBaixar(
  tx: ConciliacaoComBaixaTransaction,
  ctx: ExecutionContext,
  par: { transactionId: string; entryKind: EntryKind; entryId: string },
  conta: string,
): Promise<ConfirmReconciliationsOutput['order'][number]> {
  const transacao = await tx.findTransaction(ctx.companyId, par.transactionId)
  if (transacao === undefined) throw AppError.notFound('Transação não encontrada.')
  const linha = `${descreve(transacao.postedOn)} · ${transacao.description}`

  if (transacao.reconciledEntryId !== null) {
    throw AppError.conflict(`A linha ${linha} já está conciliada. Recarregue a tela.`)
  }

  const lancamento = await tx.findEntry(ctx.companyId, par.entryKind, par.entryId)
  if (lancamento === undefined)
    throw AppError.notFound(`Lançamento da linha ${linha} não encontrado.`)

  try {
    conferePodeCasar(transacao, lancamento, par.entryKind)
  } catch (erro) {
    /* A recusa ja diz o que houve; aqui ganha QUAL linha, que num lote de
       dezenas e a informacao que falta. */
    if (erro instanceof AppError) {
      throw new AppError(erro.code, `Linha ${linha}: ${erro.message}`, erro.fields)
    }
    throw erro
  }

  const casou = await tx.link(ctx.companyId, transacao.id, par.entryKind, lancamento.id, ctx.now)
  if (!casou) {
    throw AppError.conflict(`A linha ${linha} acabou de ser conciliada. Recarregue a tela.`)
  }

  const titulo =
    par.entryKind === 'payable'
      ? await tx.findPayable(ctx.companyId, lancamento.id)
      : await tx.findReceivable(ctx.companyId, lancamento.id)
  const falta = titulo === undefined ? 0 : titulo.amountCents - titulo.settledAmountCents

  let settlementId: string | null = null
  if (falta > 0) {
    const baixa = await lancarBaixa(tx, ctx, {
      kind: par.entryKind,
      tituloId: lancamento.id,
      amountCents: falta,
      /* O banco nao diz como o cliente pagou — e nao se inventa. */
      method: null,
      bankAccount: conta,
      /* O dia em que o dinheiro entrou ou saiu, e nao o dia da conferencia. */
      settledOn: transacao.postedOn,
      notes: `Conciliação do extrato: ${transacao.description}`.slice(0, 500),
    })
    settlementId = baixa.id
    await tx.setSettlement(ctx.companyId, transacao.id, settlementId)
  }

  await registra(tx, ctx, transacao, par.entryKind, lancamento.id, 'updated', {
    reconciledWith: lancamento.id,
    amountCents: transacao.amountCents,
    settlementId,
  })

  return {
    transactionId: transacao.id,
    entryKind: par.entryKind,
    entryId: lancamento.id,
    postedOn: transacao.postedOn,
    amountCents: transacao.amountCents,
    settlementId,
  }
}

function semResumo(t: BankTransactionListItem): AutoMatchPair['transaction'] {
  const { reconciledWith: _r, ...transacao } = t
  return transacao
}

/** "12/03" — o bastante para achar a linha no extrato. */
function descreve(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
}
