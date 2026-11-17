import type { Metadata } from 'next'
import ProdutoDetalhe from '@/components/produtos/ProdutoDetalhe'

/**
 * A ficha do produto — RF-017, RF-022, RF-023, RF-124.
 *
 * O titulo nao traz mais a descricao do produto: ela vinha de `mock-data`, e
 * busca-la aqui so para o `<title>` exigiria repassar o cookie de sessao no
 * servidor e fazer a mesma chamada duas vezes. A descricao continua no
 * cabecalho da pagina, que e onde se le.
 */
export const metadata: Metadata = {
  title: 'Produto',
}

export default async function ProdutoDetalhePage({ params }: PageProps<'/app/produtos/[id]'>) {
  const { id } = await params

  /* Quem decide que o produto nao existe e a api: o 404 dela cobre "nao
     existe" e "e de outra loja" com a mesma resposta, de proposito. */
  return <ProdutoDetalhe produtoId={id} />
}
