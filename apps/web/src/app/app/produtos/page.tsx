import type { Metadata } from 'next'
import ProdutosLista from '@/components/produtos/ProdutosLista'

export const metadata: Metadata = {
  title: 'Produtos',
  description: 'Catálogo, preços e controle de estoque.',
}

export default function ProdutosPage() {
  return <ProdutosLista />
}
