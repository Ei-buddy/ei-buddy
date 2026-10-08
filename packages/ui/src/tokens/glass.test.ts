import { describe, expect, it } from 'vitest'
import { AA_NORMAL_TEXT, contrastRatio, flatten } from '../contrast.js'
import { brand, dark, light } from './color.js'
import { glass, glassLight } from './glass.js'

/** O vidro do app (NR-160) nao pode derrubar o contraste do texto — RNF-055. */

const sobre = (cor: string) => flatten(cor, dark.bg)

const pares: ReadonlyArray<readonly [string, string, string]> = [
  ['texto sobre a peca de vidro', dark.text, sobre(glass.surface)],
  ['texto de apoio sobre a peca de vidro', dark.textMuted, sobre(glass.surface)],
  ['texto sobre o campo rebaixado', dark.text, sobre(glass.inset)],
  ['texto de apoio sobre o campo rebaixado', dark.textMuted, sobre(glass.inset)],
  ['texto sobre o ativo azul', glass.activeText, glass.activeSolid],
  ['texto de apoio sobre o painel', dark.textMuted, glass.panelSolid],
]

describe('vidro do app atende ao WCAG AA', () => {
  it.each(pares)('%s', (_nome, frente, fundo) => {
    expect(contrastRatio(frente, fundo)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  })
})

describe('vidro claro do app atende ao WCAG AA', () => {
  const pecaClara = flatten(glassLight.surface, light.bgMuted)
  const paresClaro: ReadonlyArray<readonly [string, string, string]> = [
    ['texto sobre a peca clara', light.text, pecaClara],
    ['texto de apoio sobre a peca clara', light.textMuted, pecaClara],
    /* O app usa `textSecondary` como texto de apoio no claro: o `textMuted`
       do web fica a 4,4:1 do campo rebaixado. */
    [
      'texto de apoio do app sobre o campo claro',
      light.textSecondary,
      flatten(glassLight.inset, pecaClara),
    ],
    ['texto sobre o ativo azul chapado', glassLight.activeText, glassLight.activeSolid],
    ['texto de apoio sobre o painel claro', light.textMuted, glassLight.panelSolid],
    ['acento de texto sobre a peca clara', brand.accentText, pecaClara],
  ]
  it.each(paresClaro)('%s', (_nome, frente, fundo) => {
    expect(contrastRatio(frente, fundo)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  })
})
