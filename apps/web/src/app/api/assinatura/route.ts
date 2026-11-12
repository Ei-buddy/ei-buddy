import { encaminhar } from '@/lib/bff'

/** A situacao da assinatura da loja ativa — NR-216, RF-117. */
export async function GET() {
  return encaminhar('/assinatura')
}
