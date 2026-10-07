import { encaminhar } from '@/lib/bff'

/** Os ultimos caixas — NR-157. */
export async function GET() {
  return encaminhar('/caixa/historico')
}
