/**
 * Adaptador dos tokens compartilhados para o vocabulario deste app.
 *
 * A fonte de verdade e `@na-regua/ui` (NR-011). Este arquivo existe por dois
 * motivos:
 *
 * 1. O app usa o tema escuro em todas as telas, entao `cores` achata
 *    `dark` + `brand` num objeto so — em vez de espalhar `dark.feedback.danger`
 *    por 25 arquivos.
 * 2. Os nomes em portugues sao ponte, nao escolha. O code-style do repo pede
 *    identificador em ingles; renomear as 667 ocorrencias vira um diff mecanico
 *    que enterraria a revisao deste PR. Fica como tarefa propria.
 *
 * Cor nova entra em `packages/ui`, nunca aqui.
 */
import type { ViewStyle } from 'react-native'
import { brand, dark, fontSize, fontWeight, glass, radius, spacing } from '@na-regua/ui'

export const cores = {
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
} as const

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
const fioDeLuz: ViewStyle = {
  borderWidth: 1,
  borderColor: glass.border,
  borderTopColor: glass.borderTop,
}

export const vidro = {
  /** Peca pequena: botao, item, etiqueta. */
  peca: {
    ...fioDeLuz,
    backgroundColor: glass.surface,
    boxShadow: glass.shadow,
  },
  /** Peca grande: cartao. O reflexo vem como camada de fundo. */
  cartao: {
    ...fioDeLuz,
    backgroundColor: glass.surface,
    experimental_backgroundImage: glass.sheen,
    boxShadow: glass.shadowRaised,
  },
  /** Campo: rebaixado, com a sombra por dentro. */
  campo: {
    borderWidth: 1,
    borderColor: glass.insetBorder,
    backgroundColor: glass.inset,
    boxShadow: glass.shadowInset,
  },
  /** Ativo e acao primaria: azul brilhando para fora. */
  ativo: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderTopColor: glass.activeBorderTop,
    backgroundColor: 'rgba(37, 99, 235, 0.3)',
    experimental_backgroundImage: glass.active,
    boxShadow: glass.shadowActive,
  },
  /** Painel por cima de conteudo: folha de modal, menu lateral. */
  painel: {
    backgroundColor: glass.panelSolid,
    experimental_backgroundImage: glass.panel,
    boxShadow: glass.shadowPanel,
  },
} as const satisfies Record<string, ViewStyle>
