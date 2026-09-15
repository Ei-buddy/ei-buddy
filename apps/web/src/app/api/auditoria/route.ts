import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

/**
 * Trilha de auditoria da loja ativa — US-061.
 *
 * Os filtros seguem como vieram: quem valida e a api, pelo mesmo schema que o
 * WhatsApp usa. Validar tambem aqui criaria duas regras para o mesmo filtro.
 */
export async function GET(request: NextRequest) {
  return encaminhar(`/auditoria${request.nextUrl.search}`)
}
