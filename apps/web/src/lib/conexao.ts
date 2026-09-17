/**
 * O navegador esta online? — NR-136.
 *
 * O ponto verde no avatar so vale alguma coisa se ele puder ficar cinza. Um
 * indicador que esta sempre aceso e decoracao; este muda quando a conexao cai,
 * e ai a pessoa entende por que a tela parou de responder antes de achar que o
 * sistema quebrou.
 *
 * `useSyncExternalStore` porque o estado mora fora do React (no navegador), e e
 * o padrao que o projeto ja usa para o tema e para o aviso de cookies.
 *
 * `navigator.onLine` nao garante internet de verdade: ele diz que ha uma rede
 * ligada. Cobre o caso comum (wi-fi caiu, cabo saiu) e nao inventa promessa
 * maior que essa.
 */

export function assinarConexao(ouvinte: () => void): () => void {
  window.addEventListener('online', ouvinte)
  window.addEventListener('offline', ouvinte)
  return () => {
    window.removeEventListener('online', ouvinte)
    window.removeEventListener('offline', ouvinte)
  }
}

export function lerConexao(): boolean {
  return navigator.onLine
}

/** No servidor nao ha navegador: assume conectado, como o primeiro paint. */
export function lerConexaoNoServidor(): boolean {
  return true
}
