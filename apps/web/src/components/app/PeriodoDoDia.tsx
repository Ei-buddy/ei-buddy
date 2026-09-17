'use client'

import { useSyncExternalStore } from 'react'
import { IconMoon, IconSparkles, IconSun } from '../Icons'
import styles from './AppShell.module.css'

/**
 * O periodo do dia, ao lado do nome — NR-136.
 *
 * A tela principal ja cumprimenta por extenso ("Boa tarde, Gustavo"); aqui e
 * so o eco disso, em um icone: sol de manha, brilho de tarde, lua a noite.
 * Serve para a barra do topo acompanhar a hora em vez de parecer a mesma
 * imagem congelada das 7h as 23h.
 *
 * Os tres icones ficam no DOM e trocam por opacidade: quando a hora vira
 * durante o uso, um desaparece enquanto o outro aparece, em vez de um piscar
 * no lugar do outro.
 *
 * ## Por que `useSyncExternalStore`
 *
 * A hora mora fora do React, e a do servidor nao e a de quem le. Ler no
 * primeiro render e corrigir num efeito seria o `setState` sincrono que o
 * projeto proibe (e um render inteiro jogado fora); aqui o React usa a foto do
 * servidor para hidratar e troca sozinho pela do navegador. E o mesmo padrao
 * do tema e do aviso de cookies.
 *
 * A checagem e de minuto em minuto: mais que isso e trabalho para descobrir o
 * que muda tres vezes por dia.
 */

type Periodo = 'manha' | 'tarde' | 'noite'

const ROTULO: Record<Periodo, string> = {
  manha: 'Bom dia',
  tarde: 'Boa tarde',
  noite: 'Boa noite',
}

function assinarRelogio(ouvinte: () => void): () => void {
  const relogio = window.setInterval(ouvinte, 60_000)
  return () => window.clearInterval(relogio)
}

function lerPeriodo(): Periodo {
  const hora = new Date().getHours()
  if (hora < 12) return 'manha'
  if (hora < 18) return 'tarde'
  return 'noite'
}

/** No servidor nao ha fuso de quem le; o navegador corrige no primeiro quadro. */
function lerPeriodoNoServidor(): Periodo {
  return 'tarde'
}

export default function PeriodoDoDia() {
  const periodo = useSyncExternalStore(assinarRelogio, lerPeriodo, lerPeriodoNoServidor)

  return (
    <span className={styles.periodo} data-periodo={periodo} title={ROTULO[periodo]}>
      <span className={styles.periodoIcone} data-quando="manha" aria-hidden="true">
        <IconSun size={15} />
      </span>
      <span className={styles.periodoIcone} data-quando="tarde" aria-hidden="true">
        <IconSparkles size={15} />
      </span>
      <span className={styles.periodoIcone} data-quando="noite" aria-hidden="true">
        <IconMoon size={15} />
      </span>
      {/* O icone sozinho nao diz nada a quem usa leitor de tela, e `title` nao
          e lido de forma confiavel. */}
      <span className={styles.apenasLeitorDeTela}>{ROTULO[periodo]}</span>
    </span>
  )
}
