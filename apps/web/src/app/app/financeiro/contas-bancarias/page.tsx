import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import ContasBancariasView from '@/components/financeiro/ContasBancariasView'

export const metadata: Metadata = {
  title: `Contas bancárias — ${BRAND}`,
  description: 'As contas da loja, com o saldo de cada uma.',
}

export default function ContasBancariasPage() {
  return <ContasBancariasView />
}
