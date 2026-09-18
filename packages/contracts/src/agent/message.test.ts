import { describe, expect, it } from 'vitest'
import { agentMessageInputSchema, agentReplySchema } from './message.js'

describe('mensagem ao assistente', () => {
  it('aceita texto e apara as bordas', () => {
    expect(agentMessageInputSchema.parse({ text: '  quanto vendi hoje?  ' }).text).toBe(
      'quanto vendi hoje?',
    )
  })

  it.each(['', '   ', { text: '' }])('recusa vazio (%j)', (entrada) => {
    expect(agentMessageInputSchema.safeParse(entrada).success).toBe(false)
  })

  it('recusa campo extra', () => {
    expect(agentMessageInputSchema.safeParse({ text: 'oi', canal: 'whatsapp' }).success).toBe(false)
  })

  it('aceita so imagem', () => {
    const r = agentMessageInputSchema.parse({
      image: { mimeType: 'image/jpeg', dataBase64: 'aGVsbG8=' },
    })
    expect(r.text).toBeUndefined()
    expect(r.image?.mimeType).toBe('image/jpeg')
  })

  it('aceita texto e imagem juntos', () => {
    const r = agentMessageInputSchema.parse({
      text: 'no pix',
      image: { mimeType: 'image/png', dataBase64: 'aGVsbG8=' },
    })
    expect(r.text).toBe('no pix')
    expect(r.image?.mimeType).toBe('image/png')
  })

  it('recusa sem texto nem imagem', () => {
    expect(agentMessageInputSchema.safeParse({}).success).toBe(false)
  })

  it('recusa texto vazio sem imagem', () => {
    expect(agentMessageInputSchema.safeParse({ text: '   ' }).success).toBe(false)
  })

  it('recusa mime invalido', () => {
    expect(
      agentMessageInputSchema.safeParse({
        image: { mimeType: 'image/gif', dataBase64: 'aGVsbG8=' },
      }).success,
    ).toBe(false)
  })

  it('aceita resposta com confirmacao opcional', () => {
    const r = agentReplySchema.parse({
      kind: 'confirmation',
      text: 'Confirma a venda?',
      confirmationId: 'conf-1',
    })
    expect(r.confirmationId).toBe('conf-1')
  })
})
