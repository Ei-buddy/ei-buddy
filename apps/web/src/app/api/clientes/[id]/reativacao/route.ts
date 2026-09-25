import { encaminhar } from '@/lib/bff'

/**
 * Trazer o cliente de volta para a lista — RF-009.
 *
 * Segmento proprio (`/reativacao`) e nao um `PATCH` na ficha: e a mesma forma
 * que `/anonimizacao` ao lado ja usa, e a tela chama uma acao com nome em vez
 * de mandar um campo e torcer para a api entender.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return encaminhar(`/clientes/${encodeURIComponent(id)}/reativar`, { method: 'POST' })
}
