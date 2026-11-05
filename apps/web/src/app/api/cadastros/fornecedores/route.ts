import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Cadastro de fornecedor — NR-191. Repassa a busca (`?q=`) como veio. */
export async function GET(request: NextRequest) {
  return encaminhar(`/cadastros/fornecedores${request.nextUrl.search}`)
}

export async function POST(request: NextRequest) {
  return encaminhar('/cadastros/fornecedores', { method: 'POST', body: await corpoDe(request) })
}
