import type { Metadata } from 'next'
import ClienteDetalhe from '@/components/clientes/ClienteDetalhe'

/**
 * A ficha do cliente — RF-011.
 *
 * O titulo NAO traz mais o nome do cliente. Ele vinha de `mock-data`, e buscar
 * a ficha aqui so para o `<title>` exigiria repassar o cookie de sessao no
 * servidor e fazer a mesma chamada duas vezes — uma para o titulo e outra na
 * tela. O nome continua no cabecalho da pagina, que e onde se le.
 */
export const metadata: Metadata = {
  title: 'Cliente',
}

export default async function ClienteDetalhePage({ params }: PageProps<'/app/clientes/[id]'>) {
  const { id } = await params

  /* Quem decide que o cliente nao existe e a api: o 404 dela cobre "nao
     existe" e "e de outra loja" com a mesma resposta, de proposito. Um
     `notFound()` aqui precisaria repetir essa consulta no servidor. */
  return <ClienteDetalhe clienteId={id} />
}
