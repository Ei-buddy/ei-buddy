import { encaminhar } from '@/lib/bff'

/** O caixa aberto agora, com o resumo — NR-157. */
export async function GET() {
  return encaminhar('/caixa')
}
