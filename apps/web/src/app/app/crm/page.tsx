import type { Metadata } from 'next'
import CrmQuadro from '@/components/crm/CrmQuadro'

export const metadata: Metadata = {
  title: 'CRM',
  description: 'Pendências e contatos em quadro, lançados pelo app e pelo WhatsApp.',
}

export default function CrmPage() {
  return <CrmQuadro />
}
