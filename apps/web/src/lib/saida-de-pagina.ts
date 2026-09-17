/**
 * A saida da tela atual, antes de a proxima chegar — NR-133.
 *
 * O App Router nao tem evento de "estou saindo desta tela": quando a nova
 * renderiza, a antiga ja foi. Entao quem avisa e o clique — a barra lateral
 * marca o `<body>` ao navegar, e o CSS do conteudo reage. O `template.tsx` da
 * tela que chega apaga a marca ao montar, e e por isso que ela e o sinal certo:
 * montou, a navegacao aconteceu.
 *
 * ## O prazo de seguranca
 *
 * Nem todo clique vira navegacao: a rota pode falhar, ou a pessoa pode clicar
 * no item da tela em que ja esta. Sem o prazo, a marca ficaria no `<body>` e o
 * conteudo sumiria de vez.
 *
 * 320ms, e nao mais: se a tela nova demorar alem disso, e melhor a atual
 * voltar a aparecer do que a pessoa ficar olhando para um vazio. Medido, uma
 * troca normal leva ~200ms.
 *
 * ## Cliques em sequencia
 *
 * Clicar rapido em tres itens nao enfileira nada: marcar de novo so reinicia o
 * prazo, e a saida e uma transicao de CSS, que o navegador substitui pela nova
 * em vez de esperar a anterior terminar.
 */

const PRAZO_DE_SEGURANCA = 320

let prazo: number | undefined

/** Marca que a tela atual esta saindo. Ignora quando o destino ja e a tela. */
export function marcarSaida(destino: string, atual: string) {
  if (typeof document === 'undefined') return
  if (destino === atual) return

  document.body.dataset.saindo = 'sim'
  window.clearTimeout(prazo)
  prazo = window.setTimeout(limparSaida, PRAZO_DE_SEGURANCA)
}

/** A tela nova chegou (ou o prazo estourou): o conteudo volta a aparecer. */
export function limparSaida() {
  if (typeof document === 'undefined') return

  window.clearTimeout(prazo)
  delete document.body.dataset.saindo
}
