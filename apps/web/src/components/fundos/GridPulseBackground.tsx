'use client'

import { css, misturar, PALETA, rgb, type Rgb, type Tema } from './pintura'
import { useCenaEmCanvas, type Cena, type Ponteiro } from './useCenaEmCanvas'
import styles from './Fundo.module.css'

/**
 * Grade que pulsa — NR-130.
 *
 * Uma grade quase invisivel. Cada celula por onde o cursor passa acende e
 * vai se apagando: a mais nova em amarelo, passando pelo azul, ate o teal
 * antes de sumir. O conjunto vira uma trilha que segue o ponteiro.
 *
 * Sem celula acesa, o laco dorme: a grade de base fica desenhada e nada roda
 * ate o proximo movimento.
 *
 * ## A trilha nao tem buraco
 *
 * Um movimento rapido anda varias celulas entre dois quadros. Marcar so a
 * celula de cada quadro deixaria a trilha pontilhada; aqui o caminho entre a
 * posicao anterior e a atual e percorrido em passos de meia celula, e todas
 * as celulas dele acendem.
 */

export type GridPulseProps = {
  /** Lado de cada celula, em px. */
  celula?: number
  /** Tempo ate uma celula acesa sumir, em ms. */
  duracao?: number
  /** Opacidade das linhas da grade em repouso. */
  opacidadeGrade?: number
  /** Opacidade maxima de uma celula acesa. */
  opacidadeTrilha?: number
  tema?: Tema
  /** Da mais antiga para a mais nova. */
  cores?: readonly [string, string, string]
}

const PADRAO: Required<GridPulseProps> = {
  celula: 44,
  duracao: 1200,
  opacidadeGrade: 0.05,
  opacidadeTrilha: 0.85,
  tema: 'escuro',
  cores: [PALETA.teal, PALETA.azul, PALETA.amarelo],
}

/**
 * Teto de celulas acesas ao mesmo tempo.
 *
 * Com a duracao padrao, uma trilha comum fica bem abaixo disto; o teto so
 * existe para um arrasto frenetico numa tela enorme nao crescer o trabalho
 * por quadro sem limite. As mais antigas saem primeiro.
 */
const MAXIMO_ACESAS = 260

function criarCena(o: Required<GridPulseProps>): Cena {
  const [antiga, meio, nova] = o.cores.map(rgb) as [Rgb, Rgb, Rgb]
  const tinta = rgb(o.tema === 'claro' ? PALETA.tinta : PALETA.branco)

  /* Chave numerica, e nao "col,row": sem string nova a cada movimento. */
  const acesas = new Map<number, number>()
  let largura = 0
  let altura = 0
  let anterior: { x: number; y: number } | null = null

  function chave(coluna: number, linha: number) {
    return linha * 100000 + coluna
  }

  function acender(x: number, y: number, agora: number) {
    if (x < 0 || y < 0 || x > largura || y > altura) return
    const k = chave(Math.floor(x / o.celula), Math.floor(y / o.celula))
    /* Reacender poe a celula no fim da ordem de insercao: o `Map` fica
       sempre da mais antiga para a mais nova. */
    acesas.delete(k)
    acesas.set(k, agora)
    if (acesas.size > MAXIMO_ACESAS) {
      const primeira = acesas.keys().next().value
      if (primeira !== undefined) acesas.delete(primeira)
    }
  }

  function seguir(ponteiro: Ponteiro, agora: number) {
    if (!ponteiro.dentro) {
      anterior = null
      return
    }
    if (anterior) {
      const dx = ponteiro.x - anterior.x
      const dy = ponteiro.y - anterior.y
      const passos = Math.ceil(Math.hypot(dx, dy) / (o.celula / 2))
      for (let i = 1; i <= passos; i++) {
        acender(anterior.x + (dx * i) / passos, anterior.y + (dy * i) / passos, agora)
      }
    }
    acender(ponteiro.x, ponteiro.y, agora)
    anterior = { x: ponteiro.x, y: ponteiro.y }
  }

  function grade(ctx: CanvasRenderingContext2D) {
    ctx.beginPath()
    for (let x = 0; x <= largura; x += o.celula) {
      ctx.moveTo(x + 0.5, 0)
      ctx.lineTo(x + 0.5, altura)
    }
    for (let y = 0; y <= altura; y += o.celula) {
      ctx.moveTo(0, y + 0.5)
      ctx.lineTo(largura, y + 0.5)
    }
    ctx.strokeStyle = css(tinta, o.opacidadeGrade)
    ctx.lineWidth = 1
    ctx.stroke()
  }

  return {
    redimensionar(l, a) {
      largura = l
      altura = a
      acesas.clear()
      anterior = null
    },

    desenhar(ctx, agora, ponteiro) {
      seguir(ponteiro, agora)
      grade(ctx)

      for (const [k, aceso] of acesas) {
        const idade = (agora - aceso) / o.duracao
        if (idade >= 1) {
          acesas.delete(k)
          continue
        }
        /* Amarelo -> azul na primeira metade da vida, azul -> teal na segunda. */
        const cor =
          idade < 0.5 ? misturar(nova, meio, idade * 2) : misturar(meio, antiga, idade * 2 - 1)
        ctx.fillStyle = css(cor, (1 - idade) ** 1.3 * o.opacidadeTrilha)
        const coluna = k % 100000
        const linha = Math.floor(k / 100000)
        ctx.fillRect(coluna * o.celula + 1, linha * o.celula + 1, o.celula - 1, o.celula - 1)
      }

      return acesas.size > 0
    },

    desenharParado(ctx) {
      acesas.clear()
      grade(ctx)
    },
  }
}

export default function GridPulseBackground(props: GridPulseProps) {
  const o = { ...PADRAO, ...props }
  const tela = useCenaEmCanvas(() => criarCena(o), JSON.stringify(o))
  return <canvas ref={tela} className={styles.tela} aria-hidden="true" />
}
