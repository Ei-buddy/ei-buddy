/**
 * Adaptador dos tokens compartilhados para o vocabulario deste app.
 *
 * A fonte de verdade e `@na-regua/ui` (NR-011). Este arquivo existe por tres
 * motivos:
 *
 * 1. `cores` achata a paleta do tema + `brand` num objeto so — em vez de
 *    espalhar `dark.feedback.danger` por 25 arquivos.
 * 2. Os nomes em portugues sao ponte, nao escolha. O code-style do repo pede
 *    identificador em ingles; renomear as 667 ocorrencias vira um diff mecanico
 *    que enterraria a revisao. Fica como tarefa propria.
 * 3. Desde a NR-167 o app tem tema CLARO e escuro, como o painel web. `cores` e
 *    `vidro` sao objetos MUTAVEIS: `aplicarTema` troca o conteudo deles, e os
 *    estilos sao montados por `criarEstilos`, que calcula de novo para o tema da
 *    vez. Quem le `cores.x` na hora de desenhar ja recebe o tema certo.
 *
 * Cor nova entra em `packages/ui`, nunca aqui.
 */
import {
  brand,
  dark,
  fontSize,
  fontWeight,
  glass,
  glassLight,
  light,
  radius,
  spacing,
} from '@na-regua/ui'

export type Tema = 'escuro' | 'claro'

const escuro = {
  /* --- Marca --- */
  primaria: brand.primary,
  primariaEscura: brand.primaryDark,
  acento: brand.accent,
  acentoEscuro: brand.accentDark,
  destaque: brand.highlight,

  /* --- Superficies --- */
  /*
   * Desde a NR-160 as superficies sao de VIDRO, como no web (NR-146): peca
   * translucida sobre o fundo, borda clara e campo rebaixado. Quem ja usava
   * `superficie`, `borda` e `campo` passou a vidro sem mudar de nome.
   */
  fundo: dark.bg,
  superficie: glass.surface,
  superficieAlta: glass.surfacePressed,
  borda: glass.border,
  campo: glass.inset,
  /** Painel por cima de conteudo (folha de modal, menu): opaco. */
  painel: glass.panelSolid,
  /** O azul do item ativo e da acao primaria. */
  ativo: glass.activeSolid,
  textoSobreAtivo: glass.activeText,
  /** Escurece o que fica atras de um modal. */
  veu: 'rgba(4, 6, 20, 0.6)',

  /* --- Texto --- */
  texto: dark.text,
  textoFraco: dark.textMuted,
  textoSobreAcento: dark.textOnAccent,

  /* --- Estados --- */
  atencao: dark.feedback.warning,
  atencaoFundo: dark.feedback.warningBg,
  erro: dark.feedback.danger,
  erroFundo: dark.feedback.dangerBg,
  sucesso: dark.feedback.success,
  sucessoFundo: dark.feedback.successBg,
}

export type Cores = { -readonly [K in keyof typeof escuro]: string }

/**
 * O claro, nos mesmos papeis — os valores do `:root[data-theme='light']` do
 * web. `acento` vira o teal de TEXTO (o vibrante falha como texto no claro,
 * 2,06:1), e o texto sobre ele passa a branco.
 */
const claro: Cores = {
  primaria: brand.primary,
  primariaEscura: brand.primaryDark,
  acento: brand.accentText,
  acentoEscuro: brand.accentDark,
  destaque: brand.highlight,

  fundo: light.bgMuted,
  superficie: glassLight.surface,
  superficieAlta: glassLight.surfacePressed,
  borda: glassLight.border,
  campo: glassLight.inset,
  painel: glassLight.panelSolid,
  ativo: glassLight.activeSolid,
  textoSobreAtivo: glassLight.activeText,
  veu: 'rgba(19, 23, 52, 0.35)',

  texto: light.text,
  /* `textSecondary`, e nao `textMuted`: o muted fica a 4,4:1 do campo claro. */
  textoFraco: light.textSecondary,
  textoSobreAcento: '#ffffff',

  atencao: light.feedback.warningText,
  atencaoFundo: light.feedback.warningBg,
  erro: light.feedback.dangerText,
  erroFundo: light.feedback.dangerBg,
  sucesso: light.feedback.successText,
  sucessoFundo: light.feedback.successBg,
}

export const paletas: Readonly<Record<Tema, Readonly<Cores>>> = { escuro, claro }

/** As cores do tema da vez. Mutavel de proposito — ver `aplicarTema`. */
export const cores: Cores = { ...escuro }

export const espaco = spacing

export const raio = {
  ...radius,
  pill: radius.pill,
} as const

export const fonte = {
  micro: fontSize.micro,
  pequeno: fontSize.small,
  corpo: fontSize.body,
  medio: fontSize.medium,
  titulo: fontSize.title,
  display: fontSize.display,
} as const

export const peso = {
  normal: fontWeight.regular,
  medio: fontWeight.medium,
  forte: fontWeight.semibold,
  pesado: fontWeight.bold,
} as const

/**
 * As pecas de vidro prontas — NR-160. Mesma anatomia do web: superficie
 * translucida, fio de luz no topo, curvatura por sombra interna e elevacao.
 * `boxShadow` e `experimental_backgroundImage` aceitam a sintaxe do CSS.
 */
/* So as propriedades que o vidro usa: assim a peca veste tanto `View` quanto
   o proprio `TextInput` (o campo), sem brigar com o tipo de texto. */
type Vidro = {
  borderWidth?: number
  borderColor?: string
  borderTopColor?: string
  backgroundColor?: string
  /* Sempre a string CSS: o tipo do `TextInput` nao aceita a forma em lista. */
  boxShadow?: string
  experimental_backgroundImage?: string
}
type PecasDeVidro = {
  peca: Vidro
  cartao: Vidro
  campo: Vidro
  ativo: Vidro
  painel: Vidro
}

function pecasDe(g: typeof glass | typeof glassLight, tema: Tema): PecasDeVidro {
  const fioDeLuz: Vidro = {
    borderWidth: 1,
    borderColor: g.border,
    borderTopColor: g.borderTop,
  }
  return {
    /** Peca pequena: botao, item, etiqueta. */
    peca: { ...fioDeLuz, backgroundColor: g.surface, boxShadow: g.shadow },
    /** Peca grande: cartao. O reflexo vem como camada de fundo. */
    cartao: {
      ...fioDeLuz,
      backgroundColor: g.surface,
      experimental_backgroundImage: g.sheen,
      boxShadow: g.shadowRaised,
    },
    /** Campo: rebaixado, com a sombra por dentro. */
    campo: {
      borderWidth: 1,
      borderColor: g.insetBorder,
      backgroundColor: g.inset,
      boxShadow: g.shadowInset,
    },
    /** Ativo e acao primaria: azul brilhando para fora (chapado no claro). */
    ativo: {
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.14)',
      borderTopColor: g.activeBorderTop,
      backgroundColor: tema === 'escuro' ? 'rgba(37, 99, 235, 0.3)' : g.activeSolid,
      experimental_backgroundImage: g.active,
      boxShadow: g.shadowActive,
    },
    /** Painel por cima de conteudo: folha de modal, menu lateral. */
    painel: {
      backgroundColor: g.panelSolid,
      experimental_backgroundImage: g.panel,
      boxShadow: g.shadowPanel,
    },
  }
}

const vidros: Record<Tema, PecasDeVidro> = {
  escuro: pecasDe(glass, 'escuro'),
  claro: pecasDe(glassLight, 'claro'),
}

/** As pecas do tema da vez. Mutavel de proposito — ver `aplicarTema`. */
export const vidro: PecasDeVidro = { ...vidros.escuro }

let temaAtual: Tema = 'escuro'

/** O tema em vigor — `criarEstilos` usa para escolher a folha. */
export const temaDaVez = () => temaAtual

/**
 * Troca o tema do app inteiro. Quem chama e o `TemaProvider` da raiz, que
 * em seguida redesenha a arvore — sem isso, o que ja esta na tela continua
 * com as cores antigas.
 */
export function aplicarTema(tema: Tema): void {
  temaAtual = tema
  Object.assign(cores, paletas[tema])
  Object.assign(vidro, vidros[tema])
}
