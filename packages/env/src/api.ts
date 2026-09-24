import { z } from 'zod'
import { baseEnvSchema, opcionalNaoVazia, providerSchema } from './base.js'
import { parseEnv } from './parse.js'

/** Caminho default relativo a raiz do repo. Ausente/vazio no .env cai aqui. */
export const DEFAULT_AGENT_STUDIO_PRESETS = 'packages/agent/studio/presets.json'

/**
 * Variaveis que `apps/api` precisa para subir — ambientes.md#matriz.
 *
 * So entram aqui variaveis que o processo realmente le hoje, mais as
 * marcadas Obr. na matriz que ja tem consumidor no codigo (AUTH_PROVIDER e
 * JWT_SECRET, por DEC-008). As de PagMaxx, fiscal e Open Finance ficam de
 * fora ate os adapters existirem — colocar aqui uma lista de campos
 * obrigatorios que nada consome ainda so far barrar o boot local sem
 * necessidade.
 */
/** Dias inteiros e positivos, ou ausente. Vazio conta como ausente. */
const diasOpcionais = z.preprocess((v) => {
  if (v === undefined || v === '') return undefined
  return v
}, z.coerce.number().int().positive().optional())

export const apiEnvSchema = baseEnvSchema.extend({
  API_PORT: z.coerce
    .number({ error: 'API_PORT precisa ser um numero.' })
    .int('API_PORT precisa ser um numero inteiro.')
    .positive('API_PORT precisa ser maior que zero.')
    .max(65535, 'API_PORT precisa ser no maximo 65535.')
    .default(3333),

  API_URL: z.string().url('API_URL precisa ser uma URL valida, ex.: http://localhost:3333'),

  /**
   * Onde a web mora — vai no link do e-mail de redefinir senha (NR-014).
   *
   * Da configuracao, e nunca do `Host` da requisicao: com o cabecalho de quem
   * pediu, um atacante faria a vitima receber um e-mail legitimo com link para
   * o dominio dele, e o token iria junto no clique.
   */
  WEB_URL: z
    .string()
    .url('WEB_URL precisa ser uma URL valida, ex.: http://localhost:3000')
    .default('http://localhost:3000'),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL e obrigatoria. Copie .env.example para .env ou rode `pnpm setup`.')
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL precisa comecar com postgresql:// ou postgres://.'),

  REDIS_URL: z
    .string()
    .min(1, 'REDIS_URL e obrigatoria. Copie .env.example para .env ou rode `pnpm setup`.')
    .regex(/^rediss?:\/\//, 'REDIS_URL precisa comecar com redis:// ou rediss://.'),

  /** DEC-008. `fake` localmente — ambientes.md#modo-fake. */
  AUTH_PROVIDER: providerSchema,
  /**
   * Segredo do Better Auth — ADR-0002 (opcao D), NR-084.
   *
   * Opcional AQUI e obrigatoria LA: quem exige e `criarIdentidade`, e so quando
   * `AUTH_PROVIDER=better-auth`. Torna-la obrigatoria neste schema barraria o
   * boot local, onde o provedor e o falso e este valor nao existe — mesmo
   * criterio de `SECRETS_KEY`.
   *
   * Os 32 caracteres sao o piso que a propria biblioteca avisa em log quando
   * nao e atendido. Conferir aqui transforma um aviso que ninguem le numa
   * recusa de subir.
   */
  BETTER_AUTH_SECRET: opcionalNaoVazia.refine(
    (v: string | undefined) => v === undefined || v.length >= 32,
    { message: 'BETTER_AUTH_SECRET precisa de pelo menos 32 caracteres.' },
  ),
  /**
   * Comprimento nao e validado aqui: politica de segredo forte e decisao do
   * adapter de autenticacao (DEC-008), nao deste pacote.
   */
  JWT_SECRET: z.string().min(1, 'JWT_SECRET e obrigatoria. Defina um valor em .env.'),

  /**
   * Chave de 32 bytes em base64 que cifra os segredos de lojista — RNF-022.
   *
   * Opcional: sem ela a api sobe e a configuracao de emissao fiscal fica
   * indisponivel, o que e melhor que nao subir. A rota recusa com mensagem
   * propria, e `lerChaveDeSegredo` (em `db`) confere tamanho e forca — validar
   * nos dois lugares daria duas respostas para "esta chave serve".
   */
  SECRETS_KEY: opcionalNaoVazia,

  /**
   * Runtime do assistente — ADR-0010.
   *
   * `fake` nao chama a OpenAI e reconhece so as consultas da US-047, o bastante
   * para o POST /agent/messages funcionar local sem chave. `mastra` e o
   * provedor real, e exige `OPENAI_API_KEY`.
   *
   * Em producao o `fake` nao e servido — publicar um reconhecedor de tres
   * frases como se fosse o assistente seria mentir para o lojista. Mas a api
   * SOBE assim: quem decide e `motivoDoAgenteIndisponivel` (em
   * `apps/api/composition.ts`), e o efeito e 503 em `/agent/messages`, nao
   * processo fora do ar. Mesmo criterio de `SECRETS_KEY` logo acima.
   */
  AGENT_PROVIDER: z.enum(['fake', 'mastra']).default('fake'),
  OPENAI_API_KEY: opcionalNaoVazia,
  AGENT_MODEL: z.string().min(1).default('openai/gpt-4o-mini'),
  /**
   * Porteiro do harness (FR-001b / NR-060).
   *
   * `1` libera `POST /agent/messages` quando `NODE_ENV=production` (staging
   * com env proximo de prod). Ausente, vazio ou `0` = desligado em producao.
   * Nao-producao nao precisa desta flag. `fake` continua barrado em producao
   * mesmo com a flag — o canal nao e produto do lojista nesta fatia.
   */
  AGENT_HARNESS: z.preprocess((v) => {
    if (v === undefined || v === '' || v === '0') return false
    if (v === '1') return true
    return v
  }, z.boolean().default(false)),
  /**
   * Caminho do arquivo de presets do harness Studio (NR-121).
   *
   * Opcional: ausente ou vazio aponta para `packages/agent/studio/presets.json`
   * (relativo a raiz do repo). IDs reais de fixture ficam fora do git.
   */
  AGENT_STUDIO_PRESETS: z.preprocess((v) => {
    if (v === undefined) return DEFAULT_AGENT_STUDIO_PRESETS
    if (typeof v === 'string' && v.trim() === '') return DEFAULT_AGENT_STUDIO_PRESETS
    return v
  }, z.string().min(1)),
  /**
   * Ausente ou vazio = sem teto configurado. A medicao (RNF-073) entra com o
   * runtime; o numero so existe quando alguem definiu um.
   */
  AGENT_MONTHLY_BUDGET_CENTS: z.preprocess((v) => {
    if (v === undefined || v === '') return undefined
    return v
  }, z.coerce.number().int().positive().optional()),

  /**
   * Chave provisoria de `/admin/lista-vip*` — NR-111.
   *
   * Antes de existir o primeiro Super Admin, quem manda esta chave no
   * cabecalho `x-waitlist-admin-key` entra sem sessao. Opcional: ausente,
   * so o caminho normal (sessao + isPlatformAdmin) funciona — mesmo criterio
   * de `SECRETS_KEY`, uma funcionalidade a menos e melhor que travar o boot.
   */
  WAITLIST_ADMIN_KEY: opcionalNaoVazia,

  /**
   * Periodo de teste e tolerancia da assinatura — RF-110, RF-116, NR-063.
   *
   * **Sem default de proposito.** Prazo de teste, aviso e tolerancia sao a
   * QST-002, ainda em aberto (DEC-010): escrever um numero aqui seria inventar
   * decisao de produto e, pior, escondê-la num arquivo de configuracao onde
   * ninguem procuraria por ela.
   *
   * Ausentes, a api sobe e o cadastro de empresa continua funcionando — a
   * empresa so nasce sem assinatura, que e o estado que `getSubscription`
   * trata como "pode lancar". Mesmo criterio de `SECRETS_KEY`: uma
   * funcionalidade a menos e melhor que nao subir.
   *
   * Os tres andam juntos: meio periodo de teste configurado seria um teste que
   * comeca e nunca avisa que vai acabar.
   */
  BILLING_TRIAL_DAYS: diasOpcionais,
  BILLING_TRIAL_WARNING_DAYS: diasOpcionais,
  /** Zero e valido: significa bloquear no vencimento, sem tolerancia. */
  BILLING_GRACE_DAYS: z.preprocess((v) => {
    if (v === undefined || v === '') return undefined
    return v
  }, z.coerce.number().int().min(0).optional()),
  /** Plano em que o teste roda. Texto, como `subscriptions.plan_code`. */
  BILLING_TRIAL_PLAN: opcionalNaoVazia,

  /**
   * Chave da CONTA-PAI no Asaas — ADR-0004, NR-063.
   *
   * E com ela que a NOSSA mensalidade e cobrada do lojista. Nao confundir com
   * a chave da subconta de cada loja, que cobra as vendas DELA e mora
   * cifrada em `company_payment_credentials` — uma e env global, a outra e
   * segredo por empresa, e trocar as duas faria a mensalidade cair na conta do
   * proprio lojista.
   *
   * Opcional: sem ela a rota de webhook da assinatura responde 503 e o resto
   * do sistema sobe. Mesmo criterio de `SECRETS_KEY`.
   */
  ASAAS_API_KEY: opcionalNaoVazia,

  /**
   * Segredo do webhook do Asaas — RNF-028, NR-044.
   *
   * Da PLATAFORMA e nao da loja: o corpo precisa ser verificado antes de se
   * saber de qual empresa ele fala. Ausente, o adapter recusa TODO webhook em
   * vez de aceitar sem conferir.
   */
  ASAAS_WEBHOOK_AUTH_TOKEN: opcionalNaoVazia,

  /**
   * WhatsApp — Meta Cloud API — ADR-0014, NR-046.
   *
   * `fake` e o padrao (CI e local). Com `meta`, a rota do webhook exige token,
   * phone number id, App Secret e verify token; ausentes aqui, a api SOBE e a
   * rota responde 503 — mesmo criterio de `ASAAS_WEBHOOK_AUTH_TOKEN`.
   *
   * `WHATSAPP_WEBHOOK_SECRET` e o App Secret do HMAC `X-Hub-Signature-256`,
   * nao o Bearer de envio (`WHATSAPP_API_TOKEN`). O id da conta WhatsApp
   * Business nao e variavel de ambiente: o adapter usa o Phone Number ID.
   */
  WHATSAPP_PROVIDER: z.enum(['fake', 'meta']).default('fake'),
  WHATSAPP_API_TOKEN: opcionalNaoVazia,
  WHATSAPP_PHONE_NUMBER_ID: opcionalNaoVazia,
  WHATSAPP_WEBHOOK_SECRET: opcionalNaoVazia,
  WHATSAPP_VERIFY_TOKEN: opcionalNaoVazia,
})

export type ApiEnv = z.infer<typeof apiEnvSchema>

/** Valida `process.env` para `apps/api`. Chame uma vez, no topo do processo. */
export function loadApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return parseEnv(apiEnvSchema, source, '@na-regua/api')
}
