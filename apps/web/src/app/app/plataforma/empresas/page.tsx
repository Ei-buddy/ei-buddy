import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import AdminView from '@/components/admin/AdminView'

export const metadata: Metadata = {
  title: `Empresas — Plataforma — ${BRAND}`,
  description: 'Toda loja cadastrada na plataforma, e a entrada auditada em cada uma.',
}

export default function AdminPage() {
  return <AdminView />
}
