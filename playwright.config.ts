import { defineConfig, devices } from '@playwright/test'

/**
 * E2E no navegador — NR-049, `docs/engenharia/testes.md`.
 *
 * Os fluxos 1 e 2 do caminho critico, pela TELA: login, BFF, api, Postgres. O
 * que roda por baixo e o de verdade — nenhuma rota falsa, nenhum dado de
 * exemplo. O fluxo 3 continua na api (`apps/api/src/e2e`), porque o envio pelo
 * WhatsApp ainda e o remetente falso.
 *
 * Localmente reaproveita o `pnpm dev` que estiver no ar. Na CI, sobe api e web
 * a partir do build (`webServer`).
 */
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const API = process.env.E2E_API_URL ?? 'http://localhost:3333'

export default defineConfig({
  testDir: './e2e',
  /* Um fluxo por vez: os dois cadastram lojas e vendem, e em paralelo
     disputariam a mesma api de desenvolvimento sem ganho nenhum. */
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  /* Uma nova tentativa na CI, e so la: E2E que precisa de mais que isso esta
     quebrado, e a regra da casa e nao esconder teste instavel. */
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        /* Na sessao de nuvem o Chromium ja vem instalado fora do cache do
           Playwright; na CI, `playwright install` resolve sozinho. */
        ...(process.env.PW_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
  webServer: process.env.CI
    ? [
        {
          command: 'pnpm --filter @na-regua/api start',
          url: `${API}/health`,
          timeout: 120_000,
          reuseExistingServer: false,
        },
        {
          command: 'pnpm --filter @na-regua/web start',
          url: BASE,
          timeout: 120_000,
          reuseExistingServer: false,
        },
      ]
    : undefined,
})
