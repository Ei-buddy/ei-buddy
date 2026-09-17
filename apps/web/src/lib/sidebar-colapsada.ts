/**
 * Barra lateral recolhida ou aberta — NR-126.
 *
 * ## O que a preferencia guarda
 *
 * Recolhida, a barra mostra so os icones e devolve 180px de largura ao
 * conteudo. Quem opera o dia inteiro na mesma tela quer essa largura; quem
 * ainda esta aprendendo o sistema quer os rotulos. Nenhum dos dois quer
 * reescolher a cada abertura — por isso persiste.
 *
 * So vale no desktop. No celular a barra ja e um painel que sobrepoe o
 * conteudo e some ao navegar; "recolher" ali nao significaria nada.
 *
 * ## Por que `useSyncExternalStore`, como o tema
 *
 * `localStorage` mora FORA do React. Ler num efeito e chamar `setState` no
 * corpo dele joga um render inteiro fora a cada abertura de tela, e o lint do
 * repo reprova — mesma razao do `tema-painel.ts` e do `AvisoDeCookies`.
 *
 * `getServerSnapshot` devolve `false` (aberta): e o estado em que a barra
 * sempre nasceu, e o que o servidor pinta. Quem prefere recolhida ve a troca
 * no primeiro quadro apos a hidratacao — uma barra que encolhe e menos ruim
 * que uma que nasce estreita e cresce na cara de quem nunca pediu isso.
 */

/** Documentada no inventario de armazenamento local — lib/cookies.ts. */
export const CHAVE_SIDEBAR = 'nr:sidebar-recolhida'

const ouvintes = new Set<() => void>()

export function assinarSidebar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte)
  return () => ouvintes.delete(ouvinte)
}

export function lerSidebarRecolhida(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_SIDEBAR) === '1'
  } catch {
    /* Navegacao anonima ou storage bloqueado: a barra abre, que e o padrao. */
    return false
  }
}

export function lerSidebarRecolhidaNoServidor(): boolean {
  return false
}

export function alternarSidebar(): void {
  const proximo = !lerSidebarRecolhida()

  try {
    window.localStorage.setItem(CHAVE_SIDEBAR, proximo ? '1' : '0')
  } catch {
    /* Sem storage, a escolha vale so para esta sessao — melhor que travar. */
  }

  for (const ouvinte of ouvintes) ouvinte()
}
