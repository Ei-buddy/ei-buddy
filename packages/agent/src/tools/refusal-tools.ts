import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import {
  TEXTO_RECUSA_BANCO,
  TEXTO_RECUSA_CERTIFICADO,
  TEXTO_RECUSA_CONTA_CONTATO,
  TEXTO_RECUSA_NOTA,
} from '../catalog.js'
import { semNulos } from './shared.js'

const semArgumentos = z.preprocess(semNulos, z.object({}).passthrough())

function recusa(id: string, descricao: string, mensagem: string) {
  return createTool({
    id,
    description: descricao,
    inputSchema: semArgumentos,
    execute: async () => ({ status: 'regra', mensagem }),
  })
}

/**
 * Recusas por regra — RF-149, RF-150, RF-151.
 *
 * A regra (o que não se faz por aqui, que nada foi feito e onde fazer) vem
 * do sistema; o modelo só a redige no tom da conversa (FR-033).
 */
export function ferramentasDeRecusa() {
  return {
    refuse_certificate: recusa(
      'refuse_certificate',
      'Use para certificado A1, senha de certificado, arquivo PFX ou cadastro de emitente. Não peça arquivo nem senha.',
      TEXTO_RECUSA_CERTIFICADO,
    ),
    refuse_banking: recusa(
      'refuse_banking',
      'Use para importar extrato OFX/CSV, Open Finance ou conciliação bancária. Não peça o arquivo.',
      TEXTO_RECUSA_BANCO,
    ),
    refuse_invoice_command: recusa(
      'refuse_invoice_command',
      'Use para emitir ou cancelar nota/NFC-e por comando avulso. A nota segue a venda.',
      TEXTO_RECUSA_NOTA,
    ),
    refuse_delete_account_or_contact: recusa(
      'refuse_delete_account_or_contact',
      'Use para apagar conta bancária ou contato da ficha do cliente. Nada é removido.',
      TEXTO_RECUSA_CONTA_CONTATO,
    ),
  }
}
