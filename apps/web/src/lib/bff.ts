import 'server-only'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { chamarApi, chamarApiArquivo } from './api-server'
import { SESSION_COOKIE } from './session'

/**
 * O encaminhamento do BFF, num lugar so — NR-013, NR-076.
 *
 * Todo handler daqui faz a mesma coisa: pega o token do cookie `httpOnly`,
 * chama a api e traduz a resposta. Escrito a mao em cada arquivo, o pedaco que
 * some primeiro e o `if (token === undefined)` — e um handler sem ele nao falha
 * em desenvolvimento (a api recusa e a tela mostra erro), so deixa de proteger.
 *
 * `import 'server-only'`: se este modulo entrar num componente de cliente por
 * engano, o build quebra em vez de mandar o cookie para o navegador.
 */

/** Status que a especificacao proibe de ter corpo. */
const SEM_CORPO = new Set([204, 205, 304])

const semSessao = () =>
  NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'Entre na sua conta para continuar.' } },
    { status: 401 },
  )

export type OpcoesDeEncaminhamento = {
  readonly method?: string
  readonly body?: unknown
  /**
   * Forca o codigo do sucesso.
   *
   * Raro: por padrao o status da API e REPASSADO, porque ele carrega
   * informacao — 201 criou, 200 era reenvio. Use so quando a rota do BFF tiver
   * um contrato proprio, e sabendo que achata a distincao.
   */
  readonly okStatus?: number
  /** Cabecalhos extras. Ver `chamarApi`. */
  readonly headers?: Record<string, string>
}

export async function encaminhar(
  caminho: string,
  opcoes: OpcoesDeEncaminhamento = {},
): Promise<NextResponse> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (token === undefined) return semSessao()

  const r = await chamarApi(caminho, {
    method: opcoes.method,
    body: opcoes.body,
    token,
    headers: opcoes.headers,
  })

  const status = opcoes.okStatus ?? r.status

  /*
   * 204 nao pode ter corpo — e `NextResponse.json` SEMPRE escreve um.
   *
   * O resultado era um 500 no BFF para uma api que respondeu certo:
   * "Invalid response status code 204", estourando dentro do helper. O
   * comentario abaixo mostra que o 204 ja tinha sido pensado, mas so pelo lado
   * do CORPO; o status continuava passando direto para `json()`, que o recusa.
   *
   * Vale para toda a familia sem corpo (204, 205, 304), e nao so para o 204
   * que apareceu primeiro.
   */
  if (r.ok && SEM_CORPO.has(status)) return new NextResponse(null, { status })

  return r.ok
    ? /* `dados` vem indefinido quando a api responde 204 (apagar conta do
         plano, por exemplo). `NextResponse.json(undefined)` escreve o texto
         "undefined" no corpo, que estoura no parse do navegador — entao vira
         um objeto de verdade. */
      NextResponse.json(r.dados ?? { ok: true }, { status })
    : /*
       * O corpo CRU da api quando ele existe, e nao so codigo e mensagem.
       *
       * E o que faz a recusa de arquivo chegar na tela com a linha do problema
       * (`fields`), em vez de virar "arquivo invalido" — a mesma razao pela
       * qual a tela de clientes recebe os candidatos a duplicata.
       */
      NextResponse.json(r.corpo ?? { error: { code: r.code, message: r.message } }, {
        status: r.status,
      })
}

/** O corpo JSON do pedido, ou vazio — corpo malformado nao derruba o handler. */
export async function corpoDe(request: Request): Promise<Record<string, unknown>> {
  return (await request.json().catch(() => ({}))) as Record<string, unknown>
}

/**
 * Encaminhamento para uma resposta que NAO e JSON — exportar em CSV/PDF.
 *
 * `encaminhar` sempre le `resposta.json()`; um CSV quebraria ali antes de
 * chegar ao navegador. Erro ainda vira um envelope JSON (o handler de erro do
 * fetch da tela sabe ler isso), so o SUCESSO que muda de forma.
 */
export async function encaminharArquivo(caminho: string): Promise<NextResponse> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (token === undefined) return semSessao()

  const r = await chamarApiArquivo(caminho, token)

  if (!r.ok) {
    return NextResponse.json(
      { error: { code: 'EXPORT_FAILED', message: r.message } },
      { status: r.status },
    )
  }

  return new NextResponse(r.bytes, {
    status: 200,
    headers: {
      'content-type': r.contentType,
      ...(r.contentDisposition === null ? {} : { 'content-disposition': r.contentDisposition }),
    },
  })
}
