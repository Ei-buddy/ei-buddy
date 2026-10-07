import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Caixa: fechar — NR-157. */
export async function POST(request: NextRequest) {
  return encaminhar('/caixa/fechar', { method: 'POST', body: await corpoDe(request) })
}
