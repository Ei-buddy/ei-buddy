/**
 * Tokens de design compartilhados entre web e mobile.
 *
 * Tokens sao compartilhados; componentes primitivos nao. React DOM e React
 * Native divergem o bastante para que um sistema de componentes unico custe
 * mais do que rende — ver o README deste pacote.
 */
export {
  brand,
  color,
  dark,
  fontFamily,
  fontSize,
  fontWeight,
  glass,
  layout,
  light,
  lineHeight,
  radius,
  shadow,
  spacing,
} from './tokens/index.js'

export {
  AA_LARGE_TEXT,
  AA_NORMAL_TEXT,
  contrastRatio,
  flatten,
  meetsAA,
  meetsAAOver,
} from './contrast.js'
