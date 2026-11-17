import type { Metadata } from 'next'
import SuporteView from '@/components/suporte/SuporteView'

export const metadata: Metadata = {
  title: 'Suporte',
  description: 'Abra chamados e acompanhe as respostas do time.',
}

export default function SuportePage() {
  return <SuporteView />
}
