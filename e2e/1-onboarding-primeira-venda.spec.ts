import { expect, test } from '@playwright/test'
import { aceitarCookies, cnpjNovo, produtoNovo } from './apoio'

/**
 * Fluxo 1 — onboarding ate a primeira venda (NR-049).
 *
 * O cadastro e PELA TELA, que e o que o fluxo prova: as tres etapas, o aceite
 * dos Termos e a sessao aberta no fim. O produto entra pela api — cadastrar
 * produto e outro fluxo, e aqui so atrapalharia a leitura.
 */
test('cadastra a loja pela tela e fecha a primeira venda', async ({ page }) => {
  const cnpj = cnpjNovo()

  await page.goto('/criar-conta')
  await aceitarCookies(page)

  await page.getByLabel('Nome completo').fill('Dona Primeira Venda')
  await page.getByLabel('E-mail').fill(`e2e-${cnpj}@teste.local`)
  await page.getByLabel('Razão social da empresa').fill('Mercearia Primeira Venda LTDA')
  await page.getByLabel('CNPJ').fill(cnpj)
  /* Unico por execucao: o cadastro recusa telefone repetido. */
  await page.getByLabel('Telefone / WhatsApp').fill(`419${cnpj.slice(0, 8)}`)
  await page.getByLabel('Senha', { exact: true }).fill('Senha-e2e-forte-123')
  await page.getByLabel('Confirmar senha').fill('Senha-e2e-forte-123')
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()

  await page.getByRole('button', { name: 'Continuar sem cupom' }).click()

  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Criar conta' }).click()

  /* A etapa 4 (Pix da mensalidade) ainda espera o preco (QST-002). A sessao ja
     existe quando ela aparece — e isso que o cadastro precisa garantir. */
  await expect(page.getByRole('heading', { name: 'Pagamento via Pix' })).toBeVisible()

  await produtoNovo(page.request, { description: 'Arroz E2E 5kg', salePriceCents: 2890, stock: 5 })

  await page.goto('/app/vendas/nova')
  await aceitarCookies(page)
  await page.getByRole('button', { name: /Seguir sem identificar/ }).click()
  await page.getByRole('button', { name: /Arroz E2E 5kg/ }).click()
  await page.getByRole('button', { name: /^Finalizar · R\$ 28,90/ }).click()

  await page.getByRole('button', { name: 'Confirmar recebimento em Dinheiro' }).click()
  await page.getByRole('button', { name: 'Fechar venda' }).click()
  await expect(page.getByRole('heading', { name: 'Documentos fiscais' })).toBeVisible()

  /* A venda existe de verdade: esta no historico, com o valor cobrado. */
  await page.goto('/app/vendas')
  await expect(page.getByText('R$ 28,90').first()).toBeVisible()
})
