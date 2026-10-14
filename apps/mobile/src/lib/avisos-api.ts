import AsyncStorage from '@react-native-async-storage/async-storage'
import { chamarApi } from './api'

/**
 * O sino de avisos do app — NR-162, o mesmo do web (`lib/avisos-api` e
 * `lib/avisos-vistos`): os mesmos sinais, as mesmas frases, e o sino so acende
 * para o que mudou desde a ultima olhada.
 */

export type Aviso = {
  readonly texto: string
  readonly rota: { pathname: string; params?: Record<string, string> }
  readonly tom: 'atencao' | 'perigo'
  /** Quantos itens o aviso representa — o numero do badge. */
  readonly contagem: number
}

const plural = (n: number, um: string, muitos: string) => (n === 1 ? um : muitos)

/** Busca os sinais em paralelo e ignora quem falhar — o sino e acessorio. */
async function buscarAvisos(): Promise<Aviso[]> {
  const [catalogo, contas, chamados, inativos, conexoes] = await Promise.all([
    chamarApi<{ belowMinimum: number; outOfStock: number }>('/produtos/resumo'),
    chamarApi<{ temVencidas: boolean; grupos: { faixa: string; payables: unknown[] }[] }>(
      '/contas-a-pagar',
    ),
    chamarApi<{ unread: number }>('/suporte/chamados'),
    chamarApi<{ total: number }>('/clientes?filter=inativos&pageSize=1'),
    chamarApi<{ count: number }>('/conexoes/pendentes'),
  ])

  const avisos: Aviso[] = []

  if (catalogo.ok && catalogo.dados.outOfStock > 0) {
    const n = catalogo.dados.outOfStock
    avisos.push({
      texto: `${n} ${plural(n, 'produto esgotado', 'produtos esgotados')}`,
      rota: { pathname: '/catalogo', params: { estoque: 'esgotado' } },
      tom: 'perigo',
      contagem: n,
    })
  }

  if (catalogo.ok) {
    /* Abaixo do minimo MENOS os esgotados: o esgotado ja tem linha propria. */
    const repor = catalogo.dados.belowMinimum - catalogo.dados.outOfStock
    if (repor > 0) {
      avisos.push({
        texto: `${repor} ${plural(repor, 'produto para repor', 'produtos para repor')}`,
        rota: { pathname: '/catalogo', params: { estoque: 'baixo' } },
        tom: 'atencao',
        contagem: repor,
      })
    }
  }

  if (chamados.ok && chamados.dados.unread > 0) {
    const n = chamados.dados.unread
    avisos.push({
      texto: `${n} ${plural(n, 'resposta do suporte', 'respostas do suporte')}`,
      rota: { pathname: '/suporte' },
      tom: 'atencao',
      contagem: n,
    })
  }

  if (inativos.ok && inativos.dados.total > 0) {
    const n = inativos.dados.total
    avisos.push({
      texto: `${n} ${plural(n, 'cliente sem comprar há muito tempo', 'clientes sem comprar há muito tempo')}`,
      rota: { pathname: '/clientes', params: { filtro: 'inativos' } },
      tom: 'atencao',
      contagem: n,
    })
  }

  if (conexoes.ok && conexoes.dados.count > 0) {
    const n = conexoes.dados.count
    avisos.push({
      texto: `${n} ${plural(n, 'pedido de conexão', 'pedidos de conexão')}`,
      rota: { pathname: '/conexoes' },
      tom: 'atencao',
      contagem: n,
    })
  }

  if (contas.ok && contas.dados.temVencidas) {
    const vencidas = contas.dados.grupos.find((g) => g.faixa === 'overdue')?.payables.length ?? 0
    avisos.push({
      texto: `${vencidas} ${plural(vencidas, 'conta vencida', 'contas vencidas')}`,
      rota: { pathname: '/contas-a-pagar' },
      tom: 'perigo',
      contagem: vencidas,
    })
  }

  return avisos
}

/*
 * Cache curto, compartilhado: o cabecalho remonta a cada tela, e cinco
 * consultas por troca de tela gastariam a rede do balcao a toa. O web busca
 * uma vez por carga do painel; aqui, no maximo uma vez por minuto.
 */
const VALIDADE_MS = 60_000
let cache: { quando: number; avisos: Promise<Aviso[]> } | null = null

export function carregarAvisos(forcar = false): Promise<Aviso[]> {
  if (forcar || cache === null || Date.now() - cache.quando > VALIDADE_MS) {
    cache = { quando: Date.now(), avisos: buscarAvisos() }
  }
  return cache.avisos
}

/* --- O que ja foi visto ---------------------------------------------------- */

const CHAVE_VISTOS = 'eibuddy:avisos-vistos'

export const assinaturaDoAviso = (a: Aviso) =>
  `${a.rota.pathname}|${JSON.stringify(a.rota.params ?? {})}|${a.contagem}`

export async function lerAvisosVistos(): Promise<Set<string>> {
  try {
    const bruto = await AsyncStorage.getItem(CHAVE_VISTOS)
    const lista: unknown = bruto ? JSON.parse(bruto) : []
    return new Set(Array.isArray(lista) ? lista.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Marca como visto exatamente o que esta no sino agora. */
export async function marcarAvisosVistos(avisos: readonly Aviso[]): Promise<Set<string>> {
  const vistos = new Set(avisos.map(assinaturaDoAviso))
  try {
    await AsyncStorage.setItem(CHAVE_VISTOS, JSON.stringify([...vistos]))
  } catch {
    /* Sem armazenamento, o sino so acende de novo na proxima abertura. */
  }
  return vistos
}

/** Os avisos que o sino conta: os que mudaram desde a ultima olhada. */
export const avisosNovos = (avisos: readonly Aviso[], vistos: ReadonlySet<string>) =>
  avisos.filter((a) => !vistos.has(assinaturaDoAviso(a)))
