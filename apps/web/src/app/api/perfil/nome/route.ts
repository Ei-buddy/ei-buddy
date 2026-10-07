import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Meu perfil: trocar nome — NR-153. */
export async function PUT(request: NextRequest) {
  return encaminhar('/auth/nome', { method: 'PUT', body: await corpoDe(request) })
}
