import type { Metadata } from 'next'
import LoginForm from '@/components/auth/LoginForm'

export const metadata: Metadata = {
  title: 'Entrar',
  description: 'Acesse o painel do seu negócio.',
}

export default function EntrarPage() {
  return <LoginForm />
}
