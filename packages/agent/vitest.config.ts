import { defineConfig } from 'vitest/config'

/**
 * Piso de cobertura — RNF-068. `criarModeloReal` fala com a OpenAI e fica
 * isolada em `buddy-brain.ts`; os testes do laço usam o modelo dublê do
 * Mastra. `eval/` roda com o modelo real em `vitest.eval.config.ts`.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      exclude: ['src/index.ts', 'src/test-support/**', '**/*.test.ts'],
      include: ['src/**/*.ts'],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
      },
    },
  },
})
