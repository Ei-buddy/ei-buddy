import type { Metadata } from 'next'
import FornecedoresView from '@/components/fornecedores/FornecedoresView'

export const metadata: Metadata = {
  title: 'Fornecedores',
  description: 'Busque quem vende o que você precisa, perto de você, e peça conexão.',
}

export default function FornecedoresPage() {
  return <FornecedoresView />
}
