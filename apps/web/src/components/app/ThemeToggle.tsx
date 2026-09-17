'use client'

import { useSyncExternalStore, type MouseEvent } from 'react'
import { IconMoon, IconSun } from '../Icons'
import { assinarTemaDoPainel, lerTemaDoPainel, lerTemaDoPainelNoServidor } from '@/lib/tema-painel'
import { trocarTemaDoPainel } from '@/lib/troca-de-tema'
import styles from './AppShell.module.css'

/**
 * O botao de mudar o tema do painel — NR-099.
 *
 * Fica no `.topActions` do `AppShell`, junto dos outros botoes de icone
 * (notificacoes, sair), e usa a MESMA classe `iconButton` deles — um botao
 * novo que parecesse outra coisa destacaria sem motivo.
 *
 * O icone mostra o tema ATUAL, nao o que o toque vai ligar: sol quando esta
 * claro, lua quando esta escuro. E a convencao mais comum (a "engrenagem"
 * do oposto seria mais precisa e menos reconhecivel — ninguem para para ler
 * o icone de um botao de uma tecla so).
 *
 * Ao tocar, o icone gira meia volta e um icone da lugar ao outro no meio do
 * giro, enquanto a luz do tema novo varre a tela a partir do dedo — NR-134.
 * Ver `lib/troca-de-tema.ts`.
 */
export default function ThemeToggle() {
  const tema = useSyncExternalStore(assinarTemaDoPainel, lerTemaDoPainel, lerTemaDoPainelNoServidor)

  function aoClicar(e: MouseEvent<HTMLButtonElement>) {
    /* `detail === 0` e o clique que veio do teclado (Enter ou Espaco): ali
       `clientX/Y` sao zero, e a luz nasceria no canto da tela. Sem ponto, a
       troca usa o centro. */
    const origem = e.detail === 0 ? null : { x: e.clientX, y: e.clientY }
    void trocarTemaDoPainel(origem)
  }

  return (
    <button
      type="button"
      className={`${styles.iconButton} ${styles.botaoDeTema}`}
      onClick={aoClicar}
      aria-label={tema === 'claro' ? 'Mudar para tema escuro' : 'Mudar para tema claro'}
      title={tema === 'claro' ? 'Tema claro' : 'Tema escuro'}
    >
      {/*
        Os dois icones ficam sempre no DOM, um sobre o outro: o giro precisa de
        algo saindo E algo entrando ao mesmo tempo. Trocar um pelo outro no
        React daria um corte no meio do movimento.
      */}
      <span className={styles.icones} data-tema={tema} aria-hidden="true">
        <span className={styles.iconeSol}>
          <IconSun size={19} />
        </span>
        <span className={styles.iconeLua}>
          <IconMoon size={19} />
        </span>
      </span>
    </button>
  )
}
