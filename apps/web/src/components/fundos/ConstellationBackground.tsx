'use client'

import { criarHalo, css, PALETA, rgb, type Tema } from './pintura'
import { useCenaEmCanvas, type Cena } from './useCenaEmCanvas'
import styles from './Fundo.module.css'

/**
 * Constelacao — NR-130.
 *
 * Pontos espalhados de forma organica, ligados por linha quando ficam perto um
 * do outro. O cursor atrai os que estao ao alcance; juntos, eles ficam perto
 * entre si tambem, e as ligacoes se multiplicam sozinhas — e dai que sai o
 * miolo denso. Longe do cursor, cada ponto volta para a sua casa.
 *
 * ## Por que nunca colapsa no cursor
 *
 * A atracao leva cada ponto so ate uma fracao do caminho, maior quanto mais
 * perto ele ja esta; e pontos colados demais se empurram. Sem as duas coisas,
 * todos virariam um ponto so debaixo do ponteiro.
 *
 * ## Deriva
 *
 * Cada ponto oscila uns pixels em volta da casa, devagar. E o que deixa o
 * fundo vivo sem ninguem mexer — e por isso este laco nao dorme enquanto a
 * secao esta na tela. Fora dela, para como os outros.
 */

export type ConstellationProps = {
  /** Quantos pontos. Sem valor, sai da area: ~1 a cada 16.000 px², de 30 a 80. */
  quantos?: number
  /** Distancia maxima para dois pontos se ligarem, em px. */
  raioConexao?: number
  /** Ate onde o cursor atrai, em px. */
  raioInfluencia?: number
  /** Fracao do caminho ate o alvo percorrida por quadro. */
  atracao?: number
  tema?: Tema
  /** Cor unica de pontos e linhas: o realce e de intensidade, nao de matiz. */
  cor?: string
}

const PADRAO: Required<ConstellationProps> = {
  quantos: 0,
  raioConexao: 128,
  raioInfluencia: 230,
  atracao: 0.06,
  tema: 'escuro',
  cor: '',
}

/** Abaixo desta distancia dois pontos se empurram, em px. */
const ESPACO_PESSOAL = 16
/** Amplitude da deriva de cada ponto, em px. */
const DERIVA = 7

type No = {
  casaX: number
  casaY: number
  x: number
  y: number
  /** Proximidade do cursor, suavizada, de 0 a 1. */
  realce: number
  fase: number
  ritmo: number
}

function criarCena(o: Required<ConstellationProps>): Cena {
  const cor = rgb(o.cor || (o.tema === 'escuro' ? PALETA.amarelo : PALETA.azul))
  const halo = criarHalo(cor)
  const escuro = o.tema === 'escuro'
  const alfaLinha = escuro ? 0.25 : 0.2
  const alfaNo = escuro ? 0.6 : 0.45

  let nos: No[] = []

  function espalhar(largura: number, altura: number) {
    const total =
      o.quantos > 0 ? o.quantos : Math.round(Math.max(30, Math.min(80, (largura * altura) / 16000)))
    nos = []
    for (let i = 0; i < total; i++) {
      /* Um em cada tres nasce perto de um anterior: sai o agrupamento
         organico da referencia, e nao uma chuva uniforme. */
      const vizinho = i > 0 && Math.random() < 0.33 ? nos[Math.floor(Math.random() * i)] : undefined
      const x = vizinho ? vizinho.casaX + (Math.random() - 0.5) * 110 : Math.random() * largura
      const y = vizinho ? vizinho.casaY + (Math.random() - 0.5) * 110 : Math.random() * altura
      const casaX = Math.max(8, Math.min(largura - 8, x))
      const casaY = Math.max(8, Math.min(altura - 8, y))
      nos.push({
        casaX,
        casaY,
        x: casaX,
        y: casaY,
        realce: 0,
        fase: Math.random() * Math.PI * 2,
        ritmo: 0.00018 + Math.random() * 0.00022,
      })
    }
  }

  function pintar(ctx: CanvasRenderingContext2D) {
    const limite = o.raioConexao * o.raioConexao
    ctx.lineWidth = 1
    for (let i = 0; i < nos.length; i++) {
      const a = nos[i]!
      for (let j = i + 1; j < nos.length; j++) {
        const b = nos[j]!
        const dx = a.x - b.x
        const dy = a.y - b.y
        const d2 = dx * dx + dy * dy
        if (d2 > limite) continue
        const perto = 1 - Math.sqrt(d2) / o.raioConexao
        const brilho = 1 + 2.2 * Math.max(a.realce, b.realce)
        ctx.strokeStyle = css(cor, perto * alfaLinha * brilho)
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
    }

    for (const n of nos) {
      const tamanho = 14 + n.realce * 26
      ctx.globalAlpha = (escuro ? 0.22 : 0.14) + n.realce * 0.5
      ctx.drawImage(halo, n.x - tamanho / 2, n.y - tamanho / 2, tamanho, tamanho)
      ctx.globalAlpha = 1
      ctx.fillStyle = css(cor, alfaNo + n.realce * (1 - alfaNo))
      ctx.beginPath()
      ctx.arc(n.x, n.y, 1.6 + n.realce * 1.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  return {
    redimensionar(largura, altura) {
      espalhar(largura, altura)
    },

    desenhar(ctx, agora, ponteiro) {
      for (const n of nos) {
        const derivaX = n.casaX + Math.sin(agora * n.ritmo + n.fase) * DERIVA
        const derivaY = n.casaY + Math.cos(agora * n.ritmo * 0.8 + n.fase) * DERIVA

        let proximidade = 0
        if (ponteiro.dentro) {
          const d = Math.hypot(ponteiro.x - n.x, ponteiro.y - n.y)
          if (d < o.raioInfluencia) proximidade = 1 - d / o.raioInfluencia
        }

        if (proximidade > 0) {
          /* So parte do caminho: quanto mais perto, mais fundo no miolo. */
          const fracao = 0.35 + 0.5 * proximidade
          const alvoX = derivaX + (ponteiro.x - derivaX) * fracao
          const alvoY = derivaY + (ponteiro.y - derivaY) * fracao
          n.x += (alvoX - n.x) * o.atracao
          n.y += (alvoY - n.y) * o.atracao
        } else {
          n.x += (derivaX - n.x) * 0.02
          n.y += (derivaY - n.y) * 0.02
        }
        n.realce += (proximidade - n.realce) * 0.08
      }

      for (let i = 0; i < nos.length; i++) {
        const a = nos[i]!
        for (let j = i + 1; j < nos.length; j++) {
          const b = nos[j]!
          const dx = a.x - b.x
          const dy = a.y - b.y
          const d = Math.hypot(dx, dy)
          if (d >= ESPACO_PESSOAL || d < 0.001) continue
          const empurrao = ((ESPACO_PESSOAL - d) / d) * 0.25
          a.x += dx * empurrao
          a.y += dy * empurrao
          b.x -= dx * empurrao
          b.y -= dy * empurrao
        }
      }

      pintar(ctx)
      return true
    },

    desenharParado(ctx) {
      for (const n of nos) {
        n.x = n.casaX
        n.y = n.casaY
        n.realce = 0
      }
      pintar(ctx)
    },
  }
}

export default function ConstellationBackground(props: ConstellationProps) {
  const o = { ...PADRAO, ...props }
  const tela = useCenaEmCanvas(() => criarCena(o), JSON.stringify(o))
  return <canvas ref={tela} className={styles.tela} aria-hidden="true" />
}
