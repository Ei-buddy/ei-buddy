import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import FornecedoresCadastroView from '@/components/fornecedores/FornecedoresCadastroView'

export const metadata: Metadata = {
  title: `Fornecedores — ${BRAND}`,
  description: 'O cadastro dos fornecedores da loja: CNPJ, contato e endereço.',
}

export default function FornecedoresCadastroPage() {
  return <FornecedoresCadastroView />
}
