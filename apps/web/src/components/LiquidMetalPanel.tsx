'use client'

import dynamic from 'next/dynamic'
import { useSyncExternalStore } from 'react'
import styles from './LiquidMetalPanel.module.css'

/**
 * O painel "liquid metal" do hero — NR-123, so visual.
 *
 * ## Por que um bloco contido, e nao o fundo da pagina
 *
 * O efeito original cobre a tela inteira e e escuro. A landing do EiBuddy e
 * clara de proposito: quem chega precisa LER. Entao o shader vive dentro de
 * um retangulo arredondado com `overflow: hidden`, atras do mockup do
 * produto — decoracao, nunca superficie de texto. Nenhuma letra desta pagina
 * fica sobre ele, e por isso ele nao entra na conta de contraste (RNF-055).
 *
 * ## Por que as cores novas ficam SO aqui
 *
 * O azul vivo, o verde-agua e o amarelo sao pigmento deste bloco. Nao viram
 * token de marca porque `packages/ui` alimenta tambem o app logado e o app
 * mobile, e porque, como TEXTO sobre branco, os tres reprovam o piso AA
 * (3.68:1, 3.00:1 e 1.64:1 contra o minimo de 4.5:1). Dentro do shader nao
 * ha texto, entao eles cumprem o papel de cor sem custar legibilidade.
 *
 * ## Tres camadas, e cada uma existe por um motivo
 *
 * 1. O gradiente CSS embaixo aparece SEMPRE: e o que se ve enquanto o shader
 *    carrega, e o que fica para sempre em quem nao tem WebGL. Sem ele, o
 *    hero abriria com um buraco cinza.
 * 2. O shader entra por cima, em import dinamico — os ~100 kB dele nao
 *    seguram a primeira pintura da pagina.
 * 3. O veu claro por cima de tudo amarra o bloco ao resto da pagina, que e
 *    branca, e impede que o metal fique pesado demais ao lado do texto.
 */

/* `ssr: false` porque o shader monta um canvas WebGL: no servidor nao ha o
   que desenhar, e renderiza-lo duas vezes so acrescentaria um flash. */
const LiquidMetal = dynamic(
  () => import('@paper-design/shaders-react').then((m) => m.LiquidMetal),
  { ssr: false },
)

/** Azul vivo da marca — o fundo do metal. */
const AZUL = '#1e88e5'
/** Verde-agua, o brilho que corre por cima das ondas. */
const TEAL = '#7fe3d8'

/**
 * `prefers-reduced-motion` de verdade, e nao so no CSS.
 *
 * Uma animacao de WebGL nao para com `@media`: o canvas continua desenhando
 * quadro a quadro. Para respeitar a preferencia e preciso zerar a velocidade
 * do proprio shader.
 *
 * `useSyncExternalStore`, e nao `useEffect` + `setState` — mesma razao de
 * `AvisoDeCookies`: `matchMedia` e uma fonte EXTERNA ao React, e ler no
 * efeito para so entao chamar `setState` joga fora um render inteiro a cada
 * abertura da pagina (o lint do repo reprova, com razao).
 *
 * Prefixo `use` em ingles como `useSubscription`: a regra de hooks so
 * reconhece hook por esse prefixo.
 */
const CONSULTA = '(prefers-reduced-motion: reduce)'

function assinarMovimento(aoMudar: () => void): () => void {
  const consulta = window.matchMedia(CONSULTA)
  consulta.addEventListener('change', aoMudar)
  return () => consulta.removeEventListener('change', aoMudar)
}

const noCliente = (): boolean => window.matchMedia(CONSULTA).matches

/* No servidor nao ha `matchMedia`. `false` e o palpite certo: o shader ja
   comeca animando e, se a pessoa pedir menos movimento, a primeira leitura no
   cliente congela — o contrario faria o efeito nascer parado para todo mundo. */
const noServidor = (): boolean => false

function useMenosMovimento(): boolean {
  return useSyncExternalStore(assinarMovimento, noCliente, noServidor)
}

export default function LiquidMetalPanel() {
  const menosMovimento = useMenosMovimento()

  return (
    <div className={styles.painel} aria-hidden="true">
      <div className={styles.base} />

      <LiquidMetal
        className={styles.shader}
        colorBack={AZUL}
        colorTint={TEAL}
        /*
         * `none` preenche o retangulo inteiro, e nao uma gota no meio.
         *
         * As formas fechadas (`metaballs`, `circle`) desenham o metal no
         * CENTRO — exatamente onde o cartao do mockup fica por cima. O efeito
         * sumia atras dele e sobrava so a cor de fundo. Preenchendo tudo, o
         * que aparece em volta do cartao ja e metal.
         */
        shape="none"
        /*
         * Zerar a velocidade congela a imagem (o proprio shader para o loop),
         * e o `frame` fixo garante que ainda haja UM quadro desenhado: sem
         * ele, quem pede menos movimento veria o bloco vazio em vez de uma
         * imagem parada.
         */
        speed={menosMovimento ? 0 : 0.5}
        frame={menosMovimento ? 9000 : 0}
        scale={1}
        repetition={1.7}
        /*
         * Transicoes macias e dispersao baixa.
         *
         * Com listras duras e muita separacao de canal, o metal ganhava franja
         * colorida bem na borda do cartao do mockup — bonito isolado, ruido ao
         * lado de um texto que a pessoa precisa ler.
         */
        softness={0.5}
        distortion={0.2}
        contour={0.32}
        shiftRed={0.1}
        shiftBlue={0.14}
        angle={60}
        /*
         * Teto de pixels, e nao resolucao nativa.
         *
         * O publico abre isto majoritariamente de celular Android de entrada,
         * onde um canvas em `devicePixelRatio` 3 custa nove vezes mais
         * fragmento por quadro. O shader e desfocado por natureza: a perda de
         * nitidez nao aparece, e a conta de bateria some.
         */
        maxPixelCount={1_200_000}
        minPixelRatio={1}
      />

      <div className={styles.veu} />
    </div>
  )
}
