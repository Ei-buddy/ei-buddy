import { alternarTemaDoPainel, lerTemaDoPainel } from './tema-painel'

/**
 * A troca de tema como mudanca de luz no ambiente — NR-134.
 *
 * O tema nao troca de uma vez: uma circunferencia cresce a partir do ponto
 * onde a pessoa tocou e varre a tela. Dentro dela ja e o tema novo, fora ainda
 * e o antigo — a luz acendendo num comodo, e nao um corte para outra cena.
 *
 * ## Quem faz o recorte
 *
 * A View Transitions API do navegador. Ela tira uma foto da tela antes da
 * troca, deixa o codigo trocar, tira outra depois, e entrega as duas como
 * pseudo-elementos que dao para animar. O recorte circular e uma animacao de
 * `clip-path` na foto NOVA — sem ela, seria preciso duplicar a arvore inteira
 * do painel em dois temas ao mesmo tempo, que e caro e nunca fica exato.
 *
 * O CSS que desliga o esmaecer padrao das duas fotos esta em `globals.css`,
 * junto do resto que fala com o documento inteiro.
 *
 * ## Quando ela nao existe
 *
 * Firefox ainda nao tem (e navegador velho tambem nao). Ali a troca acontece
 * atras de um veu da cor do tema que esta saindo, que se dissipa em 250ms: sem
 * o recorte, mas sem o estalo de trocar tudo de uma vez.
 *
 * ## Movimento reduzido
 *
 * Troca direta, sem nada. Um circulo varrendo a tela inteira e exatamente o
 * tipo de movimento grande que essa preferencia pede para nao acontecer.
 */

/** Ida e volta do circulo, em ms. */
const DURACAO = 500
/** Peso fisico: acelera no comeco, desacelera no fim. */
const CURVA = 'cubic-bezier(0.65, 0, 0.35, 1)'
/** O rastro de luz que fica depois que o circulo cobre a tela, em ms. */
const RASTRO = 150
/** O veu do navegador sem View Transitions, em ms. */
const VEU = 250

type DocumentoComTransicao = Document & {
  startViewTransition?: (callback: () => void) => { ready: Promise<void> }
}

export type Origem = { x: number; y: number }

/** A distancia do ponto ate o canto mais longe — o raio que cobre a tela. */
function raioAtePontaMaisLonge({ x, y }: Origem) {
  return Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
}

/**
 * O resto de luz que fica no ponto de origem.
 *
 * Azul entrando no escuro, branco entrando no claro: em cada caso e a cor que
 * o ambiente acabou de ganhar, e nao a que ele perdeu.
 */
function deixarRastro({ x, y }: Origem, tema: 'claro' | 'escuro') {
  const brilho = document.createElement('div')
  const cor = tema === 'escuro' ? 'rgba(80,150,255,0.5)' : 'rgba(255,255,255,0.75)'
  brilho.setAttribute('aria-hidden', 'true')
  brilho.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:420px;height:420px;margin:-210px 0 0 -210px;border-radius:50%;pointer-events:none;z-index:300;background:radial-gradient(closest-side, ${cor}, transparent)`
  document.body.appendChild(brilho)

  const animacao = brilho.animate(
    { opacity: [0.9, 0], transform: ['scale(0.6)', 'scale(1.6)'] },
    { duration: RASTRO * 2, easing: 'ease-out' },
  )
  animacao.finished.finally(() => brilho.remove())
}

/** O veu de quem nao tem View Transitions: a cor que sai, dissolvendo. */
function trocarComVeu() {
  const veu = document.createElement('div')
  const corAtual = getComputedStyle(document.body).backgroundColor
  veu.setAttribute('aria-hidden', 'true')
  veu.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:300;background:${corAtual}`
  document.body.appendChild(veu)

  alternarTemaDoPainel()

  const animacao = veu.animate({ opacity: [1, 0] }, { duration: VEU, easing: 'ease-out' })
  animacao.finished.finally(() => veu.remove())
}

/**
 * Troca o tema a partir de um ponto da tela.
 *
 * `origem` e onde o circulo nasce. Sem ela — um atalho de teclado, por
 * exemplo, que nao tem coordenada nenhuma — a luz vem do centro da tela.
 */
export async function trocarTemaDoPainel(origem: Origem | null): Promise<void> {
  const documento = document as DocumentoComTransicao
  const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (semMovimento) return alternarTemaDoPainel()
  if (typeof documento.startViewTransition !== 'function') return trocarComVeu()

  const ponto = origem ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  const transicao = documento.startViewTransition(alternarTemaDoPainel)

  await transicao.ready

  const raio = raioAtePontaMaisLonge(ponto)
  const circulo = document.documentElement.animate(
    {
      clipPath: [
        `circle(0px at ${ponto.x}px ${ponto.y}px)`,
        `circle(${raio}px at ${ponto.x}px ${ponto.y}px)`,
      ],
    },
    {
      duration: DURACAO,
      easing: CURVA,
      /* A foto NOVA e a que abre; a antiga fica parada por baixo. */
      pseudoElement: '::view-transition-new(root)',
    },
  )

  await circulo.finished
  deixarRastro(ponto, lerTemaDoPainel())
}
