'use client'

import { criarHalo, css, PALETA, rgb, type Tema } from './pintura'
import { useCenaEmCanvas, type Cena } from './useCenaEmCanvas'
import styles from './Fundo.module.css'

/**
 * Grade que floresce — NR-130.
 *
 * Uma grade que ondula sozinha, como tecido ao vento, com halos de luz em
 * alguns cruzamentos que pulsam devagar. O cursor soma uma distorcao a mais e
 * acende em amarelo os cruzamentos perto dele; quando sai, a grade volta so a
 * onda de base — a interacao e uma camada por cima, nunca uma troca.
 *
 * E o unico dos quatro fundos que nunca dorme enquanto esta na tela: a onda
 * e o efeito. Por isso mesmo depende do laco comum para parar fora da tela e
 * com a aba em segundo plano.
 *
 * ## Tema claro
 *
 * No escuro, os halos somam luz (`lighter`) e florescem. Sobre fundo claro
 * somar luz nao aparece; ali eles sao pintados por cima, mais fracos, e o
 * efeito le como mancha de cor suave em vez de brilho.
 */

export type GridBloomProps = {
  /** Distancia entre cruzamentos, em px. */
  espacamento?: number
  /** Velocidade da onda de base. */
  velocidade?: number
  /** Deslocamento maximo da onda de base, em px. */
  amplitude?: number
  /** Ate onde o cursor alcanca, em px. */
  raio?: number
  /** Deslocamento extra maximo perto do cursor, em px. */
  intensidadeCursor?: number
  /** Fracao dos cruzamentos com halo. */
  proporcaoBloom?: number
  /** Intensidade geral dos halos, de 0 a 1. */
  intensidadeBloom?: number
  tema?: Tema
  corLinha?: string
  coresBloom?: readonly [string, string]
  corRealce?: string
}

const PADRAO: Required<GridBloomProps> = {
  espacamento: 56,
  velocidade: 0.55,
  amplitude: 9,
  raio: 200,
  intensidadeCursor: 20,
  proporcaoBloom: 0.12,
  intensidadeBloom: 0.8,
  tema: 'escuro',
  corLinha: PALETA.azul,
  coresBloom: [PALETA.azul, PALETA.teal],
  corRealce: PALETA.amarelo,
}

type Vertice = {
  casaX: number
  casaY: number
  x: number
  y: number
  coluna: number
  linha: number
  /** Indice do halo em `halos`, ou -1 sem halo. */
  bloom: number
  forca: number
  fase: number
  periodo: number
  /** Proximidade do cursor, de 0 a 1 — so para o realce. */
  perto: number
}

function criarCena(o: Required<GridBloomProps>): Cena {
  const escuro = o.tema === 'escuro'
  const linha = rgb(o.corLinha)
  const halos = o.coresBloom.map((c) => criarHalo(rgb(c)))
  const haloRealce = criarHalo(rgb(o.corRealce))

  let vertices: Vertice[] = []
  let colunas = 0
  let linhas = 0
  /* O cursor suavizado: a distorcao entra e sai sem tranco, e quando o
     ponteiro some ela desvanece em vez de sumir. */
  const cursor = { x: 0, y: 0, presenca: 0 }

  function posicionar(t: number) {
    const seg = t / 1000
    for (const v of vertices) {
      /* Duas senoides com fases diferentes por linha e coluna: a onda anda
         pela grade sem se repetir igual em todo lugar ao mesmo tempo. */
      let x =
        v.casaX + Math.sin(seg * o.velocidade + v.linha * 0.45 + v.coluna * 0.15) * o.amplitude
      let y =
        v.casaY + Math.cos(seg * o.velocidade * 0.8 + v.coluna * 0.4 - v.linha * 0.12) * o.amplitude

      v.perto = 0
      if (cursor.presenca > 0.001) {
        const dx = cursor.x - x
        const dy = cursor.y - y
        const d = Math.hypot(dx, dy)
        if (d < o.raio && d > 0.001) {
          const f = (1 - d / o.raio) ** 2 * cursor.presenca
          const puxao = Math.min(d * 0.6, o.intensidadeCursor * f)
          x += (dx / d) * puxao
          y += (dy / d) * puxao
          v.perto = (1 - d / o.raio) * cursor.presenca
        }
      }
      v.x = x
      v.y = y
    }
  }

  function pintar(ctx: CanvasRenderingContext2D, t: number) {
    /* Linhas por pontos medios com curva: a onda le como tecido, e nao como
       arame quebrado nos cruzamentos. */
    ctx.beginPath()
    for (let l = 0; l < linhas; l++) {
      tracar(ctx, (i) => vertices[l * colunas + i]!, colunas)
    }
    for (let c = 0; c < colunas; c++) {
      tracar(ctx, (i) => vertices[i * colunas + c]!, linhas)
    }
    ctx.strokeStyle = css(linha, escuro ? 0.2 : 0.13)
    ctx.lineWidth = 1
    ctx.stroke()

    const seg = t / 1000
    ctx.globalCompositeOperation = escuro ? 'lighter' : 'source-over'
    for (const v of vertices) {
      if (v.bloom >= 0) {
        const pulso = 0.65 + 0.35 * Math.sin((seg / v.periodo) * Math.PI * 2 + v.fase)
        const intensidade = v.forca * pulso * o.intensidadeBloom * (escuro ? 0.9 : 0.4)
        const tamanho = 30 + 40 * v.forca * pulso
        ctx.globalAlpha = Math.min(1, intensidade + v.perto * 0.3)
        ctx.drawImage(halos[v.bloom]!, v.x - tamanho / 2, v.y - tamanho / 2, tamanho, tamanho)
      }
      if (v.perto > 0.05) {
        const tamanho = 18 + 46 * v.perto
        ctx.globalAlpha = Math.min(1, v.perto * (escuro ? 0.9 : 0.55))
        ctx.drawImage(haloRealce, v.x - tamanho / 2, v.y - tamanho / 2, tamanho, tamanho)
      }
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  return {
    redimensionar(largura, altura) {
      colunas = Math.ceil(largura / o.espacamento) + 3
      linhas = Math.ceil(altura / o.espacamento) + 3
      const inicioX = (largura - (colunas - 1) * o.espacamento) / 2
      const inicioY = (altura - (linhas - 1) * o.espacamento) / 2
      vertices = []
      for (let l = 0; l < linhas; l++) {
        for (let c = 0; c < colunas; c++) {
          const comHalo = Math.random() < o.proporcaoBloom
          vertices.push({
            casaX: inicioX + c * o.espacamento,
            casaY: inicioY + l * o.espacamento,
            x: 0,
            y: 0,
            coluna: c,
            linha: l,
            bloom: comHalo ? Math.floor(Math.random() * halos.length) : -1,
            forca: 0.35 + Math.random() * 0.65,
            fase: Math.random() * Math.PI * 2,
            periodo: 4 + Math.random() * 5,
            perto: 0,
          })
        }
      }
    },

    desenhar(ctx, agora, ponteiro) {
      const alvo = ponteiro.dentro ? 1 : 0
      cursor.presenca += (alvo - cursor.presenca) * 0.06
      if (ponteiro.dentro) {
        /* Entrando do zero, o cursor comeca onde o ponteiro esta — sem
           atravessar a secao vindo da posicao antiga. */
        const k = cursor.presenca < 0.08 ? 1 : 0.18
        cursor.x += (ponteiro.x - cursor.x) * k
        cursor.y += (ponteiro.y - cursor.y) * k
      }
      posicionar(agora)
      pintar(ctx, agora)
      return true
    },

    desenharParado(ctx) {
      cursor.presenca = 0
      posicionar(0)
      pintar(ctx, 0)
    },
  }
}

function tracar(ctx: CanvasRenderingContext2D, ponto: (i: number) => Vertice, total: number) {
  const primeiro = ponto(0)
  ctx.moveTo(primeiro.x, primeiro.y)
  for (let i = 1; i < total - 1; i++) {
    const atual = ponto(i)
    const proximo = ponto(i + 1)
    ctx.quadraticCurveTo(atual.x, atual.y, (atual.x + proximo.x) / 2, (atual.y + proximo.y) / 2)
  }
  const ultimo = ponto(total - 1)
  ctx.lineTo(ultimo.x, ultimo.y)
}

export default function GridBloomBackground(props: GridBloomProps) {
  const o = { ...PADRAO, ...props }
  const tela = useCenaEmCanvas(() => criarCena(o), JSON.stringify(o))
  return <canvas ref={tela} className={styles.tela} aria-hidden="true" />
}
