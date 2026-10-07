import { describe, expect, it } from 'vitest'
import { AA_NORMAL_TEXT, contrastRatio, flatten } from '../contrast.js'
import { dark } from './color.js'
import { glass } from './glass.js'

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
