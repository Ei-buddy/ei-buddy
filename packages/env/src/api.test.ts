import { describe, expect, it } from 'vitest'
import { loadApiEnv } from './api.js'

/** Conjunto minimo que passa. Cada teste varia um campo por vez. */
const base = {
  NODE_ENV: 'development',
  API_URL: 'http://localhost:3333',
  DATABASE_URL: 'postgresql://naregua:naregua@localhost:5432/naregua',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'dev-only-nao-use-em-producao',
}

describe('loadApiEnv', () => {
  it('aceita o conjunto minimo e aplica os padroes', () => {
    const env = loadApiEnv(base)
    expect(env.API_PORT).toBe(3333)
    expect(env.LOG_LEVEL).toBe('info')
    expect(env.TZ).toBe('America/Sao_Paulo')
    expect(env.AUTH_PROVIDER).toBe('fake')
  })

  it('converte API_PORT de string para numero', () => {
    expect(loadApiEnv({ ...base, API_PORT: '8080' }).API_PORT).toBe(8080)
  })

  it('falha listando TODAS as variaveis com problema de uma vez, nao so a primeira', () => {
    expect.assertions(4)
    try {
      loadApiEnv({ NODE_ENV: 'development' })
    } catch (error) {
      const msg = (error as Error).message
      expect(msg).toContain('API_URL')
      expect(msg).toContain('DATABASE_URL')
      expect(msg).toContain('REDIS_URL')
      expect(msg).toContain('JWT_SECRET')
    }
  })

  it.each([
    [{ ...base, NODE_ENV: 'producao' }, 'NODE_ENV com valor que nao existe'],
    [{ ...base, API_URL: 'nao-e-uma-url' }, 'API_URL sem protocolo'],
    [{ ...base, API_PORT: '99999' }, 'API_PORT acima de 65535'],
    [{ ...base, API_PORT: 'oitenta' }, 'API_PORT nao numerico'],
    [{ ...base, DATABASE_URL: 'mysql://localhost/db' }, 'DATABASE_URL que nao e postgres'],
    [{ ...base, DATABASE_URL: '' }, 'DATABASE_URL vazia'],
    [{ ...base, REDIS_URL: 'http://localhost:6379' }, 'REDIS_URL sem protocolo redis'],
    [{ ...base, JWT_SECRET: '' }, 'JWT_SECRET vazio'],
    [{ ...base, LOG_LEVEL: 'verbose' }, 'LOG_LEVEL fora do enum'],
  ])('recusa %o (%s)', (entrada, _motivo) => {
    expect(() => loadApiEnv(entrada)).toThrow()
  })

  it('aceita rediss:// para Redis com TLS', () => {
    expect(() => loadApiEnv({ ...base, REDIS_URL: 'rediss://user:pass@host:6380' })).not.toThrow()
  })
})

/**
 * O segredo do Better Auth — ADR-0003.
 *
 * Opcional no schema e obrigatorio em `criarIdentidade`, e so quando
 * `AUTH_PROVIDER=better-auth`. Exigi-lo aqui barraria o boot local, onde o
 * provedor e o falso e este valor nao existe.
 */
describe('BETTER_AUTH_SECRET', () => {
  const trintaEDois = 'x'.repeat(32)

  it('e opcional — o modo fake nao tem segredo nenhum', () => {
    expect(loadApiEnv(base).BETTER_AUTH_SECRET).toBeUndefined()
  })

  it('aceita 32 caracteres', () => {
    expect(loadApiEnv({ ...base, BETTER_AUTH_SECRET: trintaEDois }).BETTER_AUTH_SECRET).toBe(
      trintaEDois,
    )
  })

  /*
   * Abaixo de 32 a propria biblioteca so escreve um aviso no log, e aviso em
   * log de boot ninguem le. Aqui vira recusa de subir.
   */
  it('recusa segredo curto', () => {
    expect(() => loadApiEnv({ ...base, BETTER_AUTH_SECRET: 'curto-demais' })).toThrow(
      /pelo menos 32 caracteres/,
    )
  })

  /* Vazia e o mesmo que ausente — `opcionalNaoVazia` apara e some com ela.
     Sem isto, um `BETTER_AUTH_SECRET=` no .env viraria segredo de zero
     caracteres em vez de "nao configurado". */
  it('trata string vazia como ausente', () => {
    expect(loadApiEnv({ ...base, BETTER_AUTH_SECRET: '' }).BETTER_AUTH_SECRET).toBeUndefined()
  })
})

/**
 * Assistente — ADR-0010.
 *
 * O falso e o padrao para `pnpm dev` subir sem chave da OpenAI. `mastra`
 * exige a chave na composicao, nao neste schema: exigir aqui barraria o
 * boot local, onde o provedor e o falso.
 */
describe('agente — ADR-0010', () => {
  it('aplica o provedor falso e o modelo inicial', () => {
    const env = loadApiEnv(base)
    expect(env.AGENT_PROVIDER).toBe('fake')
    expect(env.AGENT_MODEL).toBe('openai/gpt-4o-mini')
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.AGENT_MONTHLY_BUDGET_CENTS).toBeUndefined()
    expect(env.AGENT_HARNESS).toBe(false)
  })

  it('aceita o provedor Mastra e a chave', () => {
    const env = loadApiEnv({
      ...base,
      AGENT_PROVIDER: 'mastra',
      OPENAI_API_KEY: 'sk-teste',
      AGENT_MODEL: 'openai/gpt-4o',
    })
    expect(env.AGENT_PROVIDER).toBe('mastra')
    expect(env.OPENAI_API_KEY).toBe('sk-teste')
    expect(env.AGENT_MODEL).toBe('openai/gpt-4o')
  })

  it('converte o teto mensal', () => {
    expect(
      loadApiEnv({ ...base, AGENT_MONTHLY_BUDGET_CENTS: '5000' }).AGENT_MONTHLY_BUDGET_CENTS,
    ).toBe(5000)
  })

  it('trata chave vazia como ausente', () => {
    expect(loadApiEnv({ ...base, OPENAI_API_KEY: '' }).OPENAI_API_KEY).toBeUndefined()
  })

  it('recusa provedor desconhecido', () => {
    expect(() => loadApiEnv({ ...base, AGENT_PROVIDER: 'langchain' })).toThrow()
  })

  it('trata AGENT_HARNESS ausente, vazio e 0 como desligado', () => {
    expect(loadApiEnv(base).AGENT_HARNESS).toBe(false)
    expect(loadApiEnv({ ...base, AGENT_HARNESS: '' }).AGENT_HARNESS).toBe(false)
    expect(loadApiEnv({ ...base, AGENT_HARNESS: '0' }).AGENT_HARNESS).toBe(false)
  })

  it('aceita AGENT_HARNESS=1 como ligado', () => {
    expect(loadApiEnv({ ...base, AGENT_HARNESS: '1' }).AGENT_HARNESS).toBe(true)
  })

  it('recusa AGENT_HARNESS com valor que nao e 0 ou 1', () => {
    expect(() => loadApiEnv({ ...base, AGENT_HARNESS: 'yes' })).toThrow()
  })
})

/**
 * Presets do harness Studio — NR-121.
 *
 * Path opcional: ausente ou vazio cai no default versionavel. Customizar e
 * apontar para um arquivo fora do repo (ou um gitignored local).
 */
describe('AGENT_STUDIO_PRESETS', () => {
  it('aplica o default quando ausente', () => {
    expect(loadApiEnv(base).AGENT_STUDIO_PRESETS).toBe('packages/agent/studio/presets.json')
  })

  it('trata vazio e so espaco como default', () => {
    expect(loadApiEnv({ ...base, AGENT_STUDIO_PRESETS: '' }).AGENT_STUDIO_PRESETS).toBe(
      'packages/agent/studio/presets.json',
    )
    expect(loadApiEnv({ ...base, AGENT_STUDIO_PRESETS: '   ' }).AGENT_STUDIO_PRESETS).toBe(
      'packages/agent/studio/presets.json',
    )
  })

  it('honra um caminho customizado', () => {
    expect(
      loadApiEnv({ ...base, AGENT_STUDIO_PRESETS: '/tmp/studio-presets.json' })
        .AGENT_STUDIO_PRESETS,
    ).toBe('/tmp/studio-presets.json')
  })
})

describe('e-mail por SMTP — NR-014', () => {
  /*
   * `.env.example` escreve `SMTP_PORT=` para dizer "nao configurado", e
   * `z.coerce.number()` converte string vazia em ZERO — que reprova em
   * `.positive()` e derruba a api na subida, com uma mensagem sobre um numero
   * que ninguem escreveu. Foi assim que o E2E do navegador quebrou.
   */
  it('SMTP_PORT vazia conta como ausente, e nao como zero', () => {
    expect(loadApiEnv({ ...base, SMTP_PORT: '' }).SMTP_PORT).toBeUndefined()
  })

  it('o padrao e o adapter de log, que nao envia nada', () => {
    expect(loadApiEnv(base).EMAIL_PROVIDER).toBe('log')
  })

  it('SMTP_SECURE vira booleano', () => {
    expect(loadApiEnv({ ...base, SMTP_SECURE: 'true' }).SMTP_SECURE).toBe(true)
    expect(loadApiEnv(base).SMTP_SECURE).toBe(false)
  })
})
