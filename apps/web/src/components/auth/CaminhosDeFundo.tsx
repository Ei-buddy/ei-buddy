'use client'

import { useEffect, useRef } from 'react'
import styles from './CaminhosDeFundo.module.css'

/**
 * As linhas que correm atras do cartao nas telas de entrada — NR-129.
 *
 * Vem do componente `background-paths`, sem o titulo e sem o botao: aqui ele
 * e so fundo. Duas camadas espelhadas de 36 curvas, uma em azul e outra em
 * verde-agua, as cores da marca no lugar do cinza-ardosia do original.
 *
 * ## Canvas, e nao SVG animado
 *
 * O original anima 72 `<path>` com framer-motion. Medido nesta tela, com GPU:
 * 60 quadros por segundo sem as linhas, 25 com elas pelo framer, 15 com elas
 * por animacao CSS. O gargalo e o navegador repintar o SVG inteiro a cada
 * quadro, e trocar quem anima nao muda isso. Num celular de entrada o login
 * engasgaria.
 *
 * O canvas desenha as mesmas curvas com `Path2D` e o mesmo tracejado com
 * `lineDashOffset`, numa passada so por quadro — e volta a 60.
 *
 * ## Por que o fluxo e continuo
 *
 * No original cada linha cresce, anda ate sair pelo fim do proprio caminho e
 * volta. Como as duracoes ficam todas entre 20 e 30 segundos, elas saem
 * JUNTAS no meio do ciclo: medido, a area pintada ia de 15% da tela a 1,8%,
 * e o fundo passava segundos quase vazio. Numa tela de login isso le como
 * defeito. Aqui o tracejado tem vao curto e corre em laco — sempre ha faixa
 * na tela.
 *
 * ## Movimento reduzido
 *
 * As linhas continuam la, inteiras e paradas. O desenho e a textura do fundo;
 * o que incomoda quem pediu menos movimento e o fluxo, e e so ele que sai.
 */

const QUANTAS = 36

/*
 * O tracejado, em fracoes do comprimento de cada linha.
 *
 * Trecho longo e vao curto: a qualquer momento mais de 70% de cada linha esta
 * desenhada, e o vao que corre por ela e o que da a sensacao de fluxo.
 */
const TRECHO = 0.58
const VAO = 0.22
/** Andar um periodo inteiro devolve o desenho ao ponto de partida — laco sem emenda. */
const PERIODO = TRECHO + VAO

/*
 * Enquadramento proprio, e nao o `0 0 696 316` do original.
 *
 * As curvas saem de fora da tela no alto a esquerda e terminam fora dela
 * embaixo a direita. O original foi feito para um banner largo: numa tela de
 * login, mais alta, ele desenhava so a metade de baixo — e o cartao cobria o
 * resto. Esta caixa enquadra a faixa inteira e e esticada ate cobrir a tela em
 * qualquer proporcao, do monitor ao celular em pe (o `slice` do SVG).
 */
const CAIXA = { x: -300, y: -250, largura: 1100, altura: 950 }

/* Tons escuros da marca, e nao os vivos: sobre fundo quase branco, o azul
   claro some e o teal claro vira mancha. A opacidade de cada linha ja e baixa,
   entao o resultado fica suave mesmo com a tinta forte. */
const CORES = { 1: '#1565c0', [-1]: '#1f8a80' } as const

type Linha = {
  forma: Path2D
  comprimento: number
  cor: string
  largura: number
  opacidade: number
  /** Segundos para o tracejado andar um periodo. */
  duracao: number
  fase: number
}

function curva(i: number, posicao: 1 | -1) {
  return `M-${380 - i * 5 * posicao} -${189 + i * 6}C-${380 - i * 5 * posicao} -${189 + i * 6} -${
    312 - i * 5 * posicao
  } ${216 - i * 6} ${152 - i * 5 * posicao} ${343 - i * 6}C${616 - i * 5 * posicao} ${
    470 - i * 6
  } ${684 - i * 5 * posicao} ${875 - i * 6} ${684 - i * 5 * posicao} ${875 - i * 6}`
}

function montarLinhas(): Linha[] {
  /* O canvas nao mede caminho; um `<path>` fora da arvore visivel mede. */
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.style.position = 'absolute'
  svg.style.width = '0'
  svg.style.height = '0'
  document.body.appendChild(svg)

  const linhas: Linha[] = []
  for (const posicao of [1, -1] as const) {
    for (let i = 0; i < QUANTAS; i++) {
      const d = curva(i, posicao)
      const medidor = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      medidor.setAttribute('d', d)
      svg.appendChild(medidor)
      linhas.push({
        forma: new Path2D(d),
        comprimento: medidor.getTotalLength(),
        cor: CORES[posicao],
        largura: 0.5 + i * 0.03,
        opacidade: Math.min(1, 0.1 + i * 0.03),
        /* Espalhadas entre ~7 e 10 segundos por periodo, sem sorteio. */
        duracao: (20 + ((i * 7) % 11)) / 3,
        /* Defasagem pequena entre vizinhas: as 36 andam quase juntas, como
           uma faixa, com uma ondulacao leve de uma borda a outra. */
        fase: i * 0.012,
      })
    }
  }

  svg.remove()
  return linhas
}

export default function CaminhosDeFundo() {
  const tela = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = tela.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const linhas = montarLinhas()
    const movimento = window.matchMedia('(prefers-reduced-motion: reduce)')
    let quadro = 0

    function enquadrar() {
      if (!canvas || !ctx) return
      /* Nitido em tela retina, mas sem passar de 2x: acima disso o custo
         cresce e a diferenca, em linhas finas e translucidas, nao aparece. */
      const densidade = Math.min(window.devicePixelRatio || 1, 2)
      const { width, height } = canvas.getBoundingClientRect()
      canvas.width = Math.round(width * densidade)
      canvas.height = Math.round(height * densidade)

      const escala = Math.max(width / CAIXA.largura, height / CAIXA.altura) * densidade
      ctx.setTransform(
        escala,
        0,
        0,
        escala,
        canvas.width / 2 - (CAIXA.x + CAIXA.largura / 2) * escala,
        canvas.height / 2 - (CAIXA.y + CAIXA.altura / 2) * escala,
      )
    }

    function desenhar(segundos: number | null) {
      if (!canvas || !ctx) return
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.restore()

      for (const l of linhas) {
        ctx.strokeStyle = l.cor
        ctx.lineWidth = l.largura
        if (segundos === null) {
          ctx.globalAlpha = l.opacidade * 0.45
          ctx.setLineDash([])
        } else {
          /* A respiracao de opacidade do original, entre 0,35 e 0,6. */
          const respiro = 0.475 - 0.125 * Math.cos((segundos / (l.duracao * 1.5)) * Math.PI * 2)
          ctx.globalAlpha = l.opacidade * respiro
          ctx.setLineDash([TRECHO * l.comprimento, VAO * l.comprimento])
          const andado = (segundos / l.duracao) % 1
          /* Negativo: o tracejado anda do comeco para o fim de cada curva. */
          ctx.lineDashOffset = -(l.fase + andado * PERIODO) * l.comprimento
        }
        ctx.stroke(l.forma)
      }
    }

    function animar(agora: number) {
      desenhar(agora / 1000)
      quadro = requestAnimationFrame(animar)
    }

    function recomecar() {
      cancelAnimationFrame(quadro)
      enquadrar()
      if (movimento.matches) desenhar(null)
      else quadro = requestAnimationFrame(animar)
    }

    recomecar()
    const observador = new ResizeObserver(recomecar)
    observador.observe(canvas)
    movimento.addEventListener('change', recomecar)

    return () => {
      cancelAnimationFrame(quadro)
      observador.disconnect()
      movimento.removeEventListener('change', recomecar)
    }
  }, [])

  return <canvas ref={tela} className={styles.fundo} aria-hidden="true" />
}
