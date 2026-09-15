import { encaminhar } from '@/lib/bff'

/** O que esta pessoa ainda precisa aceitar — RF-03. */
export async function GET() {
  return encaminhar('/legal/pendencias')
}
