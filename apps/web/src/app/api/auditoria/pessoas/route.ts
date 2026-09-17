import { encaminhar } from '@/lib/bff'

/** Quem agiu na loja ativa — US-061. */
export async function GET() {
  return encaminhar('/auditoria/pessoas')
}
