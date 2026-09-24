/**
 * Financeiro no app — contas a pagar e a receber, baixa e estorno de baixa.
 *
 * Tudo aqui fala com a api. Lancar titulo, plano de contas e custos fixos ficam
 * no web: as funcoes simuladas que existiam para eles (e que nenhuma tela do
 * app chamava) sairam, para nada parecer gravar sem gravar.
 */

import { chamarApi, type Resposta } from './api'
import type { StatusTitulo } from './types'

/* -------------------------------------------------------------------------- */
/* Onde o dinheiro entrou ou saiu                                             */
/* -------------------------------------------------------------------------- */

/**
 * Sugestoes para o campo "conta" da baixa — texto livre, que vai nas notas.
 *
 * Nao sao as contas da loja: essas ainda nao tem cadastro no backend (RF-073).
 * Eram as contas de uma loja de exemplo, com agencia e saldo inventados; agora
 * sao so nomes de instituicao, que servem a qualquer loja.
 */
export const NOMES_BANCOS = [
  'Caixa da loja',
  'Banco do Brasil',
  'Caixa Econômica',
  'Itaú',
  'Bradesco',
  'Santander',
  'Nubank',
  'Inter',
  'Sicredi',
  'Sicoob',
]

/* -------------------------------------------------------------------------- */
/* Estado das listas                                                          */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* As listas, de verdade — RF-061, RF-064, RF-066                             */
/* -------------------------------------------------------------------------- */

/**
 * Uma conta, a pagar ou a receber.
 *
 * Forma comum de proposito: as duas telas sao a mesma estrutura com a
 * contraparte trocada, e formas diferentes fariam o total significar uma coisa
 * numa e outra na outra.
 *
 * Valores em CENTAVOS, como a api fala (RNF-044).
 *
 * Eram em reais, convertidos aqui na borda, e isso bastava enquanto a tela
 * apenas MOSTRAVA. Com a baixa de verdade nao basta: a baixa total manda o saldo
 * de volta para a api, e `saldo * 100` em ponto flutuante deixa um centavo para
 * tras de vez em quando — um titulo que fica devendo R$ 0,01 depois de quitado
 * nao sai mais da lista de contas em aberto. A divisao por cem virou coisa do
 * ponto de EXIBIR.
 */
export type Titulo = {
  id: string
  /** Fornecedor, na conta a pagar; cliente, na a receber. */
  contraparte: string
  descricao: string
  /** AAAA-MM-DD. */
  vencimento: string
  valorCents: number
  baixadoCents: number
  status: StatusTitulo
}

export type ListaDeTitulos = {
  titulos: Titulo[]
  /** Soma do que AINDA falta, e nao do valor original. Em centavos. */
  totalCents: number
  temVencidos: boolean
}

type GrupoDaApi<T> = { faixa: string; totalCents: number } & T

type PagarDaApi = {
  id: string
  supplier: string
  description: string
  amountCents: number
  settledAmountCents: number
  dueDate: string
  status: string
}

type ReceberDaApi = {
  id: string
  customerName: string | null
  description: string
  amountCents: number
  settledAmountCents: number
  dueDate: string
  status: string
}

/**
 * O status da api vira o da tela.
 *
 * A api nao tem "vencido": ela guarda `open` e deixa a data decidir, porque
 * vencido e uma leitura do calendario e nao um estado gravado — se fosse
 * coluna, alguem teria de varrer o banco a meia-noite para mante-la certa.
 * Quem pinta o vermelho e `situacaoDoTitulo`, com o vencimento em maos.
 */
const paraStatus = (status: string): StatusTitulo =>
  status === 'settled' ? 'pago' : status === 'partially_settled' ? 'parcial' : 'aberto'

/**
 * As contas a pagar da loja — RF-061.
 *
 * A api devolve agrupado por faixa de vencimento; aqui a lista e achatada,
 * porque a tela do celular reagrupa do seu jeito (sanfonas por situacao) e dois
 * agrupamentos empilhados so criariam duas verdades sobre a mesma conta.
 */
export async function listarContasPagar(): Promise<Resposta<ListaDeTitulos>> {
  const r = await chamarApi<{
    grupos: GrupoDaApi<{ payables: PagarDaApi[] }>[]
    totalCents: number
    temVencidas: boolean
  }>('/contas-a-pagar')

  if (!r.ok) return r

  return {
    ok: true,
    dados: {
      titulos: r.dados.grupos.flatMap((g) =>
        g.payables.map((p) => ({
          id: p.id,
          contraparte: p.supplier,
          descricao: p.description,
          vencimento: p.dueDate,
          valorCents: p.amountCents,
          baixadoCents: p.settledAmountCents,
          status: paraStatus(p.status),
        })),
      ),
      totalCents: r.dados.totalCents,
      temVencidos: r.dados.temVencidas,
    },
  }
}

/** As contas a receber da loja — RF-064, RF-066. */
export async function listarContasReceber(): Promise<Resposta<ListaDeTitulos>> {
  const r = await chamarApi<{
    grupos: GrupoDaApi<{ receivables: ReceberDaApi[] }>[]
    totalCents: number
    temVencidas: boolean
  }>('/contas-a-receber')

  if (!r.ok) return r

  return {
    ok: true,
    dados: {
      titulos: r.dados.grupos.flatMap((g) =>
        g.receivables.map((rec) => ({
          id: rec.id,
          /* Venda sem identificar o cliente e caminho normal no balcao: o
             rotulo diz isso em vez de deixar a linha sem contraparte. */
          contraparte: rec.customerName ?? 'Cliente não identificado',
          descricao: rec.description,
          vencimento: rec.dueDate,
          valorCents: rec.amountCents,
          baixadoCents: rec.settledAmountCents,
          status: paraStatus(rec.status),
        })),
      ),
      totalCents: r.dados.totalCents,
      temVencidos: r.dados.temVencidas,
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Baixa e estorno, de verdade — NR-081, RF-059, RF-066, RF-067               */
/* -------------------------------------------------------------------------- */

/**
 * A baixa saiu do celular por uma razao que agora deixou de valer.
 *
 * O que estava aqui era `BAIXA_SO_NO_WEB`: um texto de recusa, porque as duas
 * rotas exigem uma escolha — de qual conta o dinheiro saiu, ou como ele entrou —
 * e a tela confirmava num `Alert`, que nao tem onde oferecer nada. Mandar um
 * padrao inventado seria pior que nao ter o botao: a baixa entraria com dado
 * errado, e dado financeiro errado com cara de certo e o que ninguem consegue
 * auditar depois.
 *
 * A resposta nao era esconder a operacao mais diaria do financeiro do aparelho
 * que o lojista tem na mao. Era a tela PERGUNTAR. `BaixaModal` pergunta, e o
 * estorno tambem: `EstornoModal` carrega o historico de baixas do titulo, deixa
 * escolher qual desfazer e cobra o motivo.
 */

export type TipoDeTitulo = 'pagar' | 'receber'

/** Como o dinheiro ENTROU — as cinco do contrato, sem inventar uma sexta. */
export type FormaDeRecebimento = 'cash' | 'pix' | 'debit' | 'credit' | 'wallet'

export const FORMAS_DE_RECEBIMENTO: readonly { valor: FormaDeRecebimento; rotulo: string }[] = [
  { valor: 'pix', rotulo: 'Pix' },
  { valor: 'cash', rotulo: 'Dinheiro' },
  { valor: 'debit', rotulo: 'Débito' },
  { valor: 'credit', rotulo: 'Crédito' },
  { valor: 'wallet', rotulo: 'Carteira' },
]

/**
 * Uma linha do historico de baixas.
 *
 * `amountCents` NEGATIVO e estorno, e nao erro de sinal: o estorno nao apaga a
 * baixa, grava a linha oposta. Somar as linhas da o saldo baixado, sempre.
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

const caminhoDasBaixas = (tipo: TipoDeTitulo, tituloId: string) =>
  `/contas-a-${tipo}/${encodeURIComponent(tituloId)}/baixas`

/**
 * O historico de baixas de um titulo — RF-067.
 *
 * O estorno endereca a BAIXA (`POST /baixas/:id/estorno`) e a lista de titulos
 * nao traz os ids delas. Era esta consulta que faltava para o celular poder
 * estornar sem palpitar sobre qual lancamento desfazer.
 */
export const listarBaixas = (tipo: TipoDeTitulo, tituloId: string): Promise<Resposta<Baixa[]>> =>
  chamarApi<Baixa[]>(caminhoDasBaixas(tipo, tituloId))

export type DadosDaBaixa = {
  /** Em CENTAVOS. */
  amountCents: number
  settledOn: string
  /** So na conta a pagar: de qual conta o dinheiro saiu — RF-059. */
  bankAccount?: string
  /** So no recebivel: como o dinheiro entrou — RF-066. */
  method?: FormaDeRecebimento
  notes?: string
}

/** Baixa, total ou parcial — RF-059, RF-066. */
export const baixarTitulo = (
  tipo: TipoDeTitulo,
  tituloId: string,
  dados: DadosDaBaixa,
): Promise<Resposta<Baixa>> =>
  chamarApi<Baixa>(caminhoDasBaixas(tipo, tituloId), { method: 'POST', body: dados })

/**
 * Estorno — RF-067.
 *
 * O id e o da BAIXA, e o caminho nao diz se ela e de conta a pagar ou a
 * receber: o servidor procura nas duas tabelas.
 *
 * `motivo` e obrigatorio la, e com razao — um estorno sem motivo e um numero
 * que mudou sem explicacao, e "por que esse saldo mudou" e exatamente a
 * pergunta que traz alguem ao historico.
 */
export const estornarBaixa = (baixaId: string, motivo: string): Promise<Resposta<Baixa>> =>
  chamarApi<Baixa>(`/baixas/${encodeURIComponent(baixaId)}/estorno`, {
    method: 'POST',
    body: { reason: motivo },
  })

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
