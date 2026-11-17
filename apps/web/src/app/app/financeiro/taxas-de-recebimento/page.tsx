import type { Metadata } from 'next'
import TaxasDeRecebimentoView from '@/components/financeiro/TaxasDeRecebimentoView'

export const metadata: Metadata = {
  title: 'Taxas de recebimento',
  description:
    'O que a maquininha cobra no Pix, débito e crédito, e em quantos dias o dinheiro cai.',
}

export default function TaxasDeRecebimentoPage() {
  return <TaxasDeRecebimentoView />
}
