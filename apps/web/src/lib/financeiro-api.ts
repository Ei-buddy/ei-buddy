/**
 * ============================================================================
 * MODULO FINANCEIRO — cliente do BFF
 * ============================================================================
 *
 * Nao ha mais mock aqui: lancar titulo fala com `POST /contas-a-pagar`
 * (NR-074) e `POST /contas-a-receber` (RF-065) — ver
 * `lancarContaAPagar`/`lancarContaAReceber` mais abaixo, e
 * `FormularioTitulo.tsx` para o formulario que os chama. Custos fixos falam
 * com `/custos-fixos` (NR-110), no fim do arquivo. Baixa e estorno sao reais
 * desde a NR-081. Exportar fala com `/contas-a-pagar/exportar` e
 * `/contas-a-receber/exportar` — o ultimo botao que ainda so simulava.
 */

import { bancos } from './mock-data'
import { pedir, type Resultado } from './http'
import type { StatusTitulo } from './types'

/* -------------------------------------------------------------------------- */
/* Listas para os campos "(T)"                                                */
/* -------------------------------------------------------------------------- */

/** SUBSTITUIR POR: GET /bancos. Continua em uso na BAIXA — ver BaixaDialog. */
export const NOMES_BANCOS = bancos.map((b) => b.nome)

/* -------------------------------------------------------------------------- */
/* Exportacao — NR-074                                                        */
/* -------------------------------------------------------------------------- */

export type FormatoExportacao = 'csv' | 'pdf'

/** O nome do arquivo que o servidor sugeriu, tirado de `Content-Disposition`. */
function nomeDoArquivo(contentDisposition: string | null): string | null {
  if (contentDisposition === null) return null
  return /filename="([^"]+)"/.exec(contentDisposition)?.[1] ?? null
}

/**
 * Exporta a lista de titulos e ja dispara o download — RF-055 a RF-067.
 *
 * Nao passa por `pedir()`: ele sempre le a resposta como JSON, e um CSV ou
 * PDF quebraria ali antes de chegar a tela. O sucesso aqui e um ARQUIVO, e
 * nao um objeto — por isso o retorno so diz se deu certo, e nao devolve dado
 * nenhum para a tela desenhar.
 */
export async function exportar(
  tipo: TipoDeTitulo,
  formato: FormatoExportacao,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let resposta: Response

  try {
    resposta = await fetch(`/api/contas-a-${tipo}/exportar?formato=${formato}`, {
      credentials: 'same-origin',
    })
  } catch {
    return { ok: false, error: 'Sem conexão. Verifique sua internet.' }
  }

  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => ({}))) as { error?: { message?: string } }
    return { ok: false, error: corpo.error?.message ?? 'Não foi possível exportar.' }
  }

  const blob = await resposta.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nomeDoArquivo(resposta.headers.get('content-disposition')) ?? `titulos.${formato}`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  return { ok: true }
}

/* -------------------------------------------------------------------------- */
/* Custos fixos contra a api — NR-110                                        */
/* -------------------------------------------------------------------------- */

export type CustoFixo = {
  id: string
  nome: string
  valorCents: number
  diaVencimento: number
  planoContasId: string | null
  planoContasNome: string | null
}

type CustoFixoDaApi = {
  id: string
  name: string
  amountCents: number
  dueDay: number
  accountId: string | null
  accountName: string | null
}

const paraCustoFixo = (c: CustoFixoDaApi): CustoFixo => ({
  id: c.id,
  nome: c.name,
  valorCents: c.amountCents,
  diaVencimento: c.dueDay,
  planoContasId: c.accountId,
  planoContasNome: c.accountName,
})

export const carregarCustosFixos = (): Promise<Resultado<CustoFixo[]>> =>
  pedir<{ fixedCosts: CustoFixoDaApi[] }>('/api/custos-fixos').then((r) =>
    r.ok ? { ok: true, dados: r.dados.fixedCosts.map(paraCustoFixo) } : r,
  )

export type DadosCustoFixo = {
  nome: string
  valorCents: number
  diaVencimento: number
  planoContasId: string | null
}

const corpoCustoFixo = (dados: DadosCustoFixo) => ({
  name: dados.nome.trim(),
  amountCents: dados.valorCents,
  dueDay: dados.diaVencimento,
  ...(dados.planoContasId === null ? {} : { accountId: dados.planoContasId }),
})

export const criarCustoFixo = (dados: DadosCustoFixo): Promise<Resultado<CustoFixo>> =>
  pedir<CustoFixoDaApi>('/api/custos-fixos', {
    method: 'POST',
    body: JSON.stringify(corpoCustoFixo(dados)),
  }).then((r) => (r.ok ? { ok: true, dados: paraCustoFixo(r.dados) } : r))

export const editarCustoFixo = (id: string, dados: DadosCustoFixo): Promise<Resultado<CustoFixo>> =>
  pedir<CustoFixoDaApi>(`/api/custos-fixos/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(corpoCustoFixo(dados)),
  }).then((r) => (r.ok ? { ok: true, dados: paraCustoFixo(r.dados) } : r))

export const excluirCustoFixo = (id: string): Promise<Resultado<unknown>> =>
  pedir(`/api/custos-fixos/${encodeURIComponent(id)}`, { method: 'DELETE' })

/**
 * Gera as contas a pagar do mes — NR-110.
 *
 * Idempotente por (custo fixo, competencia): a garantia e do servidor — o
 * indice unico parcial em `payables`, via `ON CONFLICT ... DO NOTHING`. Rodar
 * duas vezes no mesmo mes nao duplica, e a resposta diz quantas entraram e
 * quantas ja existiam.
 */
export const gerarContasDeCustosFixos = (
  competencia: string,
): Promise<Resultado<{ geradas: number; jaExistiam: number }>> =>
  pedir<{ generatedCount: number; alreadyExistedCount: number }>('/api/custos-fixos/gerar', {
    method: 'POST',
    body: JSON.stringify({ competencia }),
  }).then((r) =>
    r.ok
      ? {
          ok: true,
          dados: { geradas: r.dados.generatedCount, jaExistiam: r.dados.alreadyExistedCount },
        }
      : r,
  )

/* -------------------------------------------------------------------------- */
/* Utilitarios de status                                                      */
/* -------------------------------------------------------------------------- */

/** Dias a partir dos quais o titulo entra em "a vencer em breve". */
export const DIAS_A_VENCER = 5

export type SituacaoVisual = 'aberto' | 'aVencer' | 'vencido' | 'quitado' | 'parcial'

/**
 * Situacao para efeito de cor, combinando status e proximidade do
 * vencimento — e o que a listagem usa para pintar o badge.
 */
export function situacaoDoTitulo(
  status: StatusTitulo,
  vencimento: string,
  diasAte: number,
): SituacaoVisual {
  if (status === 'pago') return 'quitado'
  if (status === 'vencido' || diasAte < 0) return 'vencido'
  if (status === 'parcial') return 'parcial'
  if (diasAte <= DIAS_A_VENCER) return 'aVencer'
  return 'aberto'
}

export const ROTULO_SITUACAO: Record<SituacaoVisual, string> = {
  aberto: 'Em aberto',
  aVencer: 'A vencer',
  vencido: 'Vencido',
  quitado: 'Quitado',
  parcial: 'Baixa parcial',
}

/* -------------------------------------------------------------------------- */
/* Contas a pagar contra a api — NR-074                                       */
/* -------------------------------------------------------------------------- */

/** Onde a conta cai em relacao a hoje — RF-061. */
export type FaixaDeVencimento = 'overdue' | 'today' | 'week' | 'month' | 'later'

export const ROTULO_FAIXA: Record<FaixaDeVencimento, string> = {
  overdue: 'Vencidas',
  today: 'Vencem hoje',
  week: 'Próximos 7 dias',
  month: 'Este mês',
  later: 'Mais adiante',
}

export type ContaAPagar = {
  id: string
  supplier: string
  description: string
  amountCents: number
  settledAmountCents: number
  dueDate: string
  status: 'open' | 'partially_settled' | 'settled' | 'cancelled'
  /** Classificacao contabil. Nulo enquanto ninguem classificou. */
  accountId: string | null
  recurrenceId: string | null
  occurrenceNumber: number | null
  occurrenceCount: number | null
}

export type GrupoDeVencimento = {
  faixa: FaixaDeVencimento
  payables: ContaAPagar[]
  /** Soma do que AINDA falta pagar, nao do valor original. */
  totalCents: number
}

export type ContasAPagarAgrupadas = {
  grupos: GrupoDeVencimento[]
  totalCents: number
  /** RF-062: o destaque na abertura do sistema. */
  temVencidas: boolean
}

/**
 * O mesmo `Resultado` de `lib/http`, sob o nome que as telas de contas ja
 * usam. Alias e nao copia: um segundo tipo com a mesma forma passaria a
 * divergir na primeira vez que um deles ganhasse um campo.
 */
export type ResultadoContas<T> = Resultado<T>

/**
 * A lista agrupada — RF-061, RF-062.
 *
 * O agrupamento e o TOTAL vem do servidor. A tela nao soma nada: somar aqui
 * daria um numero que pode divergir do que o relatorio mostra, e "quanto
 * preciso ter em caixa esta semana" nao pode ter duas respostas.
 */
export const carregarContasAPagar = (): Promise<ResultadoContas<ContasAPagarAgrupadas>> =>
  pedir<ContasAPagarAgrupadas>('/api/contas-a-pagar')

/** Lancar — RF-055, RF-057. Devolve quantas ocorrencias entraram. */
export const lancarContaAPagar = (entrada: {
  supplier: string
  description: string
  amountCents: number
  dueDate: string
  accountId?: string
  recurrence?: { frequency: 'weekly' | 'monthly'; occurrences: number }
}): Promise<ResultadoContas<{ payables: ContaAPagar[]; count: number }>> =>
  pedir('/api/contas-a-pagar', { method: 'POST', body: JSON.stringify(entrada) })

/* -------------------------------------------------------------------------- */
/* Contas a receber contra a api — NR-081                                     */
/* -------------------------------------------------------------------------- */

/**
 * O recebivel como a api o descreve.
 *
 * Esta lista era MOCK ate agora, ao lado de uma lista de contas a pagar real —
 * duas telas irmas, uma com dado do banco e outra com dado inventado, e nada na
 * interface dizendo qual era qual. A rota `GET /contas-a-receber` existe desde
 * a NR-074; faltava o cliente.
 */
export type ContaAReceber = {
  id: string
  saleId: string | null
  customerId: string | null
  /** Nulo quando a venda saiu sem identificar o cliente — o balcao permite. */
  customerName: string | null
  description: string
  amountCents: number
  /** Liquido previsto, ja sem a tarifa da adquirente — RF-063. */
  netAmountCents: number
  settledAmountCents: number
  dueDate: string
  installmentNumber: number
  installmentCount: number
  status: 'open' | 'partially_settled' | 'settled' | 'cancelled'
}

export type GrupoDeRecebimento = {
  faixa: FaixaDeVencimento
  receivables: ContaAReceber[]
  totalCents: number
}

export type ContasAReceberAgrupadas = {
  grupos: GrupoDeRecebimento[]
  totalCents: number
  temVencidas: boolean
}

export const carregarContasAReceber = (): Promise<ResultadoContas<ContasAReceberAgrupadas>> =>
  pedir<ContasAReceberAgrupadas>('/api/contas-a-receber')

/**
 * Lanca recebivel avulso, que nao vem de venda — RF-065.
 *
 * So uma linha, sem recorrencia: RF-065 nao pede parcelamento para o avulso —
 * quem precisa de varias parcelas lanca uma venda.
 */
export const lancarContaAReceber = (entrada: {
  description: string
  amountCents: number
  dueDate: string
  customerId?: string
  accountId?: string
}): Promise<ResultadoContas<ContaAReceber>> =>
  pedir('/api/contas-a-receber', { method: 'POST', body: JSON.stringify(entrada) })

/* -------------------------------------------------------------------------- */
/* Baixa e estorno contra a api — NR-081, RF-059, RF-066, RF-067              */
/* -------------------------------------------------------------------------- */

export type TipoDeTitulo = 'pagar' | 'receber'

/**
 * Uma linha do historico de baixas.
 *
 * `amountCents` NEGATIVO e estorno, e nao um erro de sinal: o estorno nao apaga
 * a baixa, grava a linha oposta. A propriedade que isso preserva e util na
 * tela — somar as linhas da o saldo baixado, sempre.
 */
export type Baixa = {
  id: string
  payableId: string | null
  receivableId: string | null
  amountCents: number
  method: string | null
  bankAccount: string | null
  settledOn: string
  notes: string | null
  /** Preenchido na linha de estorno, apontando a baixa desfeita. */
  reversesId: string | null
  createdBy: string | null
  createdAt: string
}

const caminhoDoTitulo = (tipo: TipoDeTitulo, id: string) =>
  `/api/contas-a-${tipo}/${encodeURIComponent(id)}/baixas`

/**
 * O historico de baixas de um titulo — RF-067.
 *
 * A tela precisa dele para estornar: o estorno endereca a BAIXA, e a lista de
 * titulos nao traz os ids delas. Antes disto o botao "Estornar" chamava uma
 * funcao falsa que respondia `ok` sem nada acontecer no banco.
 */
export const carregarBaixas = (
  tipo: TipoDeTitulo,
  tituloId: string,
): Promise<ResultadoContas<Baixa[]>> => pedir<Baixa[]>(caminhoDoTitulo(tipo, tituloId))

/** Como o dinheiro ENTROU. Nao e a forma da venda — e a do recebimento. */
export type FormaDeRecebimento = 'cash' | 'pix' | 'debit' | 'credit' | 'wallet'

/**
 * As cinco do `paymentMethodSchema`, na ordem em que o balcao usa.
 *
 * Sem "outro": o contrato nao tem esse valor, e inventa-lo aqui daria um 400
 * na hora de confirmar, depois de a pessoa ja ter escolhido.
 */
export const FORMAS_DE_RECEBIMENTO: readonly { valor: FormaDeRecebimento; rotulo: string }[] = [
  { valor: 'pix', rotulo: 'Pix' },
  { valor: 'cash', rotulo: 'Dinheiro' },
  { valor: 'debit', rotulo: 'Cartão de débito' },
  { valor: 'credit', rotulo: 'Cartão de crédito' },
  { valor: 'wallet', rotulo: 'Carteira digital' },
]

export type DadosDaBaixa = {
  /** Em CENTAVOS. A tela mostra reais; a fronteira converte uma vez so. */
  amountCents: number
  settledOn: string
  /** So em conta a pagar: de qual conta o dinheiro saiu. */
  bankAccount?: string
  /** So em recebivel: como o dinheiro entrou. */
  method?: FormaDeRecebimento
  notes?: string
}

/**
 * Baixa, total ou parcial — RF-059, RF-066.
 *
 * Uma funcao para os dois tipos porque a ROTA e simetrica; o que difere e o
 * corpo, e quem monta o corpo e a tela, que sabe qual titulo esta baixando.
 */
export const baixarTitulo = (
  tipo: TipoDeTitulo,
  tituloId: string,
  dados: DadosDaBaixa,
): Promise<ResultadoContas<Baixa>> =>
  pedir<Baixa>(caminhoDoTitulo(tipo, tituloId), {
    method: 'POST',
    body: JSON.stringify(dados),
  })

/**
 * Estorno — RF-067.
 *
 * Recebe o id da BAIXA, e nao o do titulo, e nao diz se ele e a pagar ou a
 * receber: o servidor procura nas duas tabelas. `motivo` e obrigatorio la, e
 * com razao — um estorno sem motivo e um numero que mudou sem explicacao, e a
 * pergunta "por que esse saldo mudou" e exatamente a que traz alguem ao
 * historico.
 */
export const estornarBaixa = (baixaId: string, motivo: string): Promise<ResultadoContas<Baixa>> =>
  pedir<Baixa>(`/api/baixas/${encodeURIComponent(baixaId)}/estorno`, {
    method: 'POST',
    body: JSON.stringify({ reason: motivo }),
  })

/* -------------------------------------------------------------------------- */
/* Custos variaveis — percentual sobre o preco de venda                       */
/* -------------------------------------------------------------------------- */

export type CustoVariavel = {
  id: string
  nome: string
  /** Pontos percentuais: 3.5 = 3,5% do preco de venda. */
  percentual: number
}

type CustoVariavelDaApi = { id: string; name: string; ratePercent: number }

const paraCustoVariavel = (c: CustoVariavelDaApi): CustoVariavel => ({
  id: c.id,
  nome: c.name,
  percentual: c.ratePercent,
})

export const carregarCustosVariaveis = (): Promise<Resultado<CustoVariavel[]>> =>
  pedir<{ variableCosts: CustoVariavelDaApi[] }>('/api/custos-variaveis').then((r) =>
    r.ok ? { ok: true, dados: r.dados.variableCosts.map(paraCustoVariavel) } : r,
  )

export const criarCustoVariavel = (
  nome: string,
  percentual: number,
): Promise<Resultado<CustoVariavel>> =>
  pedir<CustoVariavelDaApi>('/api/custos-variaveis', {
    method: 'POST',
    body: JSON.stringify({ name: nome.trim(), ratePercent: percentual }),
  }).then((r) => (r.ok ? { ok: true, dados: paraCustoVariavel(r.dados) } : r))

export const excluirCustoVariavel = (id: string): Promise<Resultado<unknown>> =>
  pedir(`/api/custos-variaveis/${encodeURIComponent(id)}`, { method: 'DELETE' })
