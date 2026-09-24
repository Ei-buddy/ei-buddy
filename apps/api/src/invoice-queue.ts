import type { IssueInvoiceRequest } from '@na-regua/contracts'
import type { InvoiceQueue } from '@na-regua/core'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { motivoDoErro } from './motivo-do-erro.js'

/**
 * Produtor da fila de emissao — NR-042, RNF-004.
 *
 * A venda fecha sem esperar a SEFAZ: a api enfileira e responde. Quem fala com
 * o provedor e o worker, com espera crescente e fila de descarte.
 *
 * O nome da fila e repetido aqui em vez de importado de `apps/worker`: um app
 * nao importa o outro, e o acoplamento entre eles e o NOME no Redis, nao um
 * modulo TypeScript. Trocar o nome de um lado sem o outro quebraria — e o
 * comentario e o que faz alguem procurar o par.
 */
const FILA_DE_EMISSAO = 'invoice-issue'

/**
 * O id do job E o id da venda.
 *
 * E o que torna o pedido idempotente sem contador nem consulta: o BullMQ recusa
 * job com id repetido, entao pedir a nota da mesma venda duas vezes nao cria
 * dois jobs. Nota duplicada e problema fiscal, e esta e a primeira das tres
 * defesas — depois vem o `ref` do provedor e a guarda em `db`.
 *
 * Prefixado pela empresa porque id de venda e unico por tabela, e a chave do
 * Redis e global.
 */
const jobId = (companyId: string, saleId: string): string => `${companyId}-${saleId}`

export function createInvoiceQueue(connection: Redis): InvoiceQueue {
  const fila = new Queue(FILA_DE_EMISSAO, { connection })

  /*
   * O BullMQ DUPLICA a conexao, e a copia nasce sem ouvinte de `error`.
   *
   * O cliente que chega aqui ja tem o dele (ver `getRedis`), mas o `Queue`
   * chama `.duplicate()` internamente e o clone comeca surdo. `EventEmitter` do
   * Node LANCA ao emitir `error` sem ouvinte, entao subir a api com o Redis
   * fora derrubava o processo aqui — depois de o cliente original ja ter
   * avisado educadamente que o Redis estava fora.
   *
   * Enfileirar sem Redis vai falhar de qualquer jeito, e falhar e o certo: a
   * nota nao saiu. O que nao pode e a api inteira cair junto — venda, cadastro
   * e login nao dependem de fila nenhuma.
   */
  fila.on('error', (erro: Error) => {
    console.warn(
      JSON.stringify({
        level: 40,
        msg: 'fila de emissao indisponivel — a nota nao sera enfileirada; ver /health',
        motivo: motivoDoErro(erro),
      }),
    )
  })

  return {
    enqueue: async (request: IssueInvoiceRequest) => {
      await fila.add(FILA_DE_EMISSAO, request, {
        jobId: jobId(request.companyId, request.saleId),
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 24 * 3600, count: 1_000 },
        /*
         * Falha FICA na fila — RNF-062. Nota que nao saiu e dinheiro do lojista
         * pendurado com a Receita: some-la faria o problema desaparecer da tela
         * sem desaparecer da vida dele.
         */
        removeOnFail: false,
      })
    },
  }
}
