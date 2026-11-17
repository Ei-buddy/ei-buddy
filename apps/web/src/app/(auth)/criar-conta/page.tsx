import type { Metadata } from 'next'
import SignupFlow from '@/components/auth/SignupFlow'

export const metadata: Metadata = {
  title: 'Criar conta',
  description: 'Crie sua conta e comece a usar o sistema.',
}

export default function CriarContaPage() {
  return <SignupFlow />
}
