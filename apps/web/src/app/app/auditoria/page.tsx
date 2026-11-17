import type { Metadata } from 'next'
import AuditoriaPessoas from '@/components/auditoria/AuditoriaPessoas'

export const metadata: Metadata = {
  title: 'Auditoria',
  description: 'Escolha uma pessoa para ver o que ela fez na loja.',
}

export default function AuditoriaPage() {
  return <AuditoriaPessoas />
}
