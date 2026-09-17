import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

/** Painel do Super Admin: lista paginada das respostas — NR-111. */
export async function GET(request: NextRequest) {
  const { search } = request.nextUrl

  return encaminhar(`/admin/lista-vip${search}`)
}
