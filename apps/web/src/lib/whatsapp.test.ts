import { describe, expect, it } from 'vitest'
import {
  eCelular,
  enderecoDoAplicativo,
  enderecoDoCelular,
  enderecoDoWeb,
  telefoneParaWhatsApp,
} from './whatsapp'

/**
 * WhatsApp do orcamento — achado do QA: tentar o aplicativo e, sem ele, o
 * WhatsApp Web. O que estes testes guardam e o ENDERECO de cada caminho: o
 * texto inteiro (quebras de linha, acentos, R$) tem que chegar igual.
 */
const texto = 'Orçamento nº 12\nArroz 5kg x2 — R$ 50,00\nTotal: R$ 50,00 & frete'

describe('enderecos', () => {
  it('aplicativo: whatsapp://send com o texto codificado', () => {
    const url = enderecoDoAplicativo({ texto })
    expect(url.startsWith('whatsapp://send?')).toBe(true)
    expect(new URLSearchParams(url.split('?')[1]).get('text')).toBe(texto)
  })

  it('web: web.whatsapp.com/send com o mesmo texto', () => {
    const url = new URL(enderecoDoWeb({ texto }))
    expect(url.host).toBe('web.whatsapp.com')
    expect(url.pathname).toBe('/send')
    expect(url.searchParams.get('text')).toBe(texto)
    expect(url.searchParams.has('phone')).toBe(false)
  })

  it('com telefone, vai direto para a conversa (com o 55)', () => {
    const url = new URL(enderecoDoWeb({ texto, telefone: '(41) 98888-1111' }))
    expect(url.searchParams.get('phone')).toBe('5541988881111')
    expect(enderecoDoAplicativo({ texto, telefone: '41988881111' })).toContain(
      'phone=5541988881111',
    )
  })

  it('celular: wa.me, que o sistema abre no aplicativo', () => {
    const url = new URL(enderecoDoCelular({ texto }))
    expect(url.host).toBe('wa.me')
    expect(url.searchParams.get('text')).toBe(texto)
    expect(enderecoDoCelular({ texto, telefone: '41988881111' })).toMatch(
      /^https:\/\/wa\.me\/5541988881111\?text=/,
    )
  })
})

describe('telefoneParaWhatsApp', () => {
  it('poe o 55 so quando falta', () => {
    expect(telefoneParaWhatsApp('41988881111')).toBe('5541988881111')
    expect(telefoneParaWhatsApp('5541988881111')).toBe('5541988881111')
    expect(telefoneParaWhatsApp('+55 (41) 3333-4444')).toBe('554133334444')
  })

  it('sem numero, vazio', () => {
    expect(telefoneParaWhatsApp(null)).toBe('')
    expect(telefoneParaWhatsApp('')).toBe('')
  })
})

describe('eCelular', () => {
  it('reconhece Android e iPhone', () => {
    expect(eCelular('Mozilla/5.0 (Linux; Android 14; SM-A546E) Mobile Safari/537.36')).toBe(true)
    expect(eCelular('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true)
  })

  it('computador nao e celular', () => {
    expect(
      eCelular(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
      ),
    ).toBe(false)
  })
})
