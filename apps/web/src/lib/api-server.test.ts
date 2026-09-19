import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Chamada a api do servidor do Next — NR-013.
 *
 * O que se prova aqui e uma propriedade so, e ela e de seguranca: o endereco
 * interno da api aparece na mensagem FORA de producao e nao aparece dentro.
 *
 * O modulo le `NODE_ENV` uma vez, no topo, entao cada teste precisa importar
 * de novo com o ambiente ja trocado — daqui vem o `resetModules`.
 */

const original = process.env.NODE_ENV
const API = 'http://api-interna.local:3333'

async function comAmbiente(nodeEnv: string) {
  vi.resetModules()
  vi.stubEnv('NODE_ENV', nodeEnv)
  vi.stubEnv('API_URL', API)
  return import('./api-server.js')
}

beforeEach(() => {
  /* A api inalcancavel e o caso todo: `fetch` que rejeita. */
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('fetch failed'))),
  )
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.stubEnv('NODE_ENV', original ?? 'test')
})

describe('api inalcancavel', () => {
  it('responde 503 com codigo UNAVAILABLE', async () => {
    const { chamarApi } = await comAmbiente('development')

    const r = await chamarApi('/auth/login', { method: 'POST' })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect([r.status, r.code]).toEqual([503, 'UNAVAILABLE'])
  })

  /*
   * O sintoma que motivou isto: o lojista via "nao conseguimos falar com o
   * servidor", o terminal nao mostrava nada, e quem estava desenvolvendo nao
   * tinha como saber que faltava subir a api. A mensagem certa para um deles e
   * a errada para o outro.
   */
  it('fora de producao diz o endereco que nao respondeu', async () => {
    const { chamarApi } = await comAmbiente('development')

    const r = await chamarApi('/auth/login', { method: 'POST' })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toContain(API)
  })

  /*
   * Em producao, NAO. "ECONNREFUSED api-interna.local:3333" na tela nao ajuda
   * o lojista e conta a topologia interna para quem estiver olhando.
   */
  it('em producao NAO revela o endereco', async () => {
    const { chamarApi } = await comAmbiente('production')

    const r = await chamarApi('/auth/login', { method: 'POST' })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).not.toContain(API)
    expect(r.message).not.toContain('3333')
  })

  /* O log e do servidor, entao ele pode ser especifico nos dois ambientes —
     e sem ele a falha nao deixa rastro em lugar nenhum. */
  it('registra a falha no log do servidor', async () => {
    const { chamarApi } = await comAmbiente('production')

    await chamarApi('/auth/login', { method: 'POST' })

    expect(console.error).toHaveBeenCalledWith('[api-server] chamada a api falhou', {
      method: 'POST',
      url: `${API}/auth/login`,
      motivo: 'sem conexao',
      esperaMs: 10_000,
      causa: 'fetch failed',
    })
  })

  /*
   * O primeiro argumento do `console.error` e format string no Node: `%s`,
   * `%d` e `%j` sao substituidos. Com o caminho interpolado ali — como estava
   * na primeira versao — um caminho contendo `%s` consumiria o argumento
   * seguinte e embaralharia o log. CodeQL reprovou isso como
   * `js/tainted-format-string`, severidade alta.
   *
   * O teste afirma a forma que impede o problema: literal constante na
   * primeira posicao, dados na segunda.
   */
  it('nao deixa o caminho virar format string do log', async () => {
    const { chamarApi } = await comAmbiente('production')

    await chamarApi('/auth/%s%s%s', { method: 'GET' })

    const [formato, dados] = vi.mocked(console.error).mock.calls[0]!
    expect(formato).toBe('[api-server] chamada a api falhou')
    expect(dados).toMatchObject({ url: `${API}/auth/%s%s%s` })
  })
})

/**
 * A api que nao responde — NR-132.
 *
 * Nao e a api FORA DO AR, que ja tinha teste acima: e a api que aceita a
 * conexao e nunca devolve. Sem teto de espera, `fetch` no Node espera para
 * sempre — e numa PAGINA isso trava a navegacao inteira, porque o componente
 * de servidor so responde quando a leitura volta.
 *
 * Foi esse o caminho da tela de login presa no desfoque: `/app` e
 * `force-dynamic`, `carregarPainel` ficou pendurado, o `router.push` nunca
 * completou e o lojista ficou olhando uma tela borrada sem nada para clicar.
 */
describe('api que nao responde', () => {
  it('desiste no teto de espera e devolve o mesmo 503 de api fora do ar', async () => {
    /* Aceita a conexao e nunca resolve — so o `signal` interrompe. */
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'TimeoutError'))
            })
          }),
      ),
    )

    const { chamarApi } = await comAmbiente('development')

    /* 20ms para o teste nao esperar os dez segundos de verdade. */
    const r = await chamarApi('/auth/login', { method: 'POST', timeoutMs: 20 })

    expect(r.ok).toBe(false)
    if (r.ok) return
    /* O mesmo 503 de sempre: a tela ja sabe mostrar "nao carregou" nele. */
    expect([r.status, r.code]).toEqual([503, 'UNAVAILABLE'])
  })

  it('manda um signal em toda chamada, mesmo sem teto proprio', async () => {
    const espiao = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.reject(new Error('fetch failed')),
    )
    vi.stubGlobal('fetch', espiao)

    const { chamarApi } = await comAmbiente('development')
    await chamarApi('/auth/login', { method: 'POST' })

    /* Sem isto a protecao valeria so para quem lembrasse de pedir. */
    expect(espiao.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('o log distingue tempo esgotado de sem conexao', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'TimeoutError'))
            })
          }),
      ),
    )

    const { chamarApi } = await comAmbiente('development')
    await chamarApi('/auth/login', { method: 'POST', timeoutMs: 20 })

    /* "Fora do ar" se resolve subindo o processo; "lenta demais", olhando a
       consulta. Na tela as duas sao a mesma frase; no log, nao. */
    const [, dados] = vi.mocked(console.error).mock.calls[0]!
    expect(dados).toMatchObject({ motivo: 'tempo esgotado' })
  })
})
