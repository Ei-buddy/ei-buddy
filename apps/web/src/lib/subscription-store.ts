/**
 * A situacao da assinatura, compartilhada pelas telas — NR-216.
 *
 * A fonte e `GET /assinatura` no servidor. Antes era o `localStorage`
 * (`demo:subscription-status`), escrito so pelo cadastro: nenhuma cobranca,
 * atraso ou restricao chegava a mudar o que a tela mostrava.
 *
 * Exposta como "external store" (getSnapshot/subscribe) para ser lida com
 * `useSyncExternalStore`: o HTML do servidor nasce com "sem assinatura"
 * (liberado) e o navegador troca pelo valor real assim que a leitura volta,
 * sem `setState` em efeito.
 */

import {
  lerAssinaturaDoServidor,
  SEM_ASSINATURA,
  type SituacaoDaAssinatura,
} from './assinatura-api'

let atual: SituacaoDaAssinatura = SEM_ASSINATURA
const listeners = new Set<() => void>()

/** Valor lido no cliente. Estavel entre chamadas: `getSnapshot` exige. */
export function getSubscriptionSnapshot(): SituacaoDaAssinatura {
  return atual
}

/** Valor usado no HTML do servidor e durante a hidratacao. */
export function getSubscriptionServerSnapshot(): SituacaoDaAssinatura {
  return SEM_ASSINATURA
}

export function subscribeSubscription(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function publicar(proxima: SituacaoDaAssinatura): void {
  atual = proxima
  listeners.forEach((listener) => listener())
}

/**
 * Busca de novo no servidor.
 *
 * Falha de rede MANTEM o ultimo valor conhecido: trocar por "liberado" a
 * cada oscilacao desbloquearia uma loja restrita, e trocar por "restrito"
 * bloquearia quem esta em dia. Nenhum dos dois e o que o servidor disse.
 *
 * Sessao sem loja ativa volta a "sem assinatura": nao ha o que restringir,
 * e a situacao da loja anterior nao pode continuar valendo.
 */
let ultimaLeitura = 0

export async function recarregarAssinatura(): Promise<SituacaoDaAssinatura> {
  /* Vale so a ULTIMA leitura pedida. Trocando de tela rapido, duas leituras
     podem voltar fora de ordem — a de antes de entrar numa loja (401) chegando
     depois da de dentro dela apagaria a situacao certa. */
  const minha = ++ultimaLeitura
  const lida = await lerAssinaturaDoServidor()
  if (minha !== ultimaLeitura) return atual

  if (lida === 'sem-empresa') publicar(SEM_ASSINATURA)
  else if (lida !== null) publicar(lida)
  return atual
}
