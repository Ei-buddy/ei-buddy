import type { Metadata } from 'next'
import AdminListaVipView from '@/components/admin/AdminListaVipView'

export const metadata: Metadata = {
  title: 'Lista de espera — Plataforma',
  description: 'Respostas do Grupo VIP de Pré-Lançamento, agregadas e individuais.',
}

export default function AdminListaVipPage() {
  return <AdminListaVipView />
}
