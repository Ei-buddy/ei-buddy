import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Contas bancarias da loja — RF-073. */
export async function GET() {
  return encaminhar('/contas-bancarias')
}

export async function POST(request: NextRequest) {
  return encaminhar('/contas-bancarias', { method: 'POST', body: await corpoDe(request) })
}
