import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

/** Usuarios da plataforma, para o painel do Super Admin — NR-121. */
export async function GET(request: NextRequest) {
  return encaminhar(`/admin/usuarios${request.nextUrl.search}`)
}
