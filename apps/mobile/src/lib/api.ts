import { lerToken } from './session'

/**
 * Cliente HTTP do aplicativo — NR-070.
 *
 * Diferente do web, aqui NAO ha BFF: o app fala direto com a api e manda o
 * token no `Authorization`. A diferenca nao e descuido — no web o intermediario
 * existe para o token nunca chegar ao JavaScript da pagina, onde um XSS o
 * levaria. Num app nativo nao ha essa superficie, e o token fica no
 * armazenamento seguro do sistema (Keychain no iOS, Keystore no Android).
 */

/**
 * Base da api.
 *
 * `EXPO_PUBLIC_` porque no app tudo que roda esta no aparelho — nao existe
 * "variavel de servidor" aqui, e fingir que existe seria pior: alguem guardaria
 * um segredo achando que ele nao vaza.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3333'

type EnvelopeDeErro = {
  error?: { code?: string; message?: string }
}

export type Resposta<T> =
  | { readonly ok: true; readonly dados: T }
  | {
      readonly ok: false
      readonly status: number
      readonly code: string
      readonly message: string
      /** Corpo bruto: nem tudo num 4xx e detalhe do erro — ver o web. */
      readonly corpo: unknown
    }

/**
 * Mensagem generica quando a api nao responde.
 *
 * No celular isso e comum e nao e defeito: o balcao tem sinal ruim. A mensagem
 * fala de conexao, e nao de erro do sistema, porque a acao de quem le e
 * diferente — esperar e tentar de novo, nao chamar o suporte.
 */
const SEM_CONEXAO = 'Sem conexao com o servidor. Verifique a internet e tente de novo.'

export async function chamarApi<T>(
  caminho: string,
  opcoes: {
    method?: string
    body?: unknown
    /**
     * Chave de idempotencia — RNF-043.
     *
     * Obrigatoria em `POST /sales`. Quem chama e responsavel por REUSAR a
     * mesma chave ao tentar de novo: gerar uma nova a cada tentativa faz o
     * cabecalho existir e nao proteger nada, que e pior que nao te-lo, porque
     * parece protegido.
     */
    idempotencyKey?: string
  } = {},
): Promise<Resposta<T>> {
  const token = await lerToken()

  let resposta: Response
  try {
    resposta = await fetch(`${API_URL}${caminho}`, {
      method: opcoes.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        ...(opcoes.idempotencyKey === undefined
          ? {}
          : { 'idempotency-key': opcoes.idempotencyKey }),
      },
      ...(opcoes.body === undefined ? {} : { body: JSON.stringify(opcoes.body) }),
    })
  } catch {
    return { ok: false, status: 0, code: 'OFFLINE', message: SEM_CONEXAO, corpo: null }
  }

  if (resposta.ok) {
    /* 204 nao tem corpo: `json()` lancaria, e um cancelamento que deu certo
       apareceria na tela como falta de conexao. */
    if (resposta.status === 204) return { ok: true, dados: undefined as T }
    return { ok: true, dados: (await resposta.json()) as T }
  }

  const corpo = (await resposta.json().catch(() => null)) as EnvelopeDeErro | null

  return {
    ok: false,
    status: resposta.status,
    code: corpo?.error?.code ?? 'UNKNOWN',
    /* A mensagem da api ja vem em PT-BR e pensada para a tela (RNF-054).
       Reescrever aqui criaria duas versoes da mesma frase. */
    message: corpo?.error?.message ?? SEM_CONEXAO,
    corpo,
  }
}
