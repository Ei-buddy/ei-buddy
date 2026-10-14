import { describe, expect, it } from 'vitest'
import { lerCsv } from './planilha'

describe('lerCsv', () => {
  it('detecta ponto e virgula e respeita aspas com o separador dentro', () => {
    const r = lerCsv('﻿Nome;Valor\n"Silva; Maria";12,90\n\nJoão;5\n')
    expect(r.colunas).toEqual(['Nome', 'Valor'])
    expect(r.linhas).toEqual([
      ['Silva; Maria', '12,90'],
      ['João', '5'],
    ])
  })

  it('le aspa escapada e quebra de linha do Windows', () => {
    const r = lerCsv('descricao,preco\r\n"Cafe ""extra""",10\r\n')
    expect(r.linhas).toEqual([['Cafe "extra"', '10']])
  })
})
