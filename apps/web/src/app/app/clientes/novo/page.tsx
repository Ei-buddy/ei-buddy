import type { Metadata } from 'next'
import ClienteForm from '@/components/clientes/ClienteForm'

export const metadata: Metadata = {
  title: 'Novo cliente',
}

export default function NovoClientePage() {
  return <ClienteForm />
}
