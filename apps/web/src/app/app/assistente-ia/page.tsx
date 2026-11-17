import type { Metadata } from 'next'
import { Suspense } from 'react'
import ChatAssistente from '@/components/assistente/ChatAssistente'

export const metadata: Metadata = {
  title: 'Assistente',
  description: 'Pergunte em texto sobre vendas, clientes, produtos e contas.',
}

export default function AssistentePage() {
  /* useSearchParams (a pergunta vinda de outra tela) exige Suspense em
     pagina estatica. */
  return (
    <Suspense fallback={null}>
      <ChatAssistente />
    </Suspense>
  )
}
