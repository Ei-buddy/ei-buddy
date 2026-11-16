import { expect, test } from '@playwright/test'
import { aceitarCookies, eanNovo, lojaNova, produtoNovo } from './apoio'

/**
 * Taxas de recebimento da loja — DEC-027 (NR-223, NR-224).
 *
 * A loja grava a SUA taxa; o PDV mostra a mesma taxa e so oferece as parcelas
 * configuradas; e a venda fica gravada com a taxa da loja — e nao com a tabela
 * fixa que o PDV tinha (Pix 0,99%) nem com a padrao do servidor (Pix 0%).
 */
test('a loja grava as taxas e a venda sai com o liquido da taxa da loja', async ({ page }) => {
  await lojaNova(page.request)
  const ean = eanNovo()
  await produtoNovo(page.request, {
    description: 'Servico E2E Taxa',
    barcode: ean,
    salePriceCents: 10000,
    stock: 10,
  })

  await page.goto('/app/financeiro/taxas-de-recebimento')
  await aceitarCookies(page)
  await expect(page.getByText(/valores padrão/)).toBeVisible()

  await page.getByLabel('Pix (%)').fill('1,5')
  await page.getByLabel('Débito (%)').fill('1,2')
  await page.getByLabel('À vista (%)').fill('2,5')
  await page.getByLabel('2x (%)', { exact: true }).fill('4')
  await page.getByLabel('3x (%)', { exact: true }).fill('5')
  /* A loja so parcela em ate 3x: o resto em branco. */
  for (let n = 4; n <= 12; n++) await page.getByLabel(`${n}x (%)`, { exact: true }).fill('')
  await page.getByRole('button', { name: 'Salvar taxas' }).click()
  await expect(page.getByText('Taxas salvas. Valem para as próximas vendas.')).toBeVisible()

  /* Gravado, e nao so na tela. */
  const lidas = (await (await page.request.get('/api/taxas-de-recebimento')).json()) as {
    isDefault: boolean
    pixFeePercent: number
    creditFeePercents: number[]
  }
  expect(lidas).toMatchObject({ isDefault: false, pixFeePercent: 1.5 })
  expect(lidas.creditFeePercents).toEqual([2.5, 4, 5])

  await page.goto('/app/vendas/nova')
  await page.getByRole('button', { name: /Seguir sem identificar/ }).click()
  await page.getByRole('button', { name: 'Ler código' }).click()
  await page.getByLabel('Digitar o código').fill(ean)
  await page.getByLabel('Digitar o código').press('Enter')
  await page.getByRole('button', { name: /^Finalizar · R\$ 100,00/ }).click()

  /* O PDV mostra a taxa da loja e so as parcelas configuradas. */
  await expect(page.getByRole('button', { name: /Pix.*taxa 1,50%/ })).toBeVisible()
  await page.getByRole('button', { name: /Crédito/ }).click()
  await expect(page.getByLabel('Parcelas').locator('option')).toHaveCount(3)

  await page.getByRole('button', { name: /Pix/ }).click()
  await page.getByRole('button', { name: 'Confirmar recebimento em Pix' }).click()
  await page.getByRole('button', { name: 'Fechar venda' }).click()
  await expect(page.getByRole('heading', { name: 'Documentos fiscais' })).toBeVisible()

  const historico = (await (await page.request.get('/api/vendas/historico')).json()) as {
    sales: { grossAmountCents: number; cardFeeAmountCents: number }[]
  }
  expect(historico.sales[0]).toMatchObject({ grossAmountCents: 10000, cardFeeAmountCents: 150 })
})
