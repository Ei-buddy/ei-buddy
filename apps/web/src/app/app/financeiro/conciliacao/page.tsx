import type { Metadata } from 'next'
import ConciliacaoView from '@/components/financeiro/ConciliacaoView'

export const metadata: Metadata = {
  title: 'Conciliação bancária',
  description: 'Confira o extrato do banco contra os lançamentos.',
}

export default function ConciliacaoPage() {
  return <ConciliacaoView />
}
