import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Pacotes do workspace exportam TypeScript direto de src/ (padrao "internal
  // packages"): sem passo de build entre editar um pacote e ver no app.
  transpilePackages: ['@na-regua/ui', '@na-regua/contracts', '@na-regua/money'],
  // A imagem de producao leva so o servidor e os arquivos que ele de fato
  // carrega (`.next/standalone`), e nao o node_modules inteiro — NR-238. A
  // raiz do rastreio e a do monorepo, para os pacotes do workspace entrarem.
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
}

export default nextConfig
