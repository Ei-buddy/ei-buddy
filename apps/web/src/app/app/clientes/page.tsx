import type { Metadata } from 'next'
import ClientesLista from '@/components/clientes/ClientesLista'

export const metadata: Metadata = {
  title: 'Clientes',
  description: 'Base de clientes, pendências e histórico de compras.',
}

export default function ClientesPage() {
  return <ClientesLista />
}
