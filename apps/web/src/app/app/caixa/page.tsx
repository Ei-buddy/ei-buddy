import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import CaixaView from '@/components/caixa/CaixaView'

export const metadata: Metadata = {
  title: `Caixa — ${BRAND}`,
  description: 'Abertura, sangria, suprimento e fechamento do caixa.',
}

export default function CaixaPage() {
  return <CaixaView />
}
