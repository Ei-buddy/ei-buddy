import type { Aviso } from './avisos-api'

/**
 * O que do sino ja foi visto — NR-147.
 *
 * Os avisos sao ESTADO, e nao mensagem: "2 contas vencidas" continua verdade
 * ate alguem pagar. Por isso a lista do painel nao some ao ser lida. O que
 * some e o NUMERO do sino: ele conta so o que mudou desde a ultima vez que o
 * painel foi aberto. Sem isto, o contador ficava aceso para sempre e deixava
 * de chamar atencao — o mesmo defeito do ponto fixo que o modulo de avisos
 * existe para evitar.
 *
 * A assinatura leva a CONTAGEM: de 2 para 3 contas vencidas e novidade, e o
 * numero volta. Guardado no aparelho (e so conforto de quem olha), e sem
 * guarda nenhuma o pior caso e o sino acender de novo.
 */

const CHAVE = 'nr:avisos-vistos'

export const assinaturaDoAviso = (a: Pick<Aviso, 'href' | 'contagem'>) => `${a.href}|${a.contagem}`

type Armazem = Pick<Storage, 'getItem' | 'setItem'>

function armazem(): Armazem | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function lerAvisosVistos(onde: Armazem | null = armazem()): Set<string> {
  try {
    const bruto = onde?.getItem(CHAVE)
    const lista: unknown = bruto ? JSON.parse(bruto) : []
    return new Set(Array.isArray(lista) ? lista.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

/**
 * Marca como visto exatamente o que esta no sino agora. O que ja saiu da
 * lista sai tambem daqui: se voltar a acontecer, e novidade de novo.
 */
export function marcarAvisosVistos(
  avisos: readonly Aviso[],
  onde: Armazem | null = armazem(),
): Set<string> {
  const vistos = new Set(avisos.map(assinaturaDoAviso))
  try {
    onde?.setItem(CHAVE, JSON.stringify([...vistos]))
  } catch {
    /* Sem armazenamento, o sino so acende de novo na proxima visita. */
  }
  return vistos
}

/** Os avisos que o sino conta: os que mudaram desde a ultima olhada. */
export function avisosNovos(avisos: readonly Aviso[], vistos: ReadonlySet<string>): Aviso[] {
  return avisos.filter((a) => !vistos.has(assinaturaDoAviso(a)))
}
