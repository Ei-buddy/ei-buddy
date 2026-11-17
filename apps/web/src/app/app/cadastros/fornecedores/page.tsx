import type { Metadata } from 'next'
import FornecedoresCadastroView from '@/components/fornecedores/FornecedoresCadastroView'

export const metadata: Metadata = {
  title: 'Fornecedores',
  description: 'O cadastro dos fornecedores da loja: CNPJ, contato e endereço.',
}

export default function FornecedoresCadastroPage() {
  return <FornecedoresCadastroView />
}
