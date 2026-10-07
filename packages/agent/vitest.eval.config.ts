import { defineConfig } from 'vitest/config'

/**
 * Avaliação com o modelo real — fora do `pnpm test` e da CI. Exige
 * `OPENAI_API_KEY`; cada conversa fala com o provedor, então o timeout é largo.
 */
export default defineConfig({
  test: {
    include: ['eval/**/*.eval.ts'],
    testTimeout: 60_000,
  },
})
