import type { Metadata } from 'next'
import ForgotPasswordForm from '@/components/auth/ForgotPasswordForm'

export const metadata: Metadata = {
  title: 'Recuperar senha',
}

export default function RecuperarSenhaPage() {
  return <ForgotPasswordForm />
}
