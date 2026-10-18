import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Caixa: abrir — NR-157. */
export async function POST(request: NextRequest) {
  return encaminhar('/caixa/abrir', { method: 'POST', body: await corpoDe(request) })
}
