import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import ProdutoForm from '@/components/produtos/ProdutoForm'

export const metadata: Metadata = {
  title: `Editar produto — ${BRAND}`,
}

/** Editar o cadastro do produto — RF-017. O 404 de outra loja vem da api. */
export default async function EditarProdutoPage({
  params,
}: PageProps<'/app/produtos/[id]/editar'>) {
  const { id } = await params

  return <ProdutoForm produtoId={id} />
}
