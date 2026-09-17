/**
 * Numero forjado do harness: so digitos. `+55 11 99900-0001` e
 * `5511999000001` viram a mesma chave.
 */
export function normalizarPeer(peer: string): string {
  return peer.replace(/\D/g, '')
}
