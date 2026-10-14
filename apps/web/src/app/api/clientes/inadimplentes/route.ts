import { encaminhar } from '@/lib/bff'

/** Clientes inadimplentes — RF-071. */
export async function GET() {
  return encaminhar('/clientes/inadimplentes')
}
