import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import AdminChamadosView from '@/components/admin/AdminChamadosView'

export const metadata: Metadata = {
  title: `Chamados — Plataforma — ${BRAND}`,
  description: 'Os chamados de suporte de todas as lojas: responder e encerrar.',
}

export default function ChamadosPage() {
  return <AdminChamadosView />
}
