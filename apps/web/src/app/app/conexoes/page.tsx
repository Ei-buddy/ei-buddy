import type { Metadata } from 'next'
import ConexoesView from '@/components/conexoes/ConexoesView'

export const metadata: Metadata = {
  title: 'Minhas conexões',
  description: 'Pedidos de conexão recebidos, enviados, e quem já está conectado com você.',
}

export default function ConexoesPage() {
  return <ConexoesView />
}
