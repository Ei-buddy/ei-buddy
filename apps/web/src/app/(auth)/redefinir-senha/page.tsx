import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import ResetPasswordForm from '@/components/auth/ResetPasswordForm'

export const metadata: Metadata = {
  title: `Criar nova senha — ${BRAND}`,
  /* O token esta na URL: a pagina nao entra em indice nenhum. */
  robots: { index: false, follow: false },
}

export default async function RedefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const { token } = await searchParams
  return <ResetPasswordForm token={typeof token === 'string' ? token : ''} />
}
