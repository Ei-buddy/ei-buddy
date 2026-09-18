import { describe, expect, it } from 'vitest'
import { bytesFromMarker, FakeBarcodeDecoder } from './barcode-decoder.js'

const decoder = new FakeBarcodeDecoder()

describe('FakeBarcodeDecoder', () => {
  it('bytes vazios devolvem zero codigos', () => {
    expect(decoder.decode({ mimeType: 'image/jpeg', bytes: new Uint8Array() }).codes).toEqual([])
  })

  it('marcador conhecido devolve um codigo', () => {
    const bytes = bytesFromMarker('7891234567895')
    expect(decoder.decode({ mimeType: 'image/jpeg', bytes }).codes).toEqual(['7891234567895'])
  })

  it('marcador com newline devolve varios codigos', () => {
    const bytes = bytesFromMarker('7891234567895\n7899876543210')
    expect(decoder.decode({ mimeType: 'image/png', bytes }).codes).toEqual([
      '7891234567895',
      '7899876543210',
    ])
  })

  it('marcador desconhecido devolve zero codigos', () => {
    const bytes = bytesFromMarker('desconhecido')
    expect(decoder.decode({ mimeType: 'image/webp', bytes }).codes).toEqual([])
  })

  it('marcador numerico EAN devolve um codigo', () => {
    const bytes = bytesFromMarker('0000000000000')
    expect(decoder.decode({ mimeType: 'image/jpeg', bytes }).codes).toEqual(['0000000000000'])
  })
})
