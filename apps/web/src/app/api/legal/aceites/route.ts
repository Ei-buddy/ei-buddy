import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Registra o aceite das versoes vigentes — RF-03. */
export async function POST(request: NextRequest) {
  return encaminhar('/legal/aceites', { method: 'POST', body: await corpoDe(request) })
}
