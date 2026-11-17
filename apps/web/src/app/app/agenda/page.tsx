import type { Metadata } from 'next'
import AgendaView from '@/components/agenda/AgendaView'

export const metadata: Metadata = {
  title: 'Agenda',
  description: 'Compromissos, entregas e vencimentos, com lembrete antes da hora.',
}

export default function AgendaPage() {
  return <AgendaView />
}
