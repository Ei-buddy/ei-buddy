/**
 * Vidro do painel ("liquid glass") — NR-146 no web, NR-160 no app.
 *
 * Os MESMOS valores das variaveis `--glass-*` do `globals.css`, para web e app
 * mostrarem a mesma peca. O web desenha com gradiente e mascara em CSS; o app
 * usa `boxShadow` e `experimental_backgroundImage` do React Native, que aceitam
 * a mesma sintaxe.
 *
 * So o tema escuro: o app usa o escuro em todas as telas.
 */
export const glass = {
  /** Peca de vidro: botoes, cartoes, itens. */
  surface: 'rgba(255, 255, 255, 0.06)',
  surfacePressed: 'rgba(255, 255, 255, 0.1)',
  /** Um tom mais fundo: moldura que agrupa outras pecas. */
  surfaceDeep: 'rgba(255, 255, 255, 0.04)',
  /** O fio de luz: forte no topo, quase nada na base. */
  borderTop: 'rgba(255, 255, 255, 0.22)',
  border: 'rgba(255, 255, 255, 0.08)',
  /** Reflexo no canto de cima, como camada de fundo. */
  sheen: 'radial-gradient(120% 70% at 12% -20%, rgba(255, 255, 255, 0.07), transparent 60%)',
  shadow:
    '0 1px 1px rgba(255, 255, 255, 0.06) inset, 0 -6px 10px rgba(0, 0, 0, 0.2) inset, 0 6px 14px rgba(0, 0, 0, 0.22)',
  shadowRaised:
    '0 1px 1px rgba(255, 255, 255, 0.06) inset, 0 -10px 18px rgba(0, 0, 0, 0.16) inset, 0 10px 24px rgba(0, 0, 0, 0.24)',

  /** Ativo e acao primaria: o azul da barra, brilhando para fora. */
  active: 'linear-gradient(180deg, rgba(96, 165, 250, 0.55), rgba(37, 99, 235, 0.35))',
  /** A cor chapada media do ativo, para quem nao desenha gradiente. */
  activeSolid: '#2f5fc2',
  activeBorderTop: 'rgba(255, 255, 255, 0.6)',
  shadowActive:
    '0 1px 1px rgba(255, 255, 255, 0.35) inset, 0 -6px 10px rgba(0, 0, 0, 0.2) inset, 0 8px 24px rgba(59, 130, 246, 0.45)',
  activeText: '#ffffff',

  /** Campo: vidro REBAIXADO — sombra por dentro no topo, luz na base. */
  inset: 'rgba(0, 0, 0, 0.16)',
  insetBorder: 'rgba(255, 255, 255, 0.08)',
  shadowInset: '0 2px 6px rgba(0, 0, 0, 0.28) inset, 0 -1px 0 rgba(255, 255, 255, 0.06) inset',

  /** Painel por cima de conteudo (dialogo, menu): mais opaco. */
  panel: 'linear-gradient(180deg, rgba(36, 44, 96, 0.97), rgba(22, 28, 66, 0.98))',
  panelSolid: '#1b2150',
  shadowPanel:
    '0 1px 1px rgba(255, 255, 255, 0.08) inset, 0 30px 60px rgba(0, 0, 0, 0.55), 0 8px 20px rgba(0, 0, 0, 0.3)',
} as const

/**
 * O vidro no tema CLARO — os mesmos valores do bloco
 * `:root[data-theme='light'] .appTheme` do `globals.css` (NR-099/NR-146).
 *
 * No claro a peca e branca com sombra azul-escura bem fraca, e o ativo e azul
 * CHAPADO: o translucido desbota sobre superficie clara e o texto branco por
 * cima reprovaria no AA.
 */
export const glassLight = {
  surface: '#f6f8fc',
  surfacePressed: '#e6ebf5',
  surfaceDeep: '#eef1f8',
  borderTop: 'rgba(255, 255, 255, 0.95)',
  border: 'rgba(15, 42, 58, 0.1)',
  sheen: 'linear-gradient(180deg, #ffffff, #eef1f8)',
  shadow:
    '0 1px 1px rgba(255, 255, 255, 0.9) inset, 0 -6px 10px rgba(15, 42, 58, 0.05) inset, 0 6px 14px rgba(15, 42, 58, 0.1)',
  shadowRaised:
    '0 1px 1px rgba(255, 255, 255, 0.9) inset, 0 -10px 18px rgba(15, 42, 58, 0.035) inset, 0 10px 24px rgba(15, 42, 58, 0.08)',

  active: 'linear-gradient(180deg, #2f74e0, #1f5bc4)',
  activeSolid: '#1f5bc4',
  activeBorderTop: 'rgba(255, 255, 255, 0.45)',
  shadowActive:
    '0 1px 1px rgba(255, 255, 255, 0.35) inset, 0 -6px 10px rgba(0, 0, 0, 0.12) inset, 0 8px 24px rgba(59, 130, 246, 0.35)',
  activeText: '#ffffff',

  inset: 'rgba(19, 23, 52, 0.035)',
  insetBorder: '#e6e8ef',
  shadowInset: '0 2px 5px rgba(15, 42, 58, 0.08) inset, 0 -1px 0 rgba(255, 255, 255, 0.9) inset',

  panel: 'linear-gradient(180deg, rgba(255, 255, 255, 0.97), rgba(244, 246, 251, 0.97))',
  panelSolid: '#fbfcfe',
  shadowPanel:
    '0 1px 1px rgba(255, 255, 255, 0.9) inset, 0 30px 60px rgba(15, 42, 58, 0.16), 0 8px 20px rgba(15, 42, 58, 0.1)',
} as const satisfies Record<keyof typeof glass, string>
