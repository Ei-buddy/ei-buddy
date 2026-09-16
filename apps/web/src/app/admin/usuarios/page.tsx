import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import AdminUsuariosView from '@/components/admin/AdminUsuariosView'

export const metadata: Metadata = {
  title: `Usuários — Super Admin — ${BRAND}`,
  description: 'Contas da plataforma, com as lojas de cada uma e o acesso de Super Admin.',
}

export default function AdminUsuariosPage() {
  return <AdminUsuariosView />
}
