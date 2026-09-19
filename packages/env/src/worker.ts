import { z } from 'zod'
import { baseEnvSchema, opcionalNaoVazia } from './base.js'
import { parseEnv } from './parse.js'

/**
 * Variaveis que `apps/worker` precisa para subir.
 *
 * DATABASE_URL fica fora por enquanto: o worker ainda nao tem raiz de
 * composicao nem toca o banco (ver apps/worker/README.md) — os consumidores
 * reais entram a partir do NR-041. Exigir a variavel antes disso barraria o
 * boot por algo que o processo nao usa.
 */
/** Dias inteiros e positivos, ou ausente. Vazio conta como ausente. */
const diasOpcionais = z.preprocess((v) => {
  if (v === undefined || v === '') return undefined
  return v
}, z.coerce.number().int().positive().optional())

export const workerEnvSchema = baseEnvSchema.extend({
  REDIS_URL: z
    .string()
    .min(1, 'REDIS_URL e obrigatoria. Copie .env.example para .env ou rode `pnpm setup`.')
    .regex(/^rediss?:\/\//, 'REDIS_URL precisa comecar com redis:// ou rediss://.'),

  /**
   * De onde sai a nota fiscal — DEC-004, NR-042.
   *
   * `fake` nao emite nada e serve ao desenvolvimento; `focusnfe` fala com o
   * provedor de verdade. Bandeira explicita, como `AUTH_PROVIDER`: o modo que
   * nao emite documento fiscal precisa ser uma escolha declarada, e nunca um
   * padrao que alguem herda sem perceber.
   */
  FISCAL_PROVIDER: z.enum(['fake', 'focusnfe']).default('fake'),

  /** Homologacao NAO tem validade fiscal. O padrao e ela, de proposito. */
  FISCAL_AMBIENTE: z.enum(['homologacao', 'producao']).default('homologacao'),

  /**
   * Entra porque `focusnfe` le as credenciais cifradas do banco.
   *
   * Opcional: com `FISCAL_PROVIDER=fake` o worker nao toca no banco fiscal, e
   * exigir a variavel travaria quem so processa fila. Quem cobra a falta e a
   * composicao, quando o provedor real e escolhido.
   */
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL precisa comecar com postgresql:// ou postgres://.')
    .optional(),

  /**
   * Chave de 32 bytes em base64 que cifra os segredos de lojista — RNF-022.
   *
   * O tamanho e a forca sao conferidos por `lerChaveDeSegredo`, em `db`, e nao
   * aqui: validar nos dois lugares daria duas respostas para "esta chave
   * serve". Gere com `openssl rand -base64 32`.
   */
  SECRETS_KEY: opcionalNaoVazia,

  /**
   * Prazos da assinatura, para a varredura — RF-111, RF-117, NR-063.
   *
   * **Sem default, como na api**, e pelo mesmo motivo: sao a QST-002. Um
   * numero aqui bloquearia lojas por um prazo que ninguem escolheu — e num
   * arquivo de configuracao, onde ninguem procuraria a decisao.
   *
   * Ausentes, o job de varredura responde `skipped` dizendo por que, em vez
   * de nao existir. O worker sobe do mesmo jeito.
   */
  BILLING_TRIAL_DAYS: diasOpcionais,
  BILLING_TRIAL_WARNING_DAYS: diasOpcionais,
  /** Zero e valido: bloquear no vencimento, sem tolerancia. Quem escolhe, escolhe. */
  BILLING_GRACE_DAYS: z.preprocess((v) => {
    if (v === undefined || v === '') return undefined
    return v
  }, z.coerce.number().int().min(0).optional()),
})

export type WorkerEnv = z.infer<typeof workerEnvSchema>

/** Valida `process.env` para `apps/worker`. Chame uma vez, no topo do processo. */
export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return parseEnv(workerEnvSchema, source, '@na-regua/worker')
}
