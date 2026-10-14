import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Entrada de mercadoria — NR-158. */
export async function GET() {
  return encaminhar('/compras')
}

export async function POST(request: NextRequest) {
  return encaminhar('/compras', { method: 'POST', body: await corpoDe(request) })
}
