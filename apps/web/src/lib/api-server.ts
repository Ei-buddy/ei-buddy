import 'server-only'

/**
 * Chamada a api, do SERVIDOR do Next — NR-013.
 *
 * `server-only` no topo nao e decoracao: ele faz o build QUEBRAR se alguem
 * importar este arquivo de um componente de cliente. Sem isso, o import errado
 * mandaria a `API_URL` interna e, pior, o token da sessao para o navegador — e
 * quebrar no build e infinitamente melhor que descobrir isso em producao.
 *
 * ## Por que a api nao e chamada direto do navegador
 *
 * A api devolve o token no CORPO, sem `Set-Cookie` (decisao registrada na
 * NR-014: cookie exigiria CSRF. A hospedagem fechou em VPS (ADR-0015);
 * o token no corpo + cookie httpOnly no Next permanece. Se o navegador
 * guardasse esse token — em
 * `localStorage` ou em cookie legivel — qualquer XSS o levaria embora, e com
 * ele doze horas de sessao.
 *
 * Com o Next no meio, o token fica em cookie `httpOnly` que o JavaScript da
 * pagina nao le. O custo e real: toda chamada passa por aqui. O ganho e que
 * XSS deixa de ser roubo de sessao.
 */

/** Base da api. Variavel de servidor — NAO e `NEXT_PUBLIC_`, de proposito. */
const API_URL = process.env.API_URL ?? 'http://localhost:3333'

/** O envelope de erro que a api usa em todas as rotas. */
type EnvelopeDeErro = {
  error: { code: string; message: string; fields?: { path: string; message: string }[] }
}

export type Resposta<T> =
  | {
      readonly ok: true
      readonly dados: T
      /**
       * O codigo que a api respondeu, e nao um 200 presumido.
       *
       * Nem todo sucesso e igual: a venda responde 201 quando cria e 200
       * quando reconhece um reenvio pela chave de idempotencia (RNF-043).
       * Achatar os dois faria quem integra contar duas vendas onde houve uma.
       */
      readonly status: number
    }
  | {
      readonly ok: false
      readonly status: number
      readonly code: string
      readonly message: string
      /**
       * O corpo bruto do erro.
       *
       * Existe porque nem tudo que vem num 4xx e detalhe do erro. O 409 de
       * cliente duplicado traz `candidates` FORA do envelope — sao a
       * informacao que permite decidir, e sem isto eles se perderiam aqui, a
       * um passo da tela que precisa mostra-los.
       */
      readonly corpo: unknown
    }

/**
 * A mensagem quando a api nao responde.
 *
 * Generica de proposito: "ECONNREFUSED 127.0.0.1:3333" na tela nao ajuda o
 * lojista e conta a topologia interna para quem estiver olhando.
 */
const INDISPONIVEL = 'Nao conseguimos falar com o servidor. Tente de novo em instantes.'

/**
 * Em producao a mensagem fica generica; fora dela, diz o endereco.
 *
 * Lido uma vez, no modulo: `NODE_ENV` nao muda enquanto o processo vive.
 */
const PRODUCAO = process.env.NODE_ENV === 'production'

export async function chamarApi<T>(
  caminho: string,
  opcoes: {
    method?: string
    body?: unknown
    token?: string | undefined
    /** Cabecalhos extras da rota. Hoje so a chave de idempotencia (RNF-043). */
    headers?: Record<string, string>
  } = {},
): Promise<Resposta<T>> {
  let resposta: Response

  try {
    resposta = await fetch(`${API_URL}${caminho}`, {
      method: opcoes.method ?? 'GET',
      headers: {
        /*
         * So quando HA corpo. Um POST sem corpo mas com este cabecalho as
         * vezes faz a api recusar com 500 (`FST_ERR_CTP_EMPTY_JSON_BODY`) —
         * o parser de JSON do Fastify roda pelo cabecalho, encontra corpo
         * vazio, e lanca. `/admin/sair` foi onde isso apareceu primeiro, mas
         * o defeito era de qualquer POST sem corpo (`/auth/logout` inclusive)
         * — so nao tinha aparecido antes.
         */
        ...(opcoes.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...opcoes.headers,
        /* O token vem DEPOIS dos extras: nenhum cabecalho de rota pode
           sobrescrever a autorizacao por engano. */
        ...(opcoes.token === undefined ? {} : { authorization: `Bearer ${opcoes.token}` }),
      },
      ...(opcoes.body === undefined ? {} : { body: JSON.stringify(opcoes.body) }),
      /* Sessao nunca vem de cache. */
      cache: 'no-store',
    })
  } catch (erro) {
    /*
     * A falha de conexao era engolida por completo: o `catch` vazio devolvia
     * 503 e nao deixava rastro em lugar nenhum. Quem estava desenvolvendo via
     * "Nao conseguimos falar com o servidor" na tela, nada no terminal, e nao
     * tinha como saber que faltava subir a api — a mensagem certa para o
     * lojista e a errada para quem consegue resolver.
     *
     * O log e do SERVIDOR do Next, entao a topologia interna nao vaza para o
     * navegador. A mensagem da tela continua generica em producao.
     */
    /*
     * O primeiro argumento e um literal CONSTANTE, e o resto vai estruturado.
     *
     * A primeira versao interpolava o caminho na primeira posicao, e o CodeQL
     * reprovou: `js/tainted-format-string`. O Node trata o primeiro argumento
     * do `console.error` como FORMAT STRING — `%s`, `%d`, `%j` sao
     * substituidos. Um caminho contendo `%s` consumiria o argumento seguinte,
     * embaralhando o log; e log embaralhado por quem escolhe a entrada e
     * falsificacao de log.
     */
    console.error('[api-server] chamada a api falhou', {
      method: opcoes.method ?? 'GET',
      url: `${API_URL}${caminho}`,
      causa: erro instanceof Error ? erro.message : erro,
    })

    return {
      ok: false,
      status: 503,
      code: 'UNAVAILABLE',
      message: PRODUCAO ? INDISPONIVEL : `${INDISPONIVEL} (a api nao respondeu em ${API_URL})`,
      corpo: null,
    }
  }

  if (resposta.ok) {
    /*
     * `204 No Content` NAO tem corpo, e `json()` num corpo vazio lanca.
     *
     * Sem esta guarda, apagar uma conta do plano (RF-082) funcionava na api e
     * voltava 500 para a tela: a operacao dava certo e o lojista via erro, que
     * e o pior desencontro possivel — ele tentaria de novo e receberia "conta
     * nao encontrada".
     */
    if (resposta.status === 204) {
      return { ok: true, dados: undefined as T, status: 204 }
    }

    return { ok: true, dados: (await resposta.json()) as T, status: resposta.status }
  }

  /*
   * Erro da api: repassa codigo e mensagem, que ja vem em PT-BR e ja foram
   * pensados para a tela (RNF-054). Reescrever aqui criaria duas versoes da
   * mesma mensagem, e elas divergiriam.
   */
  const envelope = await lerEnvelopeDeErro(resposta)
  return { ok: false, status: resposta.status, ...envelope }
}

/** O mesmo envelope de erro, para quem nao precisa do corpo cru — so isto e o resto. */
async function lerEnvelopeDeErro(
  resposta: Response,
): Promise<{ code: string; message: string; corpo: unknown }> {
  try {
    const envelope = (await resposta.json()) as EnvelopeDeErro
    return {
      code: envelope.error?.code ?? 'UNKNOWN',
      message: envelope.error?.message ?? INDISPONIVEL,
      corpo: envelope,
    }
  } catch {
    /* Resposta sem corpo JSON — 502 de um proxy, por exemplo. */
    return { code: 'UNKNOWN', message: INDISPONIVEL, corpo: null }
  }
}

export type RespostaDeArquivo =
  | {
      readonly ok: true
      readonly bytes: ArrayBuffer
      readonly contentType: string
      readonly contentDisposition: string | null
    }
  | { readonly ok: false; readonly status: number; readonly message: string }

/**
 * A mesma chamada de `chamarApi`, para uma resposta que NAO e JSON —
 * exportar contas em CSV/PDF (NR-074).
 *
 * Corpo separado, e nao um `T` generico em `chamarApi`: `resposta.json()` la
 * dentro e incondicional, e chamado num CSV ele lanca antes de o handler poder
 * fazer qualquer coisa. Sucesso e erro se ATRAVESSAM aqui de proposito — este
 * caminho nunca precisou do `corpo` cru do erro (nao ha campo extra tipo
 * `candidates` para um download), so a mensagem.
 */
export async function chamarApiArquivo(
  caminho: string,
  token: string | undefined,
): Promise<RespostaDeArquivo> {
  let resposta: Response

  try {
    resposta = await fetch(`${API_URL}${caminho}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  } catch (erro) {
    console.error('[api-server] chamada a api falhou', {
      method: 'GET',
      url: `${API_URL}${caminho}`,
      causa: erro instanceof Error ? erro.message : erro,
    })
    return {
      ok: false,
      status: 503,
      message: PRODUCAO ? INDISPONIVEL : `${INDISPONIVEL} (a api nao respondeu em ${API_URL})`,
    }
  }

  if (!resposta.ok) {
    const { message } = await lerEnvelopeDeErro(resposta)
    return { ok: false, status: resposta.status, message }
  }

  return {
    ok: true,
    bytes: await resposta.arrayBuffer(),
    contentType: resposta.headers.get('content-type') ?? 'application/octet-stream',
    contentDisposition: resposta.headers.get('content-disposition'),
  }
}
