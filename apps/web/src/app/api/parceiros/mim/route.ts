import { encaminhar } from '@/lib/bff'

/** Status da propria candidatura de Parceiro — NR-115, self-service. */
export async function GET() {
  return encaminhar('/parceiros/mim')
}
