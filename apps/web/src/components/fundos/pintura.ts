/**
 * Cor e brilho compartilhados pelos fundos da landing — NR-130.
 *
 * O canvas nao le variavel CSS: as cores entram como hex e viram `rgba()` aqui.
 */

export type Rgb = readonly [number, number, number]

/** A paleta-base dos quatro fundos: variacoes de um mesmo sistema visual. */
export const PALETA = {
  azul: '#1e88e5',
  teal: '#26a69a',
  amarelo: '#f4c430',
  marinho: '#10143a',
  /** A grade neutra sobre fundo claro. */
  tinta: '#0f2a3a',
  branco: '#ffffff',
} as const

export function rgb(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function misturar(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t))
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

export function css([r, g, b]: Rgb, alfa = 1) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.max(0, Math.min(1, alfa))})`
}

/**
 * Um halo pronto, para carimbar com `drawImage`.
 *
 * Montar um `createRadialGradient` por ponto, a cada quadro, e o que mais
 * pesaria nestes fundos. O halo e desenhado uma vez num canvas pequeno e
 * reaproveitado; a intensidade de cada ponto vem do `globalAlpha`.
 */
export function criarHalo(cor: Rgb, tamanho = 64): HTMLCanvasElement {
  const halo = document.createElement('canvas')
  halo.width = tamanho
  halo.height = tamanho
  const ctx = halo.getContext('2d')
  if (!ctx) return halo
  const meio = tamanho / 2
  const gradiente = ctx.createRadialGradient(meio, meio, 0, meio, meio, meio)
  gradiente.addColorStop(0, css(cor, 1))
  gradiente.addColorStop(0.25, css(cor, 0.45))
  gradiente.addColorStop(1, css(cor, 0))
  ctx.fillStyle = gradiente
  ctx.fillRect(0, 0, tamanho, tamanho)
  return halo
}

export type Tema = 'claro' | 'escuro'
