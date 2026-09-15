import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A logica dos tres desfechos de `checkIsolation`.
 *
 * Vale um teste porque e facil de inverter, e inverter tem consequencia
 * assimetrica: tratar `bypassed` como `unknown` faz a api subir servindo dados
 * de todas as lojas — que foi o estado real de um ambiente ate a CI notar.
 * Tratar `unknown` como `bypassed` so causa indisponibilidade.
 */

const db = vi.hoisted(() => ({
  assertRlsEnforced: vi.fn(),
  getClient: vi.fn(() => ({}) as never),
  checkConnection: vi.fn(),
  closeConnection: vi.fn(),
}))

vi.mock('@na-regua/db', () => db)

vi.mock('ioredis', () => ({
  Redis: class {
    status = 'ready'
    async connect(): Promise<void> {}
    async ping(): Promise<string> {
      return 'PONG'
    }
    async quit(): Promise<void> {}
  },
}))

/** O minimo que `loadApiEnv` exige, senao o modulo nem carrega. */
const AMBIENTE = {
  NODE_ENV: 'test',
  API_URL: 'http://localhost:3333',
  DATABASE_URL: 'postgresql://app:app@localhost:5432/naregua',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'apenas-para-teste',
}

/*
 * Teto generoso, e a razao nao e lentidao de teste.
 *
 * `carregar()` faz `vi.resetModules()` e reimporta `composition.js` a cada
 * caso — e o grafo dele so cresce: `core`, `db`, `banking`, `env`, `ioredis`.
 * O PRIMEIRO caso paga a transpilacao inteira e ja passou dos 5s do padrao
 * aqui, com folga cada vez menor. Um teto maior e a resposta certa: o que se
 * mede neste arquivo e a LOGICA dos tres desfechos, nunca o tempo de carga.
 */
vi.setConfig({ testTimeout: 60_000 })

async function carregar() {
  vi.resetModules()
  for (const [chave, valor] of Object.entries(AMBIENTE)) vi.stubEnv(chave, valor)
  return import('./composition.js')
}

describe('checkIsolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('devolve enforced quando o papel nao escapa da politica', async () => {
    db.assertRlsEnforced.mockResolvedValue({
      role: 'naregua_app',
      isSuperuser: false,
      bypassesRls: false,
      enforced: true,
    })
    const { checkIsolation } = await carregar()

    expect(await checkIsolation()).toEqual({ status: 'enforced', role: 'naregua_app' })
  })

  it('devolve bypassed quando o papel ignora a politica', async () => {
    /* A mensagem e a do `assertRlsEnforced` de verdade: e por ela que os dois
       casos de falha se distinguem. */
    db.assertRlsEnforced.mockRejectedValue(
      new Error(
        'A conexao da aplicacao usa o papel "naregua", que e superusuario — e por isso ' +
          'IGNORA as politicas de RLS. O isolamento entre empresas nao estaria em vigor.',
      ),
    )
    const { checkIsolation } = await carregar()

    const r = await checkIsolation()
    /* Este e o desfecho que derruba o processo. Confundi-lo com `unknown`
       faria a api subir servindo dados de todas as lojas. */
    expect(r.status).toBe('bypassed')
  })

  it('devolve unknown quando o banco esta fora do ar', async () => {
    db.assertRlsEnforced.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'))
    const { checkIsolation } = await carregar()

    const r = await checkIsolation()
    /*
     * Indisponibilidade nao e falha de seguranca. Recusar subir aqui deixaria
     * nem o `/health/live` de pe, e o `/health` ja responde 503.
     */
    expect(r.status).toBe('unknown')
    if (r.status !== 'unknown') return
    expect(r.reason).toContain('ECONNREFUSED')
  })

  it('nao confunde erro de banco com configuracao errada', async () => {
    db.assertRlsEnforced.mockRejectedValue(new Error('timeout expired'))
    const { checkIsolation } = await carregar()

    expect((await checkIsolation()).status).not.toBe('bypassed')
  })
})

/**
 * A guarda que impede subir em producao com a autenticacao de desenvolvimento
 * — ADR-0002.
 *
 * Vale um teste pelo mesmo motivo de `checkIsolation`: e facil de inverter, e a
 * consequencia e assimetrica. Deixar passar publica um sistema em que
 * `AUTH_PROVIDER=fake` aceita qualquer credencial. Barrar de menos so causa
 * indisponibilidade em ambiente mal configurado, que e o que se quer.
 */
describe('assertAuthUsavelEmProducao — ADR-0002', () => {
  async function comAmbiente(over: Record<string, string>) {
    vi.resetModules()
    for (const [chave, valor] of Object.entries({ ...AMBIENTE, ...over })) {
      vi.stubEnv(chave, valor)
    }
    return import('./composition.js')
  }

  it('recusa producao com o provedor falso', async () => {
    const { assertAuthUsavelEmProducao } = await comAmbiente({
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'fake',
    })

    expect(() => assertAuthUsavelEmProducao()).toThrow(/nao pode rodar em producao/)
  })

  /* A mensagem precisa dizer O QUE fazer, senao quem for acordado as 3h so
     sabe que algo esta errado. */
  it('a recusa diz o que configurar', async () => {
    const { assertAuthUsavelEmProducao } = await comAmbiente({
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'fake',
    })

    expect(() => assertAuthUsavelEmProducao()).toThrow(/Defina um provedor real/)
  })

  it('aceita producao com provedor de verdade', async () => {
    const { assertAuthUsavelEmProducao } = await comAmbiente({
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'better-auth',
    })

    expect(() => assertAuthUsavelEmProducao()).not.toThrow()
  })

  /* Desenvolvimento e teste continuam com o falso — e o modo previsto pela
     ADR-0002 enquanto a DEC-009 nao escolhe entre provedor gerenciado e
     biblioteca auto-hospedada. */
  it.each(['development', 'test'])('aceita %s com o provedor falso', async (NODE_ENV) => {
    const { assertAuthUsavelEmProducao } = await comAmbiente({ NODE_ENV, AUTH_PROVIDER: 'fake' })

    expect(() => assertAuthUsavelEmProducao()).not.toThrow()
  })
})

/**
 * O assistente desliga a rota, nao a api — ADR-0010.
 *
 * Servir `AGENT_PROVIDER=fake` em producao publicaria um reconhecedor de tres
 * frases no lugar do modelo, entao ele continua barrado. O que mudou e o
 * DESFECHO: antes a api recusava subir, e uma chave de IA ausente derrubava
 * venda, financeiro e estoque junto. O teste que mais importa aqui e o ultimo:
 * nenhum destes casos pode voltar a ser excecao.
 */
describe('motivoDoAgenteIndisponivel — ADR-0010', () => {
  async function comAmbiente(over: Record<string, string>) {
    vi.resetModules()
    for (const [chave, valor] of Object.entries({ ...AMBIENTE, ...over })) {
      vi.stubEnv(chave, valor)
    }
    return import('./composition.js')
  }

  it('recusa servir o provedor falso em producao', async () => {
    const { motivoDoAgenteIndisponivel } = await comAmbiente({
      NODE_ENV: 'production',
      AGENT_PROVIDER: 'fake',
    })

    expect(motivoDoAgenteIndisponivel()).toMatch(/nao serve em producao/)
  })

  it('o motivo diz o que configurar', async () => {
    const { motivoDoAgenteIndisponivel } = await comAmbiente({
      NODE_ENV: 'production',
      AGENT_PROVIDER: 'fake',
    })

    expect(motivoDoAgenteIndisponivel()).toMatch(/AGENT_PROVIDER=mastra/)
  })

  it('Mastra sem chave tambem nao serve — em vez de estourar na construcao', async () => {
    const { motivoDoAgenteIndisponivel } = await comAmbiente({
      NODE_ENV: 'production',
      AGENT_PROVIDER: 'mastra',
      OPENAI_API_KEY: '',
    })

    expect(motivoDoAgenteIndisponivel()).toMatch(/exige OPENAI_API_KEY/)
  })

  it('aceita producao com Mastra e chave', async () => {
    const { motivoDoAgenteIndisponivel } = await comAmbiente({
      NODE_ENV: 'production',
      AGENT_PROVIDER: 'mastra',
      OPENAI_API_KEY: 'sk-de-teste',
    })

    expect(motivoDoAgenteIndisponivel()).toBeUndefined()
  })

  it.each(['development', 'test'])('aceita %s com o provedor falso', async (NODE_ENV) => {
    const { motivoDoAgenteIndisponivel } = await comAmbiente({ NODE_ENV, AGENT_PROVIDER: 'fake' })

    expect(motivoDoAgenteIndisponivel()).toBeUndefined()
  })

  /*
   * A regressao que este arquivo existe para impedir a partir de agora.
   *
   * Producao sem chave nenhuma foi exatamente o estado que deixou a api em
   * laco de reinicio com o front no ar: assistente ausente parando gravacao de
   * venda. Nao ha configuracao de IA que justifique derrubar o processo.
   */
  it.each([
    ['fake', ''],
    ['mastra', ''],
  ])('%s sem chave devolve motivo, e nunca lanca', async (AGENT_PROVIDER, OPENAI_API_KEY) => {
    const { motivoDoAgenteIndisponivel } = await comAmbiente({
      NODE_ENV: 'production',
      AGENT_PROVIDER,
      OPENAI_API_KEY,
    })

    expect(() => motivoDoAgenteIndisponivel()).not.toThrow()
    expect(motivoDoAgenteIndisponivel()).toBeTypeOf('string')
  })
})
