import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Orcamentos — NR-159. */
export async function GET() {
  return encaminhar('/orcamentos')
}

export async function POST(request: NextRequest) {
  return encaminhar('/orcamentos', { method: 'POST', body: await corpoDe(request) })
}
