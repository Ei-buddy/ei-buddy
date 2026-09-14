import { corpoDe, encaminhar } from '@/lib/bff'

/** Aprova uma candidatura de Parceiro — NR-115, ADR-0013. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return encaminhar(`/admin/parceiros/${encodeURIComponent(id)}/aprovar`, {
    method: 'POST',
    body: await corpoDe(request),
  })
}
