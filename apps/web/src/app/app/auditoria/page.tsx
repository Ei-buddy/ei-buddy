import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import AuditoriaPessoas from '@/components/auditoria/AuditoriaPessoas'

export const metadata: Metadata = {
  title: `Auditoria — ${BRAND}`,
  description: 'Escolha uma pessoa para ver o que ela fez na loja.',
}

export default function AuditoriaPage() {
  return <AuditoriaPessoas />
}
