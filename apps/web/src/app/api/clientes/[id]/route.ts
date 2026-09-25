import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { chamarApi } from '@/lib/api-server'
import { corpoDe, encaminhar } from '@/lib/bff'
import { SESSION_COOKIE } from '@/lib/session'

/**
 * A ficha de um cliente — RF-011.
 *
 * Rota separada de `/api/clientes` porque o Next casa segmento estatico antes
 * de dinamico: `/api/clientes/importacao` continua sendo a importacao, e nao um
 * cliente de id "importacao".
 *
 * Repassa o STATUS da api sem traduzir. O 404 dela cobre tanto "nao existe"
 * quanto "e de outra loja", de proposito — um 403 confirmaria que aquele id
 * existe em algum lugar.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value

  if (token === undefined) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Entre na sua conta para continuar.' } },
      { status: 401 },
    )
  }

  const { id } = await params
  const r = await chamarApi(`/clientes/${encodeURIComponent(id)}`, { token })

  return r.ok
    ? NextResponse.json(r.dados)
    : NextResponse.json(r.corpo ?? { error: { code: r.code, message: r.message } }, {
        status: r.status,
      })
}

/**
 * Excluir o cliente da lista — RF-009.
 *
 * `encaminhar` e nao `chamarApi` a mao como o GET acima: o GET veio antes do
 * helper e nao foi reescrito. Este ja nasce com ele, que trata o 204 sem corpo
 * — `NextResponse.json` recusa esse status.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return encaminhar(`/clientes/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * Editar o cadastro — RF-009.
 *
 * `PATCH` e nao `PUT`: a tela manda o que mudou, e o que nao veio fica como
 * esta. `PUT` prometeria substituir a ficha inteira.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return encaminhar(`/clientes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: await corpoDe(request),
  })
}
