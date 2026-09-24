import { corpoDe, encaminhar } from '@/lib/bff'

/**
 * O historico de contatos da ficha — RF-011, NR-072.
 *
 * Aninhado sob o cliente porque contato sem cliente nao existe. Ate aqui a
 * ficha montava esta lista com dados de exemplo e o botao de lancar abria um
 * aviso dizendo que entraria "com o modulo de CRM".
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return encaminhar(`/clientes/${encodeURIComponent(id)}/contatos`)
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return encaminhar(`/clientes/${encodeURIComponent(id)}/contatos`, {
    method: 'POST',
    body: await corpoDe(request),
  })
}
