import { serviceInvoiceCheckSchema, serviceInvoiceRequestSchema } from '@na-regua/contracts'
import { checkServiceInvoiceJob, issueServiceInvoiceJob } from '@na-regua/core'
import { FalhaPermanente } from '../retry.js'
import type { ConsumerDeps, ResultadoDoJob } from './types.js'

/**
 * NFS-e nacional da venda — DEC-031, NR-241.
 *
 * Dois trabalhos, porque a NFS-e e assincrona:
 *
 * - `service-invoice-issue` envia o pedido. A Focus responde "processando", e
 *   o trabalho agenda a primeira consulta.
 * - `service-invoice-check` pergunta de novo, com espera crescente, ate a nota
 *   sair autorizada ou rejeitada (ou acabar o teto de consultas).
 *
 * Como na NFC-e, rejeicao CONCLUI o job: reenviar o mesmo pedido so repetiria
 * a recusa. Falha de infraestrutura SOBE, para o BullMQ tentar de novo — e o
 * emissor consulta antes de reenviar, entao a retentativa nunca duplica a nota.
 */

export async function consumirEmissaoDeServico(
  deps: ConsumerDeps,
  payload: unknown,
): Promise<ResultadoDoJob> {
  if (deps.nfse === undefined) {
    return { outcome: 'skipped', detalhes: { motivo: 'NFS-e sem banco no worker' } }
  }

  const r = serviceInvoiceRequestSchema.safeParse(payload)
  if (!r.success) {
    throw new FalhaPermanente(
      `Pedido de NFS-e invalido: ${r.error.issues.map((i) => i.path.join('.') || 'raiz').join(', ')}`,
    )
  }

  const resultado = await issueServiceInvoiceJob(deps.nfse, r.data)
  return { outcome: resultado.status, detalhes: { saleId: r.data.saleId } }
}

export async function consumirConsultaDeServico(
  deps: ConsumerDeps,
  payload: unknown,
): Promise<ResultadoDoJob> {
  if (deps.nfse === undefined) {
    return { outcome: 'skipped', detalhes: { motivo: 'NFS-e sem banco no worker' } }
  }

  const r = serviceInvoiceCheckSchema.safeParse(payload)
  if (!r.success) throw new FalhaPermanente('Consulta de NFS-e com payload invalido.')

  const resultado = await checkServiceInvoiceJob(deps.nfse, r.data)
  return {
    outcome: resultado === 'nada-a-fazer' ? 'nada-a-fazer' : resultado.status,
    detalhes: { saleId: r.data.saleId, consulta: r.data.checks + 1 },
  }
}
