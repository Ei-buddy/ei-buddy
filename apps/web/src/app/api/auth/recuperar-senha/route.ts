import { NextResponse } from 'next/server'
import { chamarApi } from '@/lib/api-server'
import { corpoDe } from '@/lib/bff'

/**
 * Pedir o link de redefinir senha — NR-014.
 *
 * NAO usa `encaminhar`: rota publica, e `encaminhar` exige o cookie de
 * sessao — mesmo padrao de `app/api/auth/signup/route.ts`.
 */
export async function POST(request: Request) {
  const r = await chamarApi('/auth/recuperar-senha', {
    method: 'POST',
    body: await corpoDe(request),
  })

  if (r.ok) return new NextResponse(null, { status: r.status })
  return NextResponse.json(r.corpo ?? { error: { code: r.code, message: r.message } }, {
    status: r.status,
  })
}
