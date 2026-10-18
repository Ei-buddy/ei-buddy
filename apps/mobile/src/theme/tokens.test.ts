import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AA_NORMAL_TEXT, contrastRatio, flatten } from '@na-regua/ui'
import { describe, expect, it } from 'vitest'
import { paletas, type Tema } from './tokens.js'

/**
 * RNF-055 no app mobile.
 *
 * ## Por que este arquivo existe, se `packages/ui` ja testa contraste
 *
 * Porque testar a paleta nao impede usa-la errado, e foi usa-la errado que
 * quebrou cinco lugares deste app:
 *
 * - o valor do indicador em DESTAQUE da tela inicial, a 1,30:1 do proprio
 *   cartao — o numero mais importante da tela, ilegivel;
 * - a borda que deveria destacar esse cartao, a 1,30:1 — destaque invisivel;
 * - o rotulo do atalho principal, a 1,12:1 — a acao que a pessoa abre o app
 *   para fazer;
 * - o rotulo da aba ativa no DRE e em relatorios, a 1,12:1 — a aba selecionada
 *   era a unica ilegivel das tres;
 * - a barra do grafico de faturamento, a 1,06:1 contra o proprio trilho.
 *
 * Todos com a mesma causa: `cores.primaria` e `brand.primary`, um azul-marinho
 * de tema CLARO. No escuro ele fica a 1,4:1 do fundo.
 *
 * O teste de `packages/ui` media apenas os pares que alguem lembrou de listar,
 * e ninguem lista o par que nao sabe que existe. Este aqui vai pela outra
 * ponta: le o CODIGO das telas e recusa a cor que nao pode ser texto.
 */

/* `fileURLToPath` e nao `url.pathname`: no Windows o `pathname` vem como
   `/C:/...`, e o `join` seguinte produzia `C:\C:\...`. */
const AQUI = fileURLToPath(new URL('.', import.meta.url))
const RAIZ_DO_APP = join(AQUI, '..', '..')

/**
 * Cores sem NENHUM fundo seguro neste tema — medido, nao opinado.
 *
 * Nao inclui `textoSobreAcento`: ele e inseguro sobre as superficies e seguro
 * sobre `acento` (6,84:1), que e para onde ele existe. Proibi-lo aqui
 * reprovaria o uso correto, que e a maioria.
 */
const INSEGURAS_COMO_TEXTO = ['primaria', 'primariaEscura', 'destaque', 'borda'] as const

/** As superficies sobre as quais texto aparece no app, nos DOIS temas (NR-167). */
const superficiesDe = (cores: (typeof paletas)[Tema]): ReadonlyArray<readonly [string, string]> => [
  ['tela', cores.fundo],
  /* Vidro desde a NR-160: translucido, entao mede-se ja pousado no fundo. */
  ['cartao', flatten(cores.superficie, cores.fundo)],
  ['cartao elevado', flatten(cores.superficieAlta, cores.fundo)],
  ['campo', flatten(cores.campo, flatten(cores.superficie, cores.fundo))],
  ['painel', cores.painel],
]

const TEMAS = ['escuro', 'claro'] as const

function arquivosDeTela(pasta: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(pasta)) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue

    const caminho = join(pasta, nome)
    if (statSync(caminho).isDirectory()) {
      arquivosDeTela(caminho, achados)
      continue
    }
    if (nome.endsWith('.tsx')) achados.push(caminho)
  }
  return achados
}

const telas = [
  ...arquivosDeTela(join(RAIZ_DO_APP, 'app')),
  ...arquivosDeTela(join(RAIZ_DO_APP, 'src')),
]

describe('a varredura enxerga o app', () => {
  /* Sem isto, um `app/` renomeado faria a suite passar sem ler nada — e um
     teste que nao le nada aprova qualquer coisa. */
  it('acha as telas', () => {
    expect(telas.length).toBeGreaterThan(15)
  })
})

describe('nenhuma tela usa como texto uma cor que nao da contraste', () => {
  it.each(INSEGURAS_COMO_TEXTO)('cores.%s nao aparece em `color:`', (token) => {
    /*
     * So a propriedade de TEXTO, que em React Native e `color:` — a mesma cor
     * e legitima como fundo sob texto claro, e e assim que o avatar do cliente
     * a usa.
     *
     * O casamento e por `color` MINUSCULO nao precedido de letra. Estilo em JS
     * e camelCase, entao toda propriedade composta termina em `Color` com C
     * maiusculo: `backgroundColor`, `borderTopColor`, `tintColor`,
     * `placeholderTextColor`. A primeira versao tentava excluir uma a uma com
     * lookbehind e deu dez falsos positivos — `borderTopColor` escapava,
     * porque os seis caracteres antes de `Color` sao `derTop`, e nao `border`.
     */
    const padrao = new RegExp(String.raw`(?<![A-Za-z])color:\s*cores\.${token}\b`)

    const culpadas = telas
      .filter((t) => padrao.test(readFileSync(t, 'utf8')))
      .map((t) => t.slice(RAIZ_DO_APP.length + 1))

    expect(culpadas, `cores.${token} usada como texto`).toEqual([])
  })
})

describe.each(TEMAS)('tema %s', (tema) => {
  const cores = paletas[tema]

  describe('as cores que o app usa como texto atendem ao AA', () => {
    const usadasComoTexto: ReadonlyArray<readonly [string, string]> = [
      ['texto', cores.texto],
      ['textoFraco', cores.textoFraco],
      ['acento', cores.acento],
      ['erro', cores.erro],
      ['atencao', cores.atencao],
      ['sucesso', cores.sucesso],
    ]

    for (const [nome, cor] of usadasComoTexto) {
      it.each(superficiesDe(cores))(`${nome} sobre %s`, (_onde, fundo) => {
        expect(contrastRatio(cor, fundo)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
      })
    }
  })

  describe('texto sobre fundo colorido', () => {
    it('o texto sobre o acento serve sobre ele', () => {
      expect(contrastRatio(cores.textoSobreAcento, cores.acento)).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT,
      )
    })

    it('o texto sobre o ativo azul serve sobre ele', () => {
      expect(contrastRatio(cores.textoSobreAtivo, cores.ativo)).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT,
      )
    })
  })
})

describe('a primaria nao e fundo para o texto quase preto do acento escuro', () => {
  /*
   * `textoSobreAcento` do escuro e quase preto e existe para o `acento`, que e
   * claro. Sob `primaria` ele da 1,12:1 — foi esse par que deixou o atalho
   * principal e as abas ativas ilegiveis, em tres telas.
   */
  it('NAO serve sobre a primaria — o par que quebrou tres telas', () => {
    expect(contrastRatio(paletas.escuro.textoSobreAcento, paletas.escuro.primaria)).toBeLessThan(
      AA_NORMAL_TEXT,
    )
  })

  /* `primaria` como fundo e legitima sob texto CLARO: e o avatar do cliente. */
  it('a primaria como fundo aceita texto claro', () => {
    expect(contrastRatio(paletas.escuro.texto, paletas.escuro.primaria)).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    )
  })
})
