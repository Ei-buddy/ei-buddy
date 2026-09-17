'use client'

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import type { PointerEvent, ReactNode } from 'react'
import styles from './CartaoDeVidro.module.css'

/** Inclinacao maxima, em graus, em cada eixo. */
const INCLINACAO = 5

/**
 * Acima desta altura o cartao nao inclina.
 *
 * O mesmo angulo desloca muito mais as pontas de um cartao alto: no cadastro,
 * com mais de 1.100px, 5 graus viravam dezenas de pixels de balanco no topo e
 * na base. O cartao parecia fugir do cursor enquanto a pessoa ia de um campo
 * a outro, e o movimento deixava a vista tonta. Login e recuperacao de senha
 * ficam bem abaixo disto; o cadastro fica parado.
 */
const ALTURA_MAXIMA_PARA_INCLINAR = 640

/**
 * O cartao de vidro das telas de entrada — NR-129, so visual.
 *
 * Envolve login, cadastro e recuperacao de senha. Nao sabe nada do formulario
 * que carrega: validacao, envio e redirecionamento continuam em cada um deles.
 *
 * ## Por que a inclinacao e pequena
 *
 * O componente de referencia inclina bem mais, mas la o cartao so tinha dois
 * campos. Aqui ele carrega tambem o cadastro, com varias etapas: um cartao que
 * balanca muito enquanto a pessoa preenche CNPJ e endereco deixa de ser efeito
 * e vira obstaculo. Cinco graus bastam para ler como objeto, e nao como tela.
 *
 * ## Quando ela NAO acontece
 *
 * - **Toque**: so ponteiro de mouse inclina. Num celular, o dedo que toca o
 *   campo arrastaria o cartao junto — e o formulario fugiria do dedo.
 * - **Movimento reduzido**: nada inclina. O vidro, os halos e o resto ficam.
 * - **Cartao alto** (o cadastro): nada inclina. Ver `ALTURA_MAXIMA_PARA_INCLINAR`.
 */
export default function CartaoDeVidro({ children }: { children: ReactNode }) {
  const semMovimento = useReducedMotion()

  /* Posicao do ponteiro no cartao, de -0,5 a 0,5 em cada eixo. */
  const x = useMotionValue(0)
  const y = useMotionValue(0)

  /* Mola, e nao posicao crua: seguir o mouse ao pixel treme a cada
     movimento; a mola amacia e devolve o cartao ao centro sem tranco. */
  const mola = { stiffness: 140, damping: 20, mass: 0.6 }
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [INCLINACAO, -INCLINACAO]), mola)
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-INCLINACAO, INCLINACAO]), mola)

  /*
   * O `style` vai sempre, mesmo com movimento reduzido — e o que impede a
   * inclinacao e o `aoMover` nao escrever nada.
   *
   * `useReducedMotion` e `null` no servidor e `true` no navegador de quem
   * pediu menos movimento: escolher o `style` por ele fazia o HTML do servidor
   * e o da hidratacao divergirem, e o React reclamava.
   */
  function aoMover(e: PointerEvent<HTMLDivElement>) {
    if (semMovimento || e.pointerType !== 'mouse') return
    const caixa = e.currentTarget.getBoundingClientRect()
    if (caixa.height > ALTURA_MAXIMA_PARA_INCLINAR) return
    x.set((e.clientX - caixa.left) / caixa.width - 0.5)
    y.set((e.clientY - caixa.top) / caixa.height - 0.5)
  }

  function aoSair() {
    x.set(0)
    y.set(0)
  }

  return (
    <div className={styles.palco}>
      <motion.div
        className={styles.cartao}
        /* `data-vidro` e o que liga o estilo de vidro nos campos: eles sao os
           mesmos componentes usados na lista VIP e no painel, e so dentro
           deste cartao devem mudar de aparencia. Ver `auth-form.module.css`. */
        data-vidro=""
        onPointerMove={aoMover}
        onPointerLeave={aoSair}
        style={{ rotateX, rotateY, transformPerspective: 1200 }}
      >
        {children}
      </motion.div>
    </div>
  )
}
