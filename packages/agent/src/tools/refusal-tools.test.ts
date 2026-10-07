import { describe, expect, it } from 'vitest'
import {
  TEXTO_RECUSA_BANCO,
  TEXTO_RECUSA_CERTIFICADO,
  TEXTO_RECUSA_CONTA_CONTATO,
  TEXTO_RECUSA_NOTA,
} from '../catalog.js'
import { RESUMO_VAZIO } from '../conversation-context.js'
import { criarLojaDeTeste, ctxDaEmpresa } from '../test-support/loja-de-teste.js'
import { ferramentasDeRecusa } from './refusal-tools.js'
import { ColetorDoTurno, contextoDoTurno } from './shared.js'

const tools = ferramentasDeRecusa() as unknown as Record<
  string,
  { execute: (input: unknown, context: unknown) => Promise<unknown> }
>

describe('refuse_* — a regra vem do sistema, as palavras do modelo (US6)', () => {
  it.each([
    ['refuse_certificate', TEXTO_RECUSA_CERTIFICADO],
    ['refuse_banking', TEXTO_RECUSA_BANCO],
    ['refuse_invoice_command', TEXTO_RECUSA_NOTA],
    ['refuse_delete_account_or_contact', TEXTO_RECUSA_CONTA_CONTATO],
  ])('%s devolve a regra e nao chama caso de uso', async (id, regra) => {
    const loja = criarLojaDeTeste()
    const saida = await tools[id]!.execute(
      {},
      {
        requestContext: contextoDoTurno({
          execucao: ctxDaEmpresa('A'),
          textoDaDona: 'importa meu extrato',
          resumo: RESUMO_VAZIO,
          coletor: new ColetorDoTurno(),
          conversationKey: 'wa:emp-A:1',
          ttlMs: 300_000,
        }),
      },
    )
    expect(saida).toEqual({ status: 'regra', mensagem: regra })
    expect(loja.gravacoes).toEqual([])
  })
})
