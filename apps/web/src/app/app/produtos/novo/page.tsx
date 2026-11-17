import type { Metadata } from 'next'
import ProdutoForm from '@/components/produtos/ProdutoForm'

export const metadata: Metadata = {
  title: 'Novo produto',
}

export default function NovoProdutoPage() {
  return <ProdutoForm />
}
