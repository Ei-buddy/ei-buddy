import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** O celular de quem esta logado, e a troca — RF-132. */
export async function GET() {
  return encaminhar('/auth/telefone')
}

export async function PUT(request: NextRequest) {
  return encaminhar('/auth/telefone', { method: 'PUT', body: await corpoDe(request) })
}
