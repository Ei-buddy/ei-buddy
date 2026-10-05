import { describe, expect, it } from 'vitest'
import { dataDoTexto, mascaraData } from './format'

describe('data digitada', () => {
  it('mascara enquanto digita', () => {
    expect(mascaraData('0510')).toBe('05/10')
    expect(mascaraData('05102026')).toBe('05/10/2026')
  })

  it('converte para AAAA-MM-DD e recusa data que nao existe', () => {
    expect(dataDoTexto('05/10/2026')).toBe('2026-10-05')
    /* 31/02 viraria 3 de marco em silencio com `new Date`. */
    expect(dataDoTexto('31/02/2026')).toBeNull()
    expect(dataDoTexto('5/10/26')).toBeNull()
  })
})
