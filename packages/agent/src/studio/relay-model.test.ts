import { describe, expect, it } from 'vitest'
import { StudioRelayModel } from './relay-model.js'

describe('StudioRelayModel', () => {
  it('sempre emite tool call process_message com o texto do usuario', async () => {
    const model = new StudioRelayModel()
    const r = await model.doGenerate({
      prompt: [
        { role: 'system', content: 'rele' },
        { role: 'user', content: [{ type: 'text', text: 'quanto vendi hoje?' }] },
      ],
    })
    expect(r.finishReason).toBe('tool-calls')
    expect(r.content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'relay-process-message',
        toolName: 'process_message',
        input: JSON.stringify({ text: 'quanto vendi hoje?' }),
      },
    ])
  })

  it('depois do tool result devolve texto e para — sem segundo hop', async () => {
    const model = new StudioRelayModel()
    const r = await model.doGenerate({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'quanto vendi hoje?' }] },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolName: 'process_message',
              output: { type: 'json', value: { kind: 'answer', text: '1 venda.' } },
            },
          ],
        },
      ],
    })
    expect(r.finishReason).toBe('stop')
    expect(r.content).toEqual([{ type: 'text', text: '1 venda.' }])
  })
})
