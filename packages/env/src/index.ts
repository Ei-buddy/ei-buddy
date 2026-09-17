/**
 * Configuracao tipada — NR-006.
 *
 * `process.env` e `Record<string, string | undefined>`: nada garante que
 * `DATABASE_URL` exista, que `API_PORT` seja numero, ou que alguem nao tenha
 * digitado `NODE_ENV=production ` com um espaco sobrando. Sem validacao, o
 * erro aparece na primeira vez que o valor errado e usado — as vezes um `?? `
 * mascara isso e o erro nunca aparece, so o comportamento fica errado.
 *
 * Cada app chama seu `load*Env()` uma vez, no topo do processo, antes de
 * subir qualquer coisa. Falha alto e com todos os problemas de uma vez —
 * ambientes.md: "aplicacao falha ao subir se faltar variavel obrigatoria".
 */
export { baseEnvSchema, logLevelSchema, nodeEnvSchema, providerSchema, tzSchema } from './base.js'
export type { BaseEnv } from './base.js'

export { apiEnvSchema, DEFAULT_AGENT_STUDIO_PRESETS, loadApiEnv } from './api.js'
export type { ApiEnv } from './api.js'

export { loadMigrationEnv, migrationEnvSchema } from './migration.js'
export type { MigrationEnv } from './migration.js'
export { loadWorkerEnv, workerEnvSchema } from './worker.js'
export type { WorkerEnv } from './worker.js'

export { parseEnv } from './parse.js'
