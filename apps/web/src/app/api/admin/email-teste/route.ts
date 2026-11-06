import type { NextRequest } from 'next/server'
import { corpoDe, encaminhar } from '@/lib/bff'

/** Envio de teste de e-mail do Super Admin — achado do QA. */
export async function POST(request: NextRequest) {
  return encaminhar('/admin/email-teste', { method: 'POST', body: await corpoDe(request) })
}
