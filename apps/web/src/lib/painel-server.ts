import 'server-only'
import { cookies } from 'next/headers'
import { chamarApi } from './api-server'
import { diaLocal, hoje } from './format'
import { SESSION_COOKIE } from './session'

/**
 * O que a visao geral mostra — NR-013.
 *
 * ## O que este modulo substitui
 *
 * A pagina somava `lib/mock-data` e filtrava por `'2026-08-24'` escrito no
 * codigo. Ou seja: a primeira tela depois do login era um mockup. "Bom dia,
 * Marina" com o nome de ninguem, "Segunda-feira, 24 de agosto" para sempre,
 * grafico da semana com sete alturas inventadas e um ticket medio com "+4% vs.
 * ontem" digitado a mao.
 *
 * O `inicio.tsx` do mobile ja tinha passado por isso — o comentario do
 * `inicio-api.ts` de la descreve a mesma constante de agosto. O web ficou
 * atras.
 *
 * ## Le do servidor, e nao pelas rotas do proprio Next
 *
 * A pagina e um componente de SERVIDOR, entao ela ja esta no servidor: dar uma
 * volta pelo `/api` do Next para falar com a api seria um salto a toa. Mesmo
 * criterio de `vendas-server.ts`.
 *
 * ## Falha parcial nao apaga a tela
 *
 * Cada bloco responde uma pergunta diferente, e o resultado de cada leitura
 * vem separado. Se as contas a pagar cairem, nao ha motivo para esconder o
 * faturamento — o bloco diz que nao carregou e o resto continua de pe. Uma
 * tela que some inteira por causa de um bloco e uma tela que o lojista aprende
 * a nao consultar.
 *
 * `null` significa "nao deu para saber". Zero significa zero. Confundir os
 * dois faria uma queda de rede parecer um dia sem vendas.
 */

/** Quantos dias o grafico mostra. */
export const DIAS_DA_SEMANA = 7

type Perfil = { userName: string; companyName: string | null }

type ResumoDeVendas = {
  salesCount: number
  /** O que os clientes pagaram. E o "faturamento" do painel. */
  grossCents: number
  netCents: number
  averageTicketCents: number | null
}

type PaginaDeVendas = {
  sales: {
    id: string
    number: number
    soldAt: string
    customerName: string | null
    status: 'open' | 'settled' | 'cancelled' | 'returned'
    grossAmountCents: number
    discountCents: number
    payments: { method: string }[]
  }[]
  summary: ResumoDeVendas
}

type Titulo = {
  id: string
  supplier?: string
  customerName?: string | null
  description: string
  amountCents: number
  settledAmountCents: number
  dueDate: string
}

type Agrupadas = {
  totalCents: number
  grupos: { faixa: string; payables?: Titulo[]; receivables?: Titulo[]; totalCents: number }[]
}

type Catalogo = {
  products: { id: string; description: string; stock: number; minStock: number }[]
}

type ResumoDoCatalogo = { total: number }
type ListaDeClientes = { total: number }

export type DiaDoGrafico = {
  readonly dia: string
  /** Rotulo curto: "seg", "ter". */
  readonly rotulo: string
  /** Faturamento do dia: o bruto, e nao o liquido. */
  readonly grossCents: number
  readonly salesCount: number
}

export type Painel = {
  readonly saudacao: { readonly texto: string; readonly nome: string | null }
  readonly data: string
  readonly hoje: ResumoDeVendas | null
  readonly semana: readonly DiaDoGrafico[] | null
  readonly ultimasVendas: PaginaDeVendas['sales'] | null
  readonly aPagar: { readonly totalCents: number; readonly vencidas: number } | null
  readonly aReceber: { readonly totalCents: number } | null
  readonly vencimentos: readonly Titulo[] | null
  readonly reposicao: Catalogo['products'] | null
  /** Nulo = nao deu para saber. Alimenta o checklist inicial — ver ChecklistInicial. */
  readonly totalProdutos: number | null
  readonly totalClientes: number | null
}

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const

const DIAS_LONGOS = [
  'Domingo',
  'Segunda-feira',
  'Terca-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sabado',
] as const

const MESES = [
  'janeiro',
  'fevereiro',
  'marco',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const

/** "Segunda-feira, 8 de setembro" — o cabecalho da tela. */
export function dataPorExtenso(agora: Date): string {
  return `${DIAS_LONGOS[agora.getDay()]}, ${agora.getDate()} de ${MESES[agora.getMonth()]}`
}

/**
 * "Bom dia" / "Boa tarde" / "Boa noite", pelo relogio de quem esta olhando.
 *
 * Antes era "Bom dia" fixo — o lojista fechando o caixa as 22h era recebido com
 * bom dia.
 */
export function saudacaoDaHora(agora: Date): string {
  const h = agora.getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

/** So o primeiro nome: "Marina Alves" no cabecalho e formal demais. */
export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome
}

/** Os `DIAS_DA_SEMANA` dias que terminam hoje, do mais antigo ao mais novo. */
function diasDaSemana(agora: Date): readonly Date[] {
  return Array.from({ length: DIAS_DA_SEMANA }, (_, i) => {
    const d = new Date(agora)
    d.setDate(d.getDate() - (DIAS_DA_SEMANA - 1 - i))
    return d
  })
}

export async function carregarPainel(agora: Date = new Date()): Promise<Painel> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const dias = diasDaSemana(agora)

  /*
   * Uma chamada por DIA para o grafico, e nao uma para o periodo inteiro.
   *
   * O `/sales` devolve um `summary` calculado com funcao de janela ANTES do
   * `LIMIT`, entao `pageSize=1` da o resumo exato do dia com payload minimo —
   * o resumo e do periodo filtrado, nao da pagina.
   *
   * A alternativa era um pedido para os sete dias e agrupar aqui, e ela tem um
   * defeito silencioso: a pagina do historico vai ate 100 vendas
   * (`PAGINA_MAXIMA_DO_HISTORICO`), e uma loja com quinze vendas por dia passa
   * disso numa semana. O grafico ficaria truncado sem avisar.
   *
   * `/relatorios/faturamento` nao serve: ele agrupa por MES, e uma semana
   * dentro do mesmo mes volta como uma barra so. Um `groupBy=day` ali
   * transformaria estes sete pedidos em um — vale como proxima tarefa da api,
   * e esta anotado no PR.
   */
  /*
   * `Promise.all` ANINHADO, e nao um espalhado num array so.
   *
   * O espalhado faz o TypeScript perder a tupla e devolver a uniao de todos os
   * tipos de resposta num array — e recuperar dali exige `as`, que e o
   * compilador sendo silenciado em vez de consultado. Aninhado, cada grupo
   * mantem o tipo exato e nao ha um cast no arquivo.
   *
   * O paralelismo e o mesmo: tudo dispara junto.
   */
  const [perfil, porDia, [ultimas, aPagar, aReceber, catalogo, resumo, clientes]] =
    await Promise.all([
      chamarApi<Perfil>('/auth/perfil', { token }),

      Promise.all(
        dias.map((d) => {
          const dia = diaLocal(d)
          return chamarApi<PaginaDeVendas>(`/sales?from=${dia}&to=${dia}&pageSize=1`, { token })
        }),
      ),

      Promise.all([
        chamarApi<PaginaDeVendas>('/sales?pageSize=4', { token }),
        chamarApi<Agrupadas>('/contas-a-pagar', { token }),
        chamarApi<Agrupadas>('/contas-a-receber', { token }),
        chamarApi<Catalogo>('/produtos/catalogo?stock=baixo&pageSize=5', { token }),
        /* So para o total — o mesmo numero que alimenta o sino de avisos
           (`avisos-api.ts`), aqui pelo caminho do servidor. */
        chamarApi<ResumoDoCatalogo>('/produtos/resumo', { token }),
        chamarApi<ListaDeClientes>('/clientes?pageSize=1', { token }),
      ]),
    ])

  /* O ultimo dia da serie E hoje: o resumo dele serve os indicadores do topo
     sem custar outra chamada. */
  const doDia = porDia[DIAS_DA_SEMANA - 1]

  /*
   * O grafico e tudo ou nada: uma barra faltando no meio da semana nao
   * apareceria como falha, apareceria como um dia sem vendas. Melhor dizer que
   * o grafico nao carregou.
   */
  const semana: DiaDoGrafico[] | null = porDia.every((r) => r.ok)
    ? porDia.map((r, i) => ({
        dia: diaLocal(dias[i]!),
        rotulo: DIAS_CURTOS[dias[i]!.getDay()]!,
        grossCents: r.ok ? r.dados.summary.grossCents : 0,
        salesCount: r.ok ? r.dados.summary.salesCount : 0,
      }))
    : null

  return {
    saudacao: {
      texto: saudacaoDaHora(agora),
      nome: perfil.ok ? primeiroNome(perfil.dados.userName) : null,
    },
    data: dataPorExtenso(agora),
    hoje: doDia !== undefined && doDia.ok ? doDia.dados.summary : null,
    semana,
    ultimasVendas: ultimas.ok ? ultimas.dados.sales : null,
    aPagar: aPagar.ok
      ? {
          totalCents: aPagar.dados.totalCents,
          vencidas: aPagar.dados.grupos.find((g) => g.faixa === 'overdue')?.payables?.length ?? 0,
        }
      : null,
    aReceber: aReceber.ok ? { totalCents: aReceber.dados.totalCents } : null,
    /*
     * Na ordem dos grupos, que ja vem do servidor por urgencia: vencidas
     * primeiro, depois hoje, semana, mes. E a ordem em que o lojista age — a
     * mesma decisao do mobile.
     */
    vencimentos: aPagar.ok
      ? aPagar.dados.grupos.flatMap((g) => g.payables ?? []).slice(0, 4)
      : null,
    reposicao: catalogo.ok ? catalogo.dados.products : null,
    totalProdutos: resumo.ok ? resumo.dados.total : null,
    totalClientes: clientes.ok ? clientes.dados.total : null,
  }
}

/** Reexportado para a pagina nao precisar importar de dois lugares. */
export { hoje }
