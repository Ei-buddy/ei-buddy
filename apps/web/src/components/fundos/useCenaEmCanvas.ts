'use client'

import { useEffect, useRef } from 'react'

/**
 * O laco comum dos fundos interativos da landing — NR-130.
 *
 * Os quatro fundos (grade cinetica, constelacao, grade que pulsa e grade que
 * floresce) so diferem no que desenham. Tudo o que decide QUANDO desenhar mora
 * aqui, uma vez:
 *
 * - **Fora da tela, parado.** Um `IntersectionObserver` por canvas: quando a
 *   secao sai da viewport o laco nao agenda o proximo quadro. Nao e ficar
 *   invisivel calculando — e nao calcular. Com as secoes grandes da landing,
 *   em qualquer ponto da rolagem roda um fundo, dois na passagem de uma secao
 *   para a outra.
 * - **Aba em segundo plano, parado.** O navegador ja segura o
 *   `requestAnimationFrame`, mas o laco tambem para de se reagendar.
 * - **Nada a animar, dormindo.** A cena devolve se ainda ha movimento; se nao
 *   ha (a grade voltou ao repouso, a trilha apagou), o laco dorme ate o
 *   proximo evento de ponteiro. Um fundo que so reage ao cursor nao gasta
 *   nada enquanto ninguem mexe nele.
 * - **Movimento reduzido.** Um quadro parado, redesenhado so no
 *   redimensionamento. Sem ponteiro, sem laco.
 *
 * O canvas marca `data-rodando="sim"` enquanto o laco esta ativo — e o que o
 * teste de rolagem le para provar que so o fundo da secao visivel roda.
 *
 * ## O ponteiro vem da secao, e nao do canvas
 *
 * O canvas fica atras do conteudo com `pointer-events: none`, entao nunca
 * recebe evento — e nunca rouba clique de botao ou link. Quem escuta e o pai
 * dele (a secao), com ouvintes passivos: nada aqui chama `preventDefault`, a
 * rolagem por toque continua do navegador.
 */

export type Ponteiro = {
  /** Em px CSS, relativo ao canvas. */
  x: number
  y: number
  /** `false` quando o ponteiro saiu da secao ou o dedo levantou. */
  dentro: boolean
}

export type Cena = {
  /** A area mudou (e na montagem). Em px CSS. */
  redimensionar(largura: number, altura: number): void
  /**
   * Um quadro. `agora` em milissegundos.
   *
   * Devolve se ainda ha movimento a mostrar; `false` deixa o laco dormir ate o
   * proximo evento de ponteiro.
   */
  desenhar(ctx: CanvasRenderingContext2D, agora: number, ponteiro: Ponteiro): boolean
  /** O quadro de quem pediu menos movimento. */
  desenharParado(ctx: CanvasRenderingContext2D): void
  /** Clique ou toque, para as cenas que respondem a ele. */
  aoTocar?(x: number, y: number, agora: number): void
}

/**
 * Acima de 2x o custo de cada quadro cresce com o quadrado da densidade, e em
 * linhas finas e translucidas a diferenca nao aparece.
 */
const DENSIDADE_MAXIMA = 2

export function useCenaEmCanvas(criarCena: () => Cena, chave: string) {
  const tela = useRef<HTMLCanvasElement>(null)
  /* A fabrica muda de identidade a cada render; o que decide recriar a cena
     e a `chave` — as opcoes do componente serializadas. */
  const fabrica = useRef(criarCena)

  useEffect(() => {
    fabrica.current = criarCena
  })

  useEffect(() => {
    const canvas = tela.current
    const ctx = canvas?.getContext('2d')
    const secao = canvas?.parentElement
    if (!canvas || !ctx || !secao) return

    const cena = fabrica.current()
    const movimento = window.matchMedia('(prefers-reduced-motion: reduce)')
    const ponteiro: Ponteiro = { x: 0, y: 0, dentro: false }

    let largura = 0
    let altura = 0
    let visivel = false
    let quadro = 0
    let agendado = false

    function limpar() {
      if (!canvas || !ctx) return
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.restore()
    }

    function pausar() {
      cancelAnimationFrame(quadro)
      agendado = false
      canvas!.dataset.rodando = 'nao'
    }

    function passo(agora: number) {
      agendado = false
      if (!visivel || document.hidden || movimento.matches) return pausar()
      limpar()
      const continua = cena.desenhar(ctx!, agora, ponteiro)
      if (continua) {
        agendado = true
        quadro = requestAnimationFrame(passo)
      } else {
        canvas!.dataset.rodando = 'nao'
      }
    }

    function acordar() {
      if (agendado || !visivel || document.hidden || movimento.matches) return
      if (largura === 0 || altura === 0) return
      agendado = true
      canvas!.dataset.rodando = 'sim'
      quadro = requestAnimationFrame(passo)
    }

    function enquadrar() {
      if (!canvas || !ctx) return
      const densidade = Math.min(window.devicePixelRatio || 1, DENSIDADE_MAXIMA)
      const caixa = canvas.getBoundingClientRect()
      largura = caixa.width
      altura = caixa.height
      canvas.width = Math.round(largura * densidade)
      canvas.height = Math.round(altura * densidade)
      ctx.setTransform(densidade, 0, 0, densidade, 0, 0)
      cena.redimensionar(largura, altura)

      if (movimento.matches) {
        pausar()
        limpar()
        cena.desenharParado(ctx)
      } else {
        /* Mudar `width` apaga o canvas: o quadro seguinte redesenha. */
        acordar()
      }
    }

    /* --- Ponteiro --- */

    function posicionar(clientX: number, clientY: number) {
      const caixa = canvas!.getBoundingClientRect()
      ponteiro.x = clientX - caixa.left
      ponteiro.y = clientY - caixa.top
      ponteiro.dentro = true
    }

    function aoMover(e: PointerEvent) {
      /* Toque chega por `touchmove`: o `pointermove` do dedo e cancelado
         assim que a rolagem comeca. */
      if (e.pointerType === 'touch') return
      posicionar(e.clientX, e.clientY)
      acordar()
    }

    function aoSair(e: PointerEvent) {
      if (e.pointerType === 'touch') return
      ponteiro.dentro = false
      acordar()
    }

    function aoPressionar(e: PointerEvent) {
      if (!cena.aoTocar || movimento.matches) return
      posicionar(e.clientX, e.clientY)
      if (e.pointerType === 'touch') ponteiro.dentro = false
      cena.aoTocar(ponteiro.x, ponteiro.y, performance.now())
      acordar()
    }

    function aoArrastarDedo(e: TouchEvent) {
      const dedo = e.touches[0]
      if (!dedo) return
      posicionar(dedo.clientX, dedo.clientY)
      acordar()
    }

    function aoSoltarDedo() {
      ponteiro.dentro = false
      acordar()
    }

    /* --- Visibilidade --- */

    const observadorDeTela = new IntersectionObserver(([entrada]) => {
      visivel = entrada?.isIntersecting ?? false
      if (visivel) acordar()
      else pausar()
    })

    function aoTrocarDeAba() {
      if (document.hidden) pausar()
      else acordar()
    }

    function aoMudarPreferencia() {
      enquadrar()
    }

    const observadorDeTamanho = new ResizeObserver(enquadrar)

    canvas.dataset.rodando = 'nao'
    enquadrar()
    observadorDeTamanho.observe(canvas)
    observadorDeTela.observe(canvas)
    document.addEventListener('visibilitychange', aoTrocarDeAba)
    movimento.addEventListener('change', aoMudarPreferencia)
    secao.addEventListener('pointermove', aoMover, { passive: true })
    secao.addEventListener('pointerleave', aoSair, { passive: true })
    secao.addEventListener('pointerdown', aoPressionar, { passive: true })
    secao.addEventListener('touchstart', aoArrastarDedo, { passive: true })
    secao.addEventListener('touchmove', aoArrastarDedo, { passive: true })
    secao.addEventListener('touchend', aoSoltarDedo, { passive: true })
    secao.addEventListener('touchcancel', aoSoltarDedo, { passive: true })

    return () => {
      pausar()
      observadorDeTamanho.disconnect()
      observadorDeTela.disconnect()
      document.removeEventListener('visibilitychange', aoTrocarDeAba)
      movimento.removeEventListener('change', aoMudarPreferencia)
      secao.removeEventListener('pointermove', aoMover)
      secao.removeEventListener('pointerleave', aoSair)
      secao.removeEventListener('pointerdown', aoPressionar)
      secao.removeEventListener('touchstart', aoArrastarDedo)
      secao.removeEventListener('touchmove', aoArrastarDedo)
      secao.removeEventListener('touchend', aoSoltarDedo)
      secao.removeEventListener('touchcancel', aoSoltarDedo)
    }
  }, [chave])

  return tela
}
