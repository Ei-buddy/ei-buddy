import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  /*
   * A versao do React, dita e nao adivinhada.
   *
   * O `eslint-config-next` deixa `settings.react.version` em `'detect'`, e ai o
   * `eslint-plugin-react` sai andando pelo sistema de arquivos para descobrir
   * qual React esta instalado — passando por `context.getFilename()`, que o
   * ESLint 10 REMOVEU. O resultado e o lint inteiro morrer antes de analisar
   * uma linha:
   *
   *   TypeError: Error while loading rule 'react/display-name':
   *   contextOrFilename.getFilename is not a function
   *
   * A versao explicita corta esse caminho: o plugin le o numero daqui e nunca
   * chama a deteccao. E o que a documentacao dele recomenda, e ja valia a pena
   * antes do ESLint 10 — a deteccao automatica custa uma varredura de disco a
   * cada execucao para responder algo que o `package.json` ja sabe.
   *
   * Mantenha em sincronia com a dependencia `react` de apps/web/package.json.
   * Divergir aqui nao quebra nada: faz o plugin aplicar as regras de outra
   * versao, o que aparece como aviso estranho e nao como erro.
   */
  { settings: { react: { version: '19.2' } } },
  // Override default ignores of eslint-config-next.
  //
  // Os padroes precisam do `**/` na frente: sem ele o eslint nao poda o
  // diretorio durante a varredura e acaba lintando a saida de build — eram
  // 211 erros e 3989 avisos vindos de `.next/`, todos falsos.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '**/.next/**',
    '**/out/**',
    '**/build/**',
    'next-env.d.ts',
    '**/node_modules/**',
    '**/dist/**',
  ]),
])

export default eslintConfig
