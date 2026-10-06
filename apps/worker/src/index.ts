import { loadWorkerEnv } from '@na-regua/env'
import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { montarDeps } from './composition.js'
import { consumidorDe, filasSemConsumidor } from './consumers/index.js'
import { camposDaFalha, log, safeUrl } from './logging.js'
import { DEFAULT_JOB_OPTIONS, QUEUES, type QueueName } from './queues.js'
import { ehPermanente, nivelDaFalha } from './retry.js'

/**
 * Validado no topo do processo, antes de qualquer conexao — NR-006. Antes
 * disso, REDIS_URL ausente caia de volta para 'redis://localhost:6379' sem
 * avisar: inofensivo em dev, perigoso se a mesma falta acontecer fora dele.
 */
const env = loadWorkerEnv()
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })

const queues = new Map<QueueName, Queue>()
const workers: Worker[] = []

for (const name of Object.values(QUEUES)) {
  queues.set(name, new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }))
}

/* Depois de as filas existirem: o enfileirador da varredura precisa delas. */
const deps = montarDeps(queues)

for (const name of Object.values(QUEUES)) {
  const worker = new Worker(
    name,
    async (job) => {
      const consumir = consumidorDe(name)

      if (consumir === undefined) {
        /* Fila sem consumidor registrado. Dizer isso e diferente de fingir que
           processou — ver o comentario em consumers/index.ts. */
        log('warn', 'job recebido em fila sem consumidor', { queue: name, jobId: job.id })
        return { outcome: 'sem-consumidor' }
      }

      const r = await consumir(deps, job.data)

      /* O desfecho vai para o log SEMPRE, inclusive quando e 'rejected': job
         concluido sem dizer o que aconteceu faz uma nota autorizada e uma
         recusada desaparecerem no mesmo silencio. */
      log('info', 'job concluido', {
        queue: name,
        jobId: job.id,
        attempt: job.attemptsMade + 1,
        ...r,
      })

      return r
    },
    { connection, concurrency: 5 },
  )

  /*
   * Falha de job precisa aparecer identificada — RNF-062 exige que ela fique
   * visivel, e "algo falhou" sem fila nem tentativa nao e visibilidade.
   * `attemptsMade` distingue uma falha que se repete de falhas diferentes.
   */
  worker.on('failed', (job, erro) => {
    const tentativa = (job?.attemptsMade ?? 0) + 1
    const info = { tentativa, maxTentativas: DEFAULT_JOB_OPTIONS.attempts }
    const permanente = ehPermanente(erro)

    log(nivelDaFalha(info, erro), permanente ? 'job descartado sem retentar' : 'job falhou', {
      queue: name,
      jobId: job?.id,
      attempt: tentativa,
      maxAttempts: DEFAULT_JOB_OPTIONS.attempts,
      /* O descarte precisa ser encontravel no log agregado — RNF-062. */
      descartado: permanente || tentativa >= DEFAULT_JOB_OPTIONS.attempts,
      permanente,
      ...camposDaFalha(erro, job?.data),
    })
  })

  workers.push(worker)
}

/* `safeUrl` e nao `env.REDIS_URL`: a URL carrega usuario e senha — RNF-022. */
connection.on('ready', () => log('info', 'conectado ao Redis', { redis: safeUrl(env.REDIS_URL) }))
connection.on('error', (erro: Error) => log('error', 'falha no Redis', { error: erro.message }))

log('info', 'worker iniciado', {
  queues: Object.values(QUEUES),
  /* Explicito na subida: fila sem consumidor e coisa que se descobre agora ou
     no dia em que alguem pergunta por que nada aconteceu. */
  semConsumidor: filasSemConsumidor(),
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      log('info', `${signal} recebido, encerrando`)
      await Promise.allSettled(workers.map((w) => w.close()))
      await Promise.allSettled([...queues.values()].map((q) => q.close()))
      await connection.quit()
      process.exit(0)
    })()
  })
}
