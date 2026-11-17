import type { Metadata } from 'next'
import PlanoDeContasView from '@/components/financeiro/PlanoDeContasView'

export const metadata: Metadata = {
  title: 'Plano de contas',
  description: 'Estrutura de receitas e despesas, e custos fixos do negócio.',
}

export default function PlanoDeContasPage() {
  return <PlanoDeContasView />
}
