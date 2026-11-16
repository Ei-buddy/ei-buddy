import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Taxas de recebimento da loja — DEC-027 (NR-224). */
export async function GET() {
  return encaminhar('/taxas-de-recebimento')
}

export async function PUT(request: NextRequest) {
  return encaminhar('/taxas-de-recebimento', { method: 'PUT', body: await corpoDe(request) })
}
