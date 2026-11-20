import type { ServiceInvoiceRequest } from '@na-regua/contracts'
import type { ServiceInvoiceQueue } from '@na-regua/core'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { motivoDoErro } from './motivo-do-erro.js'

/**
 * A fila de envio da NFS-e nacional — NR-241. O worker consome.
 *
 * O `jobId` leva o instante do pedido, e nao so a venda: a nota rejeitada e
 * pedida de novo depois da correcao, e um id repetido faria o BullMQ ignorar o
 * segundo envio (ele guarda os concluidos por 24 h). Dois cliques no mesmo
 * instante nao chegam aqui: o caso de uso so enfileira quem abriu o pedido.
 */
const FILA = 'service-invoice-issue'

export function createServiceInvoiceQueue(
  connection: Redis,
): Pick<ServiceInvoiceQueue, 'enqueueIssue'> {
  const fila = new Queue(FILA, { connection })

  fila.on('error', (erro: Error) => {
    console.warn(
      JSON.stringify({
        level: 40,
        msg: 'fila da NFS-e indisponivel — o pedido nao sera enfileirado; ver /health',
        motivo: motivoDoErro(erro),
      }),
    )
  })

  return {
    enqueueIssue: async (request: ServiceInvoiceRequest) => {
      await fila.add(FILA, request, {
        jobId: `${request.companyId}-${request.saleId}-nfse-${Date.parse(request.requestedAt)}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 24 * 3600, count: 1_000 },
        removeOnFail: false,
      })
    },
  }
}
