import type { BarcodeDecoder } from './types.js'

const FIXTURE_UNICO = new Set(['7891234567895'])
const MARCADOR_EAN = /^\d+$/

/** Monta bytes de fixture a partir de um marcador UTF-8. */
export function bytesFromMarker(marker: string): Uint8Array {
  return new TextEncoder().encode(marker)
}

export class FakeBarcodeDecoder implements BarcodeDecoder {
  decode(input: { mimeType: string; bytes: Uint8Array }): { codes: string[] } {
    if (input.bytes.length === 0) return { codes: [] }
    const marker = new TextDecoder('utf-8').decode(input.bytes)
    if (marker.includes('\n')) {
      const codes = marker
        .split('\n')
        .map((linha) => linha.trim())
        .filter((linha) => linha.length > 0)
      return { codes }
    }
    if (FIXTURE_UNICO.has(marker)) return { codes: [marker] }
    if (MARCADOR_EAN.test(marker)) return { codes: [marker] }
    return { codes: [] }
  }
}
