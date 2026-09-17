import type { Metadata } from 'next'
import { BRAND } from '@/content/site'
import TrilhaDaPessoa from '@/components/auditoria/TrilhaDaPessoa'

/**
 * O que UMA pessoa fez na loja — US-061.
 *
 * O nome NAO entra no titulo: ele so aparece na resposta da trilha, que a
 * tela busca no cliente. Repeti-la aqui, no servidor, so para o `<title>`
 * duplicaria a chamada. O nome continua visivel no cabecalho da pagina.
 */
export const metadata: Metadata = {
  title: `Auditoria — ${BRAND}`,
}

export default async function TrilhaDaPessoaPage({
  params,
}: PageProps<'/app/auditoria/[actorId]'>) {
  const { actorId } = await params

  return <TrilhaDaPessoa actorId={actorId} />
}
