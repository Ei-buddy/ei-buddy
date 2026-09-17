import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import AdminListaVipView from '@/components/admin/AdminListaVipView'

export const metadata: Metadata = {
  title: `Lista de espera — Plataforma — ${BRAND}`,
  description: 'Respostas do Grupo VIP de Pré-Lançamento, agregadas e individuais.',
}

export default function AdminListaVipPage() {
  return <AdminListaVipView />
}
