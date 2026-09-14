import { corpoDe, encaminhar } from '@/lib/bff'

/** Reenvia candidatura de Parceiro recusada — NR-115, self-service. */
export async function POST(request: Request) {
  return encaminhar('/parceiros/reenviar', { method: 'POST', body: await corpoDe(request) })
}
