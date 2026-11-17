import type { Metadata } from 'next'
import AdminEmailView from '@/components/admin/AdminEmailView'

export const metadata: Metadata = {
  title: 'E-mail — Plataforma',
  description: 'Envio de teste: confere se os e-mails da plataforma estão saindo.',
}

export default function AdminEmailPage() {
  return <AdminEmailView />
}
