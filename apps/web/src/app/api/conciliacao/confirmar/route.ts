import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Confirma os pares e da baixa na ordem do extrato — DEC-026. */
export async function POST(request: NextRequest) {
  return encaminhar('/conciliacao/confirmar', { method: 'POST', body: await corpoDe(request) })
}
