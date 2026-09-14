'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Comeca a pagina no topo ao carregar, recarregar, ou navegar para outra rota.
 *
 * Por padrao o navegador guarda a posicao de rolagem e a restaura no refresh
 * (`history.scrollRestoration === 'auto'`). Numa pagina longa como a landing
 * isso faz o recarregamento cair no meio do documento, e ainda briga com a
 * rolagem suave de `scroll-behavior: smooth` — as duas disputam a posicao ao
 * mesmo tempo e o resultado e imprevisivel.
 *
 * `manual` desliga a restauracao e devolve o controle para a pagina.
 *
 * **Por que depende de `usePathname()`.** Este componente vive no layout
 * raiz, que nao remonta entre navegacoes client-side (`<Link>`) — sem isso o
 * efeito rodaria uma unica vez, na primeira carga. O router do Next tambem
 * guarda a posicao de rolagem por URL e a repoe ao voltar para uma pagina ja
 * visitada (ex: clicar em "Voltar" da politica de cookies para a landing
 * depois de ter rolado ate o rodape cai de volta no rodape). Rodar de novo a
 * cada troca de `pathname` garante que toda navegacao comece no topo.
 *
 * **Link com ancora continua funcionando.** Se a URL trouxer um hash
 * (`/#planos`, compartilhado por alguem), respeitamos o destino em vez de
 * forcar o topo — senao a correcao quebraria todo link profundo do rodape.
 */
export default function ScrollRestoration() {
  const pathname = usePathname()

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
  }, [])

  useEffect(() => {
    if (!window.location.hash) {
      /* `instant` e nao `smooth`: ao trocar de pagina nao ha de onde animar. */
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }, [pathname])

  return null
}
