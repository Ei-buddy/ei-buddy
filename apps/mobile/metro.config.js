const { getDefaultConfig } = require('expo/metro-config')

/**
 * Configuracao do Metro.
 *
 * Os pacotes do monorepo (`@na-regua/ui`, `contracts`, `money`) importam no
 * estilo NodeNext: `from './tokens/index.js'` apontando para um `.ts`. O tsc e
 * o vitest entendem; o Metro nao, e o bundle do app caia no primeiro import de
 * `@na-regua/ui` — em qualquer plataforma, nao so no web.
 *
 * Aqui, um import relativo terminado em `.js` tenta antes o `.ts`/`.tsx` de
 * mesmo nome. Arquivo `.js` de verdade continua resolvendo pelo caminho padrao.
 */
const config = getDefaultConfig(__dirname)

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    for (const ext of ['.ts', '.tsx']) {
      try {
        return context.resolveRequest(context, moduleName.slice(0, -3) + ext, platform)
      } catch {
        /* nao existe com esta extensao: tenta a proxima */
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
