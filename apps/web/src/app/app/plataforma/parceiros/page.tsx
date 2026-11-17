import type { Metadata } from 'next'
import AdminParceirosView from '@/components/admin/AdminParceirosView'

export const metadata: Metadata = {
  title: 'Parceiros — Plataforma',
  description: 'Candidaturas a Parceiro, para aprovar ou recusar.',
}

export default function AdminParceirosPage() {
  return <AdminParceirosView />
}
