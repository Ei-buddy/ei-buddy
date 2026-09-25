import { expect, test } from '@playwright/test'
import { aceitarCookies, eanNovo, lojaNova, produtoNovo } from './apoio'

/**
 * Fluxo 2 — codigo de barras, pagamento, recebivel (NR-049).
 *
 * Le o codigo pela entrada manual do leitor (a CI nao tem camera), paga no
 * credito em 3x e confere que as tres parcelas nasceram em Contas a receber.
 * E o caminho em que dinheiro vira titulo: se ele quebrar, o lojista vende e
 * nao ve o que tem a receber.
 */
test('bipa o produto, paga em 3x no credito e ve as parcelas a receber', async ({ page }) => {
  await lojaNova(page.request)
  const ean = eanNovo()
  await produtoNovo(page.request, {
    description: 'Cafe E2E 500g',
    barcode: ean,
    salePriceCents: 3000,
    stock: 10,
  })

  await page.goto('/app/vendas/nova')
  await aceitarCookies(page)
  await page.getByRole('button', { name: /Seguir sem identificar/ }).click()

  await page.getByRole('button', { name: 'Ler codigo' }).click()
  await page.getByLabel('Digitar o código').fill(ean)
  await page.getByLabel('Digitar o código').press('Enter')
  await page.getByRole('button', { name: /^Finalizar · R\$ 30,00/ }).click()

  await page.getByRole('button', { name: /Crédito/ }).click()
  await page.getByLabel('Parcelas').selectOption('3')
  await page.getByRole('button', { name: 'Confirmar recebimento em Crédito' }).click()
  await page.getByRole('button', { name: 'Fechar venda' }).click()
  await expect(page.getByRole('heading', { name: 'Documentos fiscais' })).toBeVisible()

  await page.goto('/app/financeiro/contas-a-receber')
  for (const parcela of ['1/3', '2/3', '3/3']) {
    await expect(page.getByText(new RegExp(`Cartao de credito ${parcela}`)).first()).toBeVisible()
  }
})
