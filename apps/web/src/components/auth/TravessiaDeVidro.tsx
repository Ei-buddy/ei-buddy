'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import styles from './TravessiaDeVidro.module.css'

/**
 * A passagem do login para dentro do painel — NR-132.
 *
 * A senha foi aceita: em vez de a tela simplesmente trocar, ela atravessa. O
 * cartao de entrada e uma porta de vidro (NR-129), e esta e a travessia dela.
 *
 * ## A linha do tempo
 *
 * - **0–250ms, confirmacao.** O botao vira um ✓ com pulso. Quem apertou
 *   "Entrar" sabe na hora que deu certo, sem adivinhar pelo que vem depois.
 * - **250–550ms, convergencia.** O cartao encolhe para o centro e apaga,
 *   enquanto o fundo desfoca — o `data-entrando` no `<body>` e o que liga
 *   isso; o CSS de cada peca reage sozinho.
 * - **550–950ms, o estalo.** Um clarao radial sai do centro para as bordas,
 *   como luz atravessando vidro. A navegacao acontece no fim dele.
 * - **depois, o assentar.** Ja e do outro lado: a barra, o topo e o conteudo
 *   entram escalonados. Mora em `AppShell.module.css`.
 *
 * ## Animacao de entrada, e nao tela de carregamento
 *
 * A rota do painel e pedida ANTES (`router.prefetch`, no formulario), entao
 * ela costuma estar pronta quando o clarao termina. O tempo total e fixo em
 * ~1,4s: a sequencia nao espera rede nenhuma, e por isso nao vira aquele
 * carregamento artificial que so existe para exibir a animacao.
 *
 * ## Movimento reduzido
 *
 * Nada disso acontece: `aoTerminar` e chamado no primeiro quadro e a pessoa
 * vai direto para o painel.
 */

/** Quando o cartao comeca a encolher, em ms. */
const CONVERGENCIA = 250
/**
 * Quando a navegacao dispara: o FIM do clarao, e nao o pico.
 *
 * No pico a tela esta branca, e trocar de pagina ali cortaria o brilho no meio
 * — a pagina que carrega o clarao e a que sai. No fim ele ja voltou a
 * transparente, e a troca nao aparece.
 */
const TRAVESSIA = 950

export default function TravessiaDeVidro({ aoTerminar }: { aoTerminar: () => void }) {
  const semMovimento = useReducedMotion()
  /* A navegacao e um efeito colateral que so pode acontecer uma vez; o React
     monta o efeito duas vezes em desenvolvimento (StrictMode). */
  const jaFoi = useRef(false)

  useEffect(() => {
    if (jaFoi.current) return

    if (semMovimento) {
      jaFoi.current = true
      aoTerminar()
      return
    }

    const converge = window.setTimeout(() => {
      document.body.dataset.entrando = 'sim'
    }, CONVERGENCIA)

    const atravessa = window.setTimeout(() => {
      jaFoi.current = true
      aoTerminar()
    }, TRAVESSIA)

    return () => {
      window.clearTimeout(converge)
      window.clearTimeout(atravessa)
      /* Sem isto, uma volta ao login (por um erro na escolha de loja, por
         exemplo) encontraria a tela ainda encolhida e desfocada. */
      delete document.body.dataset.entrando
    }
  }, [semMovimento, aoTerminar])

  if (semMovimento || typeof document === 'undefined') return null

  return createPortal(
    <motion.div
      className={styles.clarao}
      aria-hidden="true"
      initial={{ opacity: 0, scale: 0.2 }}
      animate={{ opacity: [0, 0.85, 0], scale: [0.2, 1.6, 2.4] }}
      transition={{ duration: 0.4, delay: 0.55, times: [0, 0.45, 1], ease: 'easeOut' }}
    />,
    document.body,
  )
}
