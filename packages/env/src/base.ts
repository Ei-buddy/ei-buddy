import { z } from 'zod'

/**
 * Variaveis comuns a qualquer processo Node do sistema — ambientes.md#matriz.
 *
 * As chaves ficam SCREAMING_SNAKE_CASE, iguais ao nome real da variavel: o
 * objeto validado espelha o .env de proposito, para que `env.DATABASE_URL` seja
 * buscavel pelo mesmo nome nos dois lugares.
 */

export const nodeEnvSchema = z.enum(['development', 'production', 'test'], {
  error: 'NODE_ENV precisa ser development, production ou test.',
})

export const logLevelSchema = z
  .enum(['debug', 'info', 'warn', 'error'], {
    error: 'LOG_LEVEL precisa ser debug, info, warn ou error.',
  })
  .default('info')

export const tzSchema = z.string().min(1, 'TZ nao pode ser vazia.').default('America/Sao_Paulo')

/**
 * Variavel opcional em que VAZIO significa AUSENTE.
 *
 * Nasceu de um defeito que derrubava a api inteira. `.env.example` — o arquivo
 * que `pnpm setup` copia — traz `SECRETS_KEY=` sem valor, porque a chave e
 * gerada por quem instala. Com `z.string().optional()`, isso vira a string
 * vazia e nao `undefined`: a guarda `if (env.SECRETS_KEY === undefined)` nao
 * pegava, o codigo seguia para `lerChaveDeSegredo('')`, e o processo morria no
 * boot com "precisa de 32 bytes em base64, e veio com 0".
 *
 * O efeito para quem instalava seguindo a documentacao era o pior possivel: a
 * api nao subia, o web nao conseguia criar conta nem entrar, e a mensagem
 * apontava para uma chave de cifragem que nada tem a ver com login.
 *
 * "Nao definida" e "definida vazia" sao a mesma coisa num arquivo `.env`, e o
 * lugar de dizer isso e aqui — uma vez, para todos os processos — e nao em cada
 * `if` que consome a variavel.
 */
export const opcionalNaoVazia = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v))

export const baseEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,
  TZ: tzSchema,
})

export type BaseEnv = z.infer<typeof baseEnvSchema>

/**
 * Nome do provedor de um adapter — pagamentos, fiscal, WhatsApp, banking,
 * agente, autenticacao.
 *
 * Varios provedores ja fecharam (Asaas, Focus, Mastra, Meta Cloud API,
 * Better Auth). O schema nao enumera nomes: o adapter que ainda nao existe
 * nao pode barrar o boot. `fake` e o default local — ambientes.md#modo-fake.
 */
export const providerSchema = z
  .string()
  .min(1, 'Nome do provedor nao pode ser vazio.')
  .default('fake')
