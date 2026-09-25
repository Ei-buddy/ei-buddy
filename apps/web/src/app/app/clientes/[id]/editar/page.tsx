import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import EditarCliente from '@/components/clientes/EditarCliente'

export const metadata: Metadata = {
  title: `Editar cliente — ${BRAND}`,
}

/**
 * Editar o cadastro do cliente — RF-009.
 *
 * A pagina e um casco: quem busca a ficha e decide o que desenhar enquanto ela
 * nao chegou e o componente cliente, porque `ClienteForm` precisa dos valores
 * ANTES do primeiro desenho — campo controlado que nasce vazio e so depois
 * recebe o valor perde o que a pessoa digitar nesse intervalo.
 */
export default async function EditarClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return <EditarCliente clienteId={id} />
}
