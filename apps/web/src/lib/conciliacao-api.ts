import { pedir, type Resultado } from './http'

/**
 * Conciliacao bancaria contra a api — NR-076, RF-076 a RF-080.
 *
 * Tudo passa pelo BFF em `/api/...`: o token da sessao fica num cookie
 * `httpOnly` e o navegador nunca fala com a api direto.
 */

export type DirecaoBancaria = 'debit' | 'credit'
export type TipoDeLancamento = 'payable' | 'receivable'

export type LancamentoConciliado = {
  kind: TipoDeLancamento
  id: string
  counterparty: string
  description: string
  dueDate: string
}

export type TransacaoBancaria = {
  id: string
  externalId: string
  direction: DirecaoBancaria
  /** Sempre positivo. Quem diz o sinal e `direction`. */
  amountCents: number
  postedOn: string
  description: string
  counterparty: string | null
  reconciledEntryKind: TipoDeLancamento | null
  reconciledEntryId: string | null
  /** A baixa que a conciliacao lancou — DEC-026. */
  settlementId: string | null
  /** Nulo na fila; preenchido no recorte das conciliadas. */
  reconciledWith: LancamentoConciliado | null
}

export type FilaDeConciliacao = {
  transactions: TransacaoBancaria[]
  /** Quantas faltam conferir, mesmo olhando as conciliadas. */
  pendingCount: number
}

export type Sugestao = {
  entry: {
    entryKind: TipoDeLancamento
    id: string
    counterparty: string
    description: string
    amountCents: number
    netAmountCents: number | null
    dueDate: string
    reconciled: boolean
    status: string
  }
  daysApart: number
  confidencePoints: number
  /** O que se esperava ver no extrato: liquido quando ha taxa. */
  expectedAmountCents: number
}

export type ResultadoDaImportacao = {
  imported: number
  ignored: number
  format: 'ofx' | 'csv'
  account: string | null
}

export type RecorteDaFila = 'pending' | 'reconciled'

/** A fila — NR-076. */
export const carregarFila = (scope: RecorteDaFila): Promise<Resultado<FilaDeConciliacao>> =>
  pedir<FilaDeConciliacao>(`/api/conciliacao/transacoes?scope=${scope}`)

/** Sugestoes de uma transacao — RF-078. Lista vazia e resposta legitima. */
export const carregarSugestoes = (
  transacaoId: string,
): Promise<Resultado<{ suggestions: Sugestao[] }>> =>
  pedir(`/api/conciliacao/transacoes/${transacaoId}/sugestoes`)

/**
 * Casar com um lancamento existente — RF-079. Com a conta do extrato, ja da a
 * baixa (DEC-026).
 */
export const conciliar = (
  transacaoId: string,
  entrada: { entryKind: TipoDeLancamento; entryId: string; bankAccount?: string },
): Promise<Resultado<{ reconciled: true }>> =>
  pedir(`/api/conciliacao/transacoes/${transacaoId}/conciliar`, {
    method: 'POST',
    body: JSON.stringify(entrada),
  })

/**
 * Criar o lancamento a partir da transacao — RF-079.
 *
 * Valor e data NAO entram: sao o extrato. O que o lojista informa e o que o
 * banco nao sabe — quem esta do outro lado e para que serviu.
 */
export const criarLancamentoDaTransacao = (
  transacaoId: string,
  entrada: { counterparty: string; description: string; bankAccount?: string },
): Promise<Resultado<{ entryKind: TipoDeLancamento; entryId: string }>> =>
  pedir(`/api/conciliacao/transacoes/${transacaoId}/lancamento`, {
    method: 'POST',
    body: JSON.stringify(entrada),
  })

/** Desfazer — RF-080. O motivo e obrigatorio. */
export const desfazerConciliacao = (
  transacaoId: string,
  reason: string,
): Promise<Resultado<{ undone: true }>> =>
  pedir(`/api/conciliacao/transacoes/${transacaoId}/desfazer`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })

/**
 * Importar o extrato — RF-076, RF-077.
 *
 * O arquivo vai em base64, e nao como texto. OFX de banco brasileiro costuma
 * vir em latin-1: `FileReader.readAsText` assumiria UTF-8 e "Manutencao"
 * chegaria corrompido no cadastro do fornecedor, sem erro nenhum. Ler os BYTES
 * e deixar a decodificacao com quem sabe qual e.
 */
export async function importarExtrato(arquivo: File): Promise<Resultado<ResultadoDaImportacao>> {
  const bytes = new Uint8Array(await arquivo.arrayBuffer())

  /*
   * Em pedacos: `String.fromCharCode(...bytes)` de uma vez estoura a pilha em
   * arquivo grande ("Maximum call stack size exceeded"), e o extrato grande e
   * exatamente o que o lojista sobe no fim do ano.
   */
  let binario = ''
  const PEDACO = 0x8000
  for (let i = 0; i < bytes.length; i += PEDACO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + PEDACO))
  }

  return pedir<ResultadoDaImportacao>('/api/extratos', {
    method: 'POST',
    body: JSON.stringify({ filename: arquivo.name, contentBase64: btoa(binario) }),
  })
}

/* -------------------------------------------------------------------------- */
/* Conciliar da baixa — DEC-026                                               */
/* -------------------------------------------------------------------------- */

/** Uma linha do extrato e o lancamento que o servidor casou com ela. */
export type ParAutomatico = {
  transaction: Omit<TransacaoBancaria, 'reconciledWith'>
  suggestion: {
    entry: LancamentoConciliado & { amountCents: number; netAmountCents: number | null }
    expectedAmountCents: number
    daysApart: number
    confidencePoints: number
    /** Quantos outros lancamentos tambem batiam — maior que zero pede conferir. */
    alternatives: number
  } | null
}

export type ResultadoDaConfirmacao = {
  reconciled: number
  settled: number
  order: {
    transactionId: string
    entryKind: TipoDeLancamento
    entryId: string
    postedOn: string
    amountCents: number
    settlementId: string | null
  }[]
}

/** A fila inteira casada pelo servidor, NA ORDEM DO EXTRATO. */
export const carregarCasamentoAutomatico = (): Promise<Resultado<{ pairs: ParAutomatico[] }>> =>
  pedir('/api/conciliacao/automatica')

/** Confirma os pares e da baixa, na ordem do extrato. Tudo ou nada. */
export const confirmarConciliacoes = (
  bankAccount: string,
  pares: { transactionId: string; entryKind: TipoDeLancamento; entryId: string }[],
): Promise<Resultado<ResultadoDaConfirmacao>> =>
  pedir('/api/conciliacao/confirmar', {
    method: 'POST',
    body: JSON.stringify({ bankAccount, pairs: pares }),
  })

/**
 * Os pares marcados, na ordem do extrato (a da lista) — e so os que tem
 * lancamento. A ordem final e do servidor; mandar ja nela deixa o pedido igual
 * ao que a pessoa viu.
 */
export function paresMarcados(
  pares: ParAutomatico[],
  marcados: ReadonlySet<string>,
): { transactionId: string; entryKind: TipoDeLancamento; entryId: string }[] {
  return pares.flatMap((p) =>
    p.suggestion !== null && marcados.has(p.transaction.id)
      ? [
          {
            transactionId: p.transaction.id,
            entryKind: p.suggestion.entry.kind,
            entryId: p.suggestion.entry.id,
          },
        ]
      : [],
  )
}

/** Os pares sem duvida: mesmo dia, sem outro lancamento que tambem bata. */
export const semDuvida = (p: ParAutomatico): boolean =>
  p.suggestion !== null && p.suggestion.daysApart === 0 && p.suggestion.alternatives === 0

/** A frase do fim — quantas conciliadas e quantas baixas. */
export function resumoDaConfirmacao(r: ResultadoDaConfirmacao): string {
  const conciliadas =
    r.reconciled === 1 ? '1 linha conciliada' : `${r.reconciled} linhas conciliadas`
  if (r.settled === r.reconciled) {
    return `${conciliadas} e baixada${r.reconciled === 1 ? '' : 's'}, na ordem do extrato.`
  }
  const jaQuitadas = r.reconciled - r.settled
  return `${conciliadas}: ${r.settled} baixa${r.settled === 1 ? '' : 's'} lançada${r.settled === 1 ? '' : 's'} na ordem do extrato, ${jaQuitadas} já estava${jaQuitadas === 1 ? '' : 'm'} quitada${jaQuitadas === 1 ? '' : 's'}.`
}
