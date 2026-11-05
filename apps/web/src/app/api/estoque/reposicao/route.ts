import { encaminhar } from '@/lib/bff'

/** O que repor, pela media de venda dos ultimos seis meses — achado do QA. */
export async function GET() {
  return encaminhar('/estoque/reposicao')
}
