'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'
import styles from './TituloQueGira.module.css'

/** Quanto cada frase fica parada antes de ceder o lugar. */
const TEMPO_NA_TELA = 2400

/**
 * A linha do titulo que troca de frase — NR-125.
 *
 * ## Por que uma so linha gira
 *
 * O titulo do hero promete uma coisa; a frase que gira mostra QUAIS. Em vez
 * de uma lista que a pessoa precisa ler inteira, uma frase de cada vez no
 * lugar mais visivel da pagina. A parte fixa ("Pergunte pelo WhatsApp")
 * nunca se mexe — e ela que da sentido gramatical a todas.
 *
 * ## Por que a altura e reservada
 *
 * As frases sao posicionadas ABSOLUTAMENTE dentro de um bloco de altura
 * fixa. Sem isso, cada troca mudaria a altura do titulo e empurraria o
 * subtitulo e os botoes para baixo — e um botao que se move enquanto a
 * pessoa mira nele e pior que qualquer animacao.
 *
 * O `span` invisivel embaixo e o que reserva essa altura: ele carrega a
 * frase mais longa, na mesma fonte, para o bloco nascer do tamanho que o
 * pior caso exige. Uma altura em `px` chutada aqui quebraria no primeiro
 * celular estreito, onde a frase quebra em duas linhas.
 *
 * ## `prefers-reduced-motion`
 *
 * Quem pede menos movimento continua vendo as frases trocarem — o que some
 * e o deslize. A troca vira um corte seco: a informacao permanece, o
 * movimento vai embora. Parar de girar esconderia tres quartos do que o
 * titulo diz.
 */
export default function TituloQueGira({ frases }: { frases: readonly string[] }) {
  const [indice, setIndice] = useState(0)
  const semMovimento = useReducedMotion()

  useEffect(() => {
    const id = setTimeout(() => setIndice((n) => (n + 1) % frases.length), TEMPO_NA_TELA)
    return () => clearTimeout(id)
  }, [indice, frases.length])

  const maisLonga = frases.reduce((a, b) => (b.length > a.length ? b : a), '')

  return (
    <span className={styles.palco}>
      {/* Reserva a altura da pior frase. `aria-hidden` porque e medida, nao
          texto: quem usa leitor de tela ouviria a frase duas vezes. */}
      <span className={styles.medida} aria-hidden="true">
        {maisLonga}
      </span>

      {frases.map((frase, i) => (
        <motion.span
          key={frase}
          className={styles.frase}
          initial={false}
          animate={
            i === indice ? { y: 0, opacity: 1 } : { y: i < indice ? '-120%' : '120%', opacity: 0 }
          }
          transition={
            semMovimento
              ? { duration: 0 }
              : { type: 'spring', stiffness: 60, damping: 14, mass: 0.9 }
          }
          /* Fora da vez, a frase sai da arvore de acessibilidade: senao o
             leitor de tela anunciaria as quatro de uma vez, como se o titulo
             fosse uma lista. */
          aria-hidden={i !== indice}
        >
          {frase}
        </motion.span>
      ))}
    </span>
  )
}
