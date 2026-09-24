import { corpoDe, encaminhar } from '@/lib/bff'

/**
 * Contas a receber — NR-081, RF-064, RF-066.
 *
 * A rota da api existe desde a NR-074 e o web nao a chamava: a tela de contas a
 * receber era alimentada por dado de exemplo ao lado da tela de contas a pagar,
 * que ja era real. Duas telas irmas, uma verdadeira e outra nao, sem nada
 * dizendo qual era qual.
 */
export async function GET(request: Request) {
  /* `?cliente=` so viaja quando veio: a ficha do cliente pede as pendencias dele. */
  const cliente = new URL(request.url).searchParams.get('cliente')
  return encaminhar(
    cliente ? `/contas-a-receber?cliente=${encodeURIComponent(cliente)}` : '/contas-a-receber',
  )
}

/** Lancar recebivel avulso, que nao vem de venda — RF-065. */
export async function POST(request: Request) {
  return encaminhar('/contas-a-receber', {
    method: 'POST',
    body: await corpoDe(request),
  })
}
