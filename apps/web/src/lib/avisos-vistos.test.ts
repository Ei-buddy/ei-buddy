import { describe, expect, it } from 'vitest'
import type { Aviso } from './avisos-api'
import { avisosNovos, lerAvisosVistos, marcarAvisosVistos } from './avisos-vistos'

function memoria() {
  const dados = new Map<string, string>()
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
  }
}

const aviso = (href: string, contagem: number): Aviso => ({
  texto: `${contagem} coisas`,
  href,
  tom: 'atencao',
  contagem,
})

describe('sino: o que ja foi visto — NR-147', () => {
  it('abrir o sino zera o contador, mas a pendencia continua na lista', () => {
    const onde = memoria()
    const avisos = [aviso('/app/clientes', 4), aviso('/app/financeiro/contas-a-pagar', 2)]

    expect(avisosNovos(avisos, lerAvisosVistos(onde))).toHaveLength(2)
    marcarAvisosVistos(avisos, onde)

    expect(avisosNovos(avisos, lerAvisosVistos(onde))).toHaveLength(0)
  })

  it('a contagem que muda volta a acender', () => {
    const onde = memoria()
    marcarAvisosVistos([aviso('/app/financeiro/contas-a-pagar', 2)], onde)

    const depois = [aviso('/app/financeiro/contas-a-pagar', 3)]
    expect(avisosNovos(depois, lerAvisosVistos(onde))).toEqual(depois)
  })

  it('sem armazenamento, nada quebra: tudo conta como novo', () => {
    const quebrado = {
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => {
        throw new Error('bloqueado')
      },
    }
    const avisos = [aviso('/app/produtos', 1)]
    expect(() => marcarAvisosVistos(avisos, quebrado)).not.toThrow()
    expect(avisosNovos(avisos, lerAvisosVistos(quebrado))).toEqual(avisos)
  })
})
