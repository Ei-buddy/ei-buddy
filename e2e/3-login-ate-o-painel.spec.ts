import { expect, test } from '@playwright/test'
import { aceitarCookies, lojaNova } from './apoio'

/**
 * Fluxo 3 — entrar pela tela e chegar ao painel (NR-145).
 *
 * Existe por um defeito que so aparecia no build de producao: o login pedia
 * `/app` antecipadamente antes de haver sessao, o roteador guardava o
 * redirecionamento para o login e o reaproveitava depois da senha aceita.
 * Toda entrada terminava em "o painel nao abriu a tempo". Em desenvolvimento o
 * Next nao faz pedido antecipado, e por isso so este teste, que roda sobre o
 * build, pega a regressao.
 */
test('entra pela tela e o painel abre, sem o aviso de que nao abriu', async ({ page }) => {
  const { cnpj } = await lojaNova(page.request)
  /* O cadastro ja deixa a sessao no cookie; sem limpar, o teste nao passaria
     pelo login de verdade. */
  await page.context().clearCookies()

  await page.goto('/login')
  await aceitarCookies(page)

  await page
    .getByLabel(/E-mail/)
    .first()
    .fill(`e2e-${cnpj}@teste.local`)
  await page.getByLabel('Senha', { exact: true }).fill('Senha-e2e-forte-123')
  await page.getByRole('button', { name: /^Entrar$/ }).click()

  /* A travessia leva ~1s; cinco cobrem a rota vindo da rede e ficam bem
     abaixo dos sete em que ela desiste e mostra o aviso. */
  await expect(page).toHaveURL(/\/app(\/|$|\?)/, { timeout: 5_000 })
  await expect(page.getByText('o painel não abriu a tempo')).toHaveCount(0)
})
