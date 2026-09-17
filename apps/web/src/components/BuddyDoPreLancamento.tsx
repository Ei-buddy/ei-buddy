'use client'

import Image from 'next/image'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import styles from './BuddyDoPreLancamento.module.css'

/**
 * O Buddy chegando no topo da landing — NR-135.
 *
 * Ele nao esta la desde sempre: entra depois do texto, como um personagem que
 * chega na cena, fala, e sai quando a cena acaba.
 *
 * ## A ordem importa
 *
 * O texto aparece primeiro (a pagina ja carregou com ele), o Buddy chega
 * 250ms depois, e o balao so fala quando ele terminou de chegar. Tudo ao
 * mesmo tempo leria como uma ilustracao carregando; em ordem, le como
 * alguem entrando.
 *
 * Na saida a ordem se inverte: o balao some primeiro — quem vai embora para
 * de falar antes de sair da sala.
 *
 * ## Por que `IntersectionObserver`, e com duas marcas
 *
 * A entrada e a saida seguem a secao, e nao a posicao da rolagem: posicao
 * bruta obriga a recalcular a cada quadro e erra quando a altura da secao
 * muda. As DUAS marcas (sai abaixo de 60% visivel, volta acima de 70%) sao o
 * que impede o Buddy de piscar entrando e saindo quando alguem rola devagar
 * bem na borda — com uma marca so, um pixel para cima e para baixo ficaria
 * ligando e desligando a animacao.
 *
 * ## Movimento reduzido
 *
 * Sem deslizar, sem pulso na sombra: so aparecer e sumir.
 */

/** Abaixo disto visivel, ele vai embora. */
const SAI_ABAIXO_DE = 0.6
/** Acima disto, ele volta. */
const VOLTA_ACIMA_DE = 0.7

const FALA = 'Oi! Ainda estou sendo construído. Topa me ajudar a ficar craque?'

/** Ease-out-expo suave: corre no comeco e assenta devagar. */
const CHEGADA = [0.22, 1, 0.36, 1] as const
/** Um empurraozinho alem do ponto final — o "pop" de balao de desenho. */
const POP = [0.34, 1.56, 0.64, 1] as const

export default function BuddyDoPreLancamento() {
  const ancora = useRef<HTMLDivElement>(null)
  const [naCena, setNaCena] = useState(false)
  const semMovimento = useReducedMotion()
  /* No celular nao ha espaco ao lado do texto: ele entra por baixo do botao,
     e entao vem de baixo, e nao da direita. */
  const [estreito, setEstreito] = useState(false)

  useEffect(() => {
    const consulta = window.matchMedia('(max-width: 939px)')
    const ler = () => setEstreito(consulta.matches)
    ler()
    consulta.addEventListener('change', ler)
    return () => consulta.removeEventListener('change', ler)
  }, [])

  useEffect(() => {
    const secao = ancora.current?.closest('section')
    if (!secao) return

    const observador = new IntersectionObserver(
      ([entrada]) => {
        const visivel = entrada?.intersectionRatio ?? 0
        setNaCena((estava) => (estava ? visivel >= SAI_ABAIXO_DE : visivel >= VOLTA_ACIMA_DE))
      },
      /* Varias marcas porque o callback so dispara AO CRUZAR uma delas: com
         `threshold: 0.6` apenas, a proporcao chegaria em 0,61 e nunca mais
         avisaria nada ate cruzar 0,6 de novo. */
      { threshold: [0, 0.3, 0.55, 0.6, 0.65, 0.7, 0.8, 1] },
    )

    observador.observe(secao)
    return () => observador.disconnect()
  }, [])

  const deslocamento = semMovimento ? {} : estreito ? { y: 90 } : { x: 190, y: 12 }

  return (
    <div className={styles.ancora} ref={ancora}>
      <AnimatePresence>
        {naCena ? (
          <motion.div
            key="buddy"
            className={styles.palco}
            initial={{ opacity: 0, ...deslocamento }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{
              opacity: 0,
              ...deslocamento,
              /* O atraso e o que poe o Buddy DEPOIS do balao na saida: ele so
                 comeca a deslizar quando o balao ja esta sumindo. */
              transition: { duration: 0.45, delay: 0.14, ease: 'easeIn' },
            }}
            transition={{
              duration: 0.8,
              /* Chega depois do texto: a pagina ja esta lida quando ele entra. */
              delay: 0.25,
              ease: CHEGADA,
            }}
          >
            <div className={styles.buddy}>
              <Image
                src="/buddy.png"
                alt=""
                fill
                className={styles.imagem}
                sizes="(min-width: 940px) 260px, 170px"
                priority
              />
            </div>

            {/* A sombra respira, para ele nao parecer colado no chao. */}
            <span className={styles.sombra} aria-hidden="true" />

            <motion.p
              className={styles.balao}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              /* Sai antes dele: quem vai embora para de falar antes de sair. */
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
              transition={{
                duration: 0.42,
                /* Ele chega (0,25 + 0,8) e so entao fala. */
                delay: 1.23,
                ease: semMovimento ? 'easeOut' : POP,
              }}
            >
              {FALA}
            </motion.p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
