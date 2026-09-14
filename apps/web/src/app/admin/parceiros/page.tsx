import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import AdminParceirosView from '@/components/admin/AdminParceirosView'

export const metadata: Metadata = {
  title: `Parceiros — Super Admin — ${BRAND}`,
  description: 'Candidaturas de Parceiro aguardando aprovação.',
}

export default function AdminParceirosPage() {
  return <AdminParceirosView />
}
