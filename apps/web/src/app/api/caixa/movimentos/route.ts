import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Caixa: movimentos — NR-157. */
export async function POST(request: NextRequest) {
  return encaminhar('/caixa/movimentos', { method: 'POST', body: await corpoDe(request) })
}
