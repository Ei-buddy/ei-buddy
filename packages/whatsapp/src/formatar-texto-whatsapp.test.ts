import { describe, expect, it } from 'vitest'
import { formatarTextoWhatsApp } from './formatar-texto-whatsapp.js'

const JUNCAO = '\u2060'

describe('formatarTextoWhatsApp', () => {
  it.each([
    ['**Total**', '*Total*'],
    ['__Total__', '*Total*'],
    ['# Título', '*Título*'],
    ['## Título', '*Título*'],
    ['[boleto](https://exemplo)', 'boleto (https://exemplo)'],
    ['[https://exemplo](https://exemplo)', 'https://exemplo'],
    ['* item', '- item'],
    ['*já em negrito*', '*já em negrito*'],
    ['_itálico_', '_itálico_'],
    ['~riscado~', '~riscado~'],
    ['```código```', '```código```'],
  ] as const)('%s vira a forma do WhatsApp', (entrada, saida) => {
    expect(formatarTextoWhatsApp(entrada)).toBe(saida)
  })

  it('junta as celulas na mesma linha e descarta o separador de tracos', () => {
    const entrada = ['| Produto | Valor |', '| --- | --- |', '| Coca | R$ 10 |'].join('\n')

    expect(formatarTextoWhatsApp(entrada)).toBe(['Produto — Valor', 'Coca — R$ 10'].join('\n'))
  })

  it('poe U+2060 ao lado do asterisco, sublinhado ou til que nao fecha par', () => {
    expect(formatarTextoWhatsApp('Coca*Cola')).toBe(`Coca*${JUNCAO}Cola`)
    expect(formatarTextoWhatsApp('preco_grande')).toBe(`preco_${JUNCAO}grande`)
    expect(formatarTextoWhatsApp('2~3')).toBe(`2~${JUNCAO}3`)
  })

  it('mantem o par bem formado e o codigo entre crases no mesmo texto', () => {
    const entrada = 'veja *já em negrito* e Coca*Cola ```código```'

    const monoespaco = '```código```'
    expect(formatarTextoWhatsApp(entrada)).toBe(
      `veja *já em negrito* e Coca*${JUNCAO}Cola ${monoespaco}`,
    )
  })

  it('troca o marcador da lista sem desfazer o negrito do item', () => {
    expect(formatarTextoWhatsApp('* **Total**')).toBe('- *Total*')
  })

  it('nao deixa # de titulo, asterisco duplo nem link entre colchetes', () => {
    const entrada = [
      '# Título',
      '## Título',
      '**Total**',
      '__Total__',
      '[boleto](https://exemplo)',
      '| A | B |',
      '| --- | --- |',
      '* item',
      '*já em negrito*',
      'Coca*Cola',
      '```código```',
    ].join('\n')
    const saida = formatarTextoWhatsApp(entrada)

    expect(saida).not.toMatch(/^#/m)
    expect(saida).not.toContain('**')
    expect(saida).not.toMatch(/\[[^\]]+\]\([^)]+\)/)
    expect(saida).toContain('```código```')
    expect(saida).toContain('*Título*')
    expect(saida).toContain('*Total*')
    expect(saida).toContain('- item')
    expect(saida).toContain('A — B')
    expect(saida).toContain(`Coca*${JUNCAO}Cola`)
    expect(saida).not.toContain('|')
  })
})
