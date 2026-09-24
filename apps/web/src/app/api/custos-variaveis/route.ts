import { corpoDe, encaminhar } from '@/lib/bff'

/** Custos variaveis — percentual sobre o preco de venda. */
export async function GET() {
  return encaminhar('/custos-variaveis')
}

export async function POST(request: Request) {
  return encaminhar('/custos-variaveis', {
    method: 'POST',
    body: await corpoDe(request),
  })
}
