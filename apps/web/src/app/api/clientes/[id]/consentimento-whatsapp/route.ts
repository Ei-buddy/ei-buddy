import { corpoDe, encaminhar } from '@/lib/bff'

/** Consentimento de WhatsApp do cliente — RF-016. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return encaminhar(`/clientes/${encodeURIComponent(id)}/consentimento-whatsapp`)
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return encaminhar(`/clientes/${encodeURIComponent(id)}/consentimento-whatsapp`, {
    method: 'PUT',
    body: await corpoDe(request),
  })
}
