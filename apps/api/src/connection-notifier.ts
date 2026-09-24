import type { SendTextRequest } from '@na-regua/contracts'
import type { ConnectionNotifier } from '@na-regua/core'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { motivoDoErro } from './motivo-do-erro.js'

/**
 * Produtor do aviso de pedido de conexao — ADR-0008, RF-04.
 *
 * Reaproveita a MESMA fila `whatsapp-send` que `charge-overdue` ja usa (ver
 * `apps/worker/src/queues.ts`) — nao existe canal de notificacao in-app
 * persistido no projeto. O nome da fila e repetido aqui, e nao importado do
 * worker, pelo mesmo motivo de `invoice-queue.ts`: o acoplamento entre os
 * dois apps e o NOME no Redis, nao um modulo TypeScript.
 */
const FILA_DE_WHATSAPP = 'whatsapp-send'

export function createConnectionNotifier(connection: Redis): ConnectionNotifier {
  const fila = new Queue(FILA_DE_WHATSAPP, { connection })

  /* Mesmo motivo do `invoice-queue.ts`: o clone que o BullMQ faz da conexao
     nasce sem ouvinte de `error`, e o Node lanca ao emitir sem um. */
  fila.on('error', (erro: Error) => {
    console.warn(
      JSON.stringify({
        level: 40,
        msg: 'fila de whatsapp indisponivel — aviso de conexao nao sera enfileirado',
        motivo: motivoDoErro(erro),
      }),
    )
  })

  return {
    notifyRequestReceived: async (pedido) => {
      const mensagem: SendTextRequest = {
        companyId: pedido.targetCompanyId,
        to: pedido.targetPhone,
        consent: { basis: 'own_user' },
        /* Idempotente por PEDIDO: chamar duas vezes para o mesmo pedido nao
           duplica o aviso — nao ha reenvio de conexao hoje, mas o campo e
           obrigatorio no contrato e o id do pedido e a chave natural. */
        idempotencyKey: pedido.id,
        requestedAt: new Date().toISOString(),
        body:
          `${pedido.requesterCompanyName} quer se conectar com a ${pedido.targetCompanyName} ` +
          `no EiBuddy. Entre no app para aceitar ou recusar.`,
      }

      await fila.add(FILA_DE_WHATSAPP, mensagem, {
        /* O id do JOB e o id do PEDIDO — chamar isto duas vezes para o mesmo
           pedido nao cria um segundo aviso, o BullMQ recusa o id repetido. */
        jobId: pedido.id,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 24 * 3600, count: 1_000 },
        removeOnFail: false,
      })
    },
  }
}
