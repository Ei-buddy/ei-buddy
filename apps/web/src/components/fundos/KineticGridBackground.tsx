'use client'

import { css, misturar, PALETA, rgb, type Tema } from './pintura'
import { useCenaEmCanvas, type Cena } from './useCenaEmCanvas'
import styles from './Fundo.module.css'

/**
 * Grade cinetica — NR-130.
 *
 * Uma malha de linhas com um ponto em cada cruzamento. Perto do cursor ela e
 * puxada na direcao dele e ganha cor (azul no centro, teal na borda do raio);
 * um clique solta uma onda que empurra os pontos e se apaga.
 *
 * Fica parada quando ninguem mexe: assim que os pontos voltam ao lugar e a
 * onda some, o laco dorme ate o proximo movimento do ponteiro.
 */

export type KineticGridProps = {
  /** Distancia entre cruzamentos, em px. */
  espacamento?: number
  /** Ate onde o cursor alcanca, em px. */
  raio?: number
  /** Deslocamento maximo de um ponto, em px. */
  intensidade?: number
  tema?: Tema
  /** Realce perto do cursor, do centro para a borda do raio. */
  corCentro?: string
  corBorda?: string
}

const PADRAO: Required<KineticGridProps> = {
  espacamento: 38,
  raio: 170,
  intensidade: 16,
  tema: 'claro',
  corCentro: PALETA.azul,
  corBorda: PALETA.teal,
}

/** Uma onda de clique dura isto, em ms. */
const VIDA_DA_ONDA = 1600
/** Velocidade da frente de onda, em px por segundo. */
const VELOCIDADE_DA_ONDA = 520
/** Espessura da frente de onda, em px. */
const LARGURA_DA_ONDA = 60
/** Suavizacao do caminho ate o alvo: 1 salta, perto de 0 nunca chega. */
const SUAVIDADE = 0.14

type Ponto = { casaX: number; casaY: number; x: number; y: number; realce: number }
type Onda = { x: number; y: number; inicio: number }

function criarCena(o: Required<KineticGridProps>): Cena {
  const centro = rgb(o.corCentro)
  const borda = rgb(o.corBorda)
  const neutra = rgb(o.tema === 'claro' ? PALETA.tinta : PALETA.branco)
  const alfaLinha = o.tema === 'claro' ? 0.08 : 0.06
  const alfaPonto = o.tema === 'claro' ? 0.15 : 0.14

  let pontos: Ponto[] = []
  let colunas = 0
  let linhas = 0
  const ondas: Onda[] = []

  function malha(ctx: CanvasRenderingContext2D) {
    /* A malha neutra inteira num caminho so: um `stroke` por quadro. */
    ctx.beginPath()
    for (let l = 0; l < linhas; l++) {
      for (let c = 0; c < colunas; c++) {
        const p = pontos[l * colunas + c]!
        if (c === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
    }
    for (let c = 0; c < colunas; c++) {
      for (let l = 0; l < linhas; l++) {
        const p = pontos[l * colunas + c]!
        if (l === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
    }
    ctx.strokeStyle = css(neutra, alfaLinha)
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.beginPath()
    for (const p of pontos) ctx.rect(p.x - 1, p.y - 1, 2, 2)
    ctx.fillStyle = css(neutra, alfaPonto)
    ctx.fill()
  }

  return {
    redimensionar(largura, altura) {
      /* Uma casa de sobra em cada borda: puxados, os pontos da beira nao
         deixam a malha descolar do limite da secao. */
      colunas = Math.ceil(largura / o.espacamento) + 3
      linhas = Math.ceil(altura / o.espacamento) + 3
      const inicioX = (largura - (colunas - 1) * o.espacamento) / 2
      const inicioY = (altura - (linhas - 1) * o.espacamento) / 2
      pontos = []
      for (let l = 0; l < linhas; l++) {
        for (let c = 0; c < colunas; c++) {
          const x = inicioX + c * o.espacamento
          const y = inicioY + l * o.espacamento
          pontos.push({ casaX: x, casaY: y, x, y, realce: 0 })
        }
      }
    },

    aoTocar(x, y, agora) {
      ondas.push({ x, y, inicio: agora })
      /* Clique em rajada nao acumula trabalho: bastam as tres ultimas. */
      if (ondas.length > 3) ondas.shift()
    },

    desenhar(ctx, agora, ponteiro) {
      while (ondas.length > 0 && agora - ondas[0]!.inicio > VIDA_DA_ONDA) ondas.shift()

      let emMovimento = ondas.length > 0
      for (const p of pontos) {
        let alvoX = p.casaX
        let alvoY = p.casaY
        let realce = 0

        if (ponteiro.dentro) {
          const dx = ponteiro.x - p.casaX
          const dy = ponteiro.y - p.casaY
          const d = Math.hypot(dx, dy)
          if (d < o.raio && d > 0.001) {
            /* Queda suave: forte no centro, zero na borda, sem degrau. */
            const f = (1 - d / o.raio) ** 2
            const puxao = Math.min(d, o.intensidade * f)
            alvoX += (dx / d) * puxao
            alvoY += (dy / d) * puxao
            realce = Math.max(realce, 1 - d / o.raio)
          }
        }

        for (const onda of ondas) {
          const idade = (agora - onda.inicio) / 1000
          const dx = p.casaX - onda.x
          const dy = p.casaY - onda.y
          const d = Math.hypot(dx, dy)
          const frente = d - idade * VELOCIDADE_DA_ONDA
          if (Math.abs(frente) < LARGURA_DA_ONDA && d > 0.001) {
            const forca = Math.cos((frente / LARGURA_DA_ONDA) * (Math.PI / 2))
            const amortecida = forca * Math.exp(-idade * 2.2)
            alvoX += (dx / d) * o.intensidade * 1.1 * amortecida
            alvoY += (dy / d) * o.intensidade * 1.1 * amortecida
            realce = Math.max(realce, amortecida)
          }
        }

        p.x += (alvoX - p.x) * SUAVIDADE
        p.y += (alvoY - p.y) * SUAVIDADE
        p.realce += (realce - p.realce) * SUAVIDADE
        if (
          Math.abs(alvoX - p.x) > 0.05 ||
          Math.abs(alvoY - p.y) > 0.05 ||
          Math.abs(realce - p.realce) > 0.01
        ) {
          emMovimento = true
        }
      }

      malha(ctx)

      /* O realce por cima, so nos pontos que o tem. */
      ctx.lineWidth = 1.2
      for (let l = 0; l < linhas; l++) {
        for (let c = 0; c < colunas; c++) {
          const p = pontos[l * colunas + c]!
          if (p.realce < 0.03) continue
          const cor = misturar(borda, centro, p.realce * 1.4)
          const direita = c + 1 < colunas ? pontos[l * colunas + c + 1] : undefined
          const baixo = l + 1 < linhas ? pontos[(l + 1) * colunas + c] : undefined
          ctx.strokeStyle = css(cor, p.realce * 0.55)
          ctx.beginPath()
          if (direita) {
            ctx.moveTo(p.x, p.y)
            ctx.lineTo(direita.x, direita.y)
          }
          if (baixo) {
            ctx.moveTo(p.x, p.y)
            ctx.lineTo(baixo.x, baixo.y)
          }
          ctx.stroke()
          ctx.fillStyle = css(cor, Math.min(1, p.realce * 1.1))
          const r = 1.2 + p.realce * 1.8
          ctx.beginPath()
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      return emMovimento
    },

    desenharParado(ctx) {
      for (const p of pontos) {
        p.x = p.casaX
        p.y = p.casaY
        p.realce = 0
      }
      malha(ctx)
    },
  }
}

export default function KineticGridBackground(props: KineticGridProps) {
  const o = { ...PADRAO, ...props }
  const tela = useCenaEmCanvas(() => criarCena(o), JSON.stringify(o))
  return <canvas ref={tela} className={styles.tela} aria-hidden="true" />
}
