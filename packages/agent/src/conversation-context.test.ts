import { describe, expect, it } from 'vitest'
import {
  lerSnapshot,
  montarResumoDeEntidades,
  resumoComoTexto,
  type SnapshotDeTurno,
} from './conversation-context.js'

const joao = { tipo: 'cliente', ref: 'cli-1', rotulo: 'João' } as const
const cafe = { tipo: 'produto', ref: 'p-cafe', rotulo: 'café em grãos' } as const

function msg(toolCalls?: unknown) {
  return toolCalls === undefined ? {} : { toolCalls }
}

function snap(dados: Partial<SnapshotDeTurno>): SnapshotDeTurno {
  return { v: 2, entidades: [], ...dados }
}

describe('montarResumoDeEntidades', () => {
  it('janela vazia devolve resumo vazio', () => {
    const resumo = montarResumoDeEntidades([])
    expect(resumo.entidades).toEqual([])
    expect(resumo.intencao).toBeUndefined()
    expect(resumoComoTexto(resumo)).toBe('')
  })

  it('une as entidades da janela e o rotulo mais recente vence', () => {
    const resumo = montarResumoDeEntidades([
      msg(snap({ entidades: [{ ...joao, rotulo: 'Joao' }] })),
      msg(),
      msg(snap({ entidades: [cafe, joao] })),
    ])
    expect(resumo.entidades).toHaveLength(2)
    expect(resumo.entidades).toContainEqual(joao)
    expect(resumo.entidades).toContainEqual(cafe)
  })

  it('usa a intencao do snapshot mais recente e um snapshot novo sem intencao a encerra', () => {
    const intencao = {
      acao: 'create_sale',
      jaDito: { produto: 'café' },
      aguardando: 'cadastro_cliente',
      descricao: 'venda de café para o João',
    } as const
    const aberta = montarResumoDeEntidades([msg(snap({ intencao }))])
    expect(aberta.intencao).toEqual(intencao)

    const encerrada = montarResumoDeEntidades([msg(snap({ intencao })), msg(snap({}))])
    expect(encerrada.intencao).toBeUndefined()
  })

  it('snapshot v1 nao tem rotulo e nao entra no resumo', () => {
    const resumo = montarResumoDeEntidades([msg({ customerId: 'cli-1' })])
    expect(resumo.entidades).toEqual([])
  })

  it('snapshot invalido e ignorado sem lancar', () => {
    const resumo = montarResumoDeEntidades([
      msg('lixo'),
      msg({ v: 2, entidades: [{ tipo: 'cliente', ref: 'x', rotulo: '' }] }),
      msg({ v: 9 }),
      msg(snap({ entidades: [joao] })),
    ])
    expect(resumo.entidades).toEqual([joao])
  })

  it('resumo em texto marca os codigos como uso interno', () => {
    const texto = resumoComoTexto(montarResumoDeEntidades([msg(snap({ entidades: [joao] }))]))
    expect(texto).toContain('João')
    expect(texto).toContain('cli-1')
    expect(texto).toMatch(/nunca mostre/i)
  })
})

describe('lerSnapshot', () => {
  it('le o v2 e recusa o resto', () => {
    expect(lerSnapshot(snap({ entidades: [joao] }))?.entidades).toEqual([joao])
    expect(lerSnapshot({ customerId: 'cli-1' })).toBeUndefined()
    expect(lerSnapshot(null)).toBeUndefined()
  })
})
