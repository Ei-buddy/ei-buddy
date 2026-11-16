import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import AdminAssinaturasView from '@/components/admin/AdminAssinaturasView'

export const metadata: Metadata = {
  title: `Assinaturas — Plataforma — ${BRAND}`,
  description: 'Quem está em teste, em dia, atrasado ou restrito.',
}

export default function AssinaturasPage() {
  return <AdminAssinaturasView />
}
