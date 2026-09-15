import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import AuditoriaView from '@/components/auditoria/AuditoriaView'

export const metadata: Metadata = {
  title: `Auditoria — ${BRAND}`,
  description: 'Quem fez o quê na loja, quando e por qual canal.',
}

export default function AuditoriaPage() {
  return <AuditoriaView />
}
