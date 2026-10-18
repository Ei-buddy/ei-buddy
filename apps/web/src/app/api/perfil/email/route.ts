import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Meu perfil: trocar email — NR-153. */
export async function PUT(request: NextRequest) {
  return encaminhar('/auth/email', { method: 'PUT', body: await corpoDe(request) })
}
