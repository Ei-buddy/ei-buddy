import type { Metadata } from 'next'
import RelatoriosView from '@/components/financeiro/RelatoriosView'

export const metadata: Metadata = {
  title: 'Relatórios',
  description: 'Faturamento mês a mês e os rankings de cliente e de produto.',
}

export default function RelatoriosPage() {
  return <RelatoriosView />
}
