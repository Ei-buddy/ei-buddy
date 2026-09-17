import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import AdminCargosView from '@/components/admin/AdminCargosView'

export const metadata: Metadata = {
  title: `Cargos e Super Admin — Plataforma — ${BRAND}`,
  description: 'Entre em qualquer loja, ou promova alguém a Super Admin.',
}

export default function CargosPage() {
  return <AdminCargosView />
}
