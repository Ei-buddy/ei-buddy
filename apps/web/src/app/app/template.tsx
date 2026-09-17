import type { ReactNode } from 'react'
import FimDaSaida from '@/components/app/FimDaSaida'
import styles from './template.module.css'

/**
 * A transicao entre as telas do painel — NR-133.
 *
 * ## Por que `template.tsx`, e nao `layout.tsx`
 *
 * O layout NAO remonta entre navegacoes — e essa e a graca dele: a barra
 * lateral, a barra do topo e o estado delas sobrevivem a troca de tela. Mas
 * animacao de entrada precisa justamente de uma montagem para disparar.
 *
 * O `template` e a peca que o App Router remonta a cada navegacao. Ele envolve
 * so o conteudo, entao a animacao pega a tela que chega e nao encosta na barra
 * lateral — que continua parada, como deve.
 *
 * ## Curta de proposito
 *
 * 180ms de entrada, 120ms de saida. Isto nao e a travessia do login (NR-132),
 * que acontece uma vez por dia: aqui sao dezenas de vezes por sessao, e uma
 * animacao que se faz notar na decima vez ja cansou na terceira. O que se
 * quer e a sensacao de continuidade, nao o efeito.
 */
export default function TemplateDoPainel({ children }: { children: ReactNode }) {
  return (
    <div className={styles.pagina}>
      <FimDaSaida />
      {children}
    </div>
  )
}
