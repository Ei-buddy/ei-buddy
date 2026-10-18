import { expect, test, type APIRequestContext } from '@playwright/test'
import { aceitarCookies, lojaNova, produtoNovo } from './apoio'

/**
 * Fluxo 4 — a operacao do dia alem da venda (NR-170): entrada de mercadoria
 * (NR-158), orcamento que vira venda (NR-159) e abertura e fechamento de caixa
 * (NR-157), pela TELA, contra a api e o Postgres de verdade.
 */

async function lerProduto(request: APIRequestContext, id: string) {
  const r = await request.get(`/api/produtos/${id}`)
  return (await r.json()) as { stock: number; costPriceCents: number }
}

async function vendaEmDinheiro(request: APIRequestContext, productId: string, cents: number) {
  const r = await request.post('/api/vendas', {
    headers: { 'idempotency-key': crypto.randomUUID() },
    data: {
      items: [{ productId, quantity: 1, unitPriceCents: cents }],
      payments: [{ method: 'cash', amountCents: cents }],
    },
  })
  if (!r.ok()) throw new Error(`venda ${r.status()}: ${await r.text()}`)
}

test('entrada de mercadoria soma ao estoque, faz o custo medio e lanca as parcelas', async ({
  page,
}) => {
  await lojaNova(page.request)
  const produto = await produtoNovo(page.request, {
    description: 'Arroz E2E 5kg',
    salePriceCents: 3000,
    stock: 10,
  })
  /* `produtoNovo` grava custo de 60% do preco: R$ 18,00. */

  await page.goto('/app/compras')
  await aceitarCookies(page)
  await page.locator('#compra-fornecedor').fill('Atacado E2E')
  await page.locator('#compra-nota').fill('4321')
  await page.locator('#compra-busca').fill('Arroz E2E')
  await page.getByRole('button', { name: /Arroz E2E 5kg/ }).click()
  await page.getByLabel('Quantidade de Arroz E2E 5kg').fill('10')
  await page.getByLabel('Custo unitário de Arroz E2E 5kg').fill('22,00')
  await page.locator('#compra-parcelas').selectOption('2')
  await page.getByRole('button', { name: 'Registrar entrada' }).click()
  await expect(page.getByText(/Entrada registrada: R\$\s?220,00/)).toBeVisible()

  /* (10 x 18 + 10 x 22) / 20 = 20 */
  expect(await lerProduto(page.request, produto.id)).toMatchObject({
    stock: 20,
    costPriceCents: 2000,
  })

  await page.goto('/app/financeiro/contas-a-pagar')
  await expect(page.getByText(/Compra de mercadoria NF 4321/).first()).toBeVisible()
})

test('orcamento nao mexe no estoque e vira venda pelo PDV', async ({ page }) => {
  await lojaNova(page.request)
  const produto = await produtoNovo(page.request, {
    description: 'Tinta E2E 18L',
    salePriceCents: 30000,
    stock: 5,
  })

  await page.goto('/app/orcamentos')
  await aceitarCookies(page)
  await page.locator('#orcamento-cliente').fill('Joana E2E')
  await page.locator('#orcamento-busca').fill('Tinta E2E')
  await page.getByRole('button', { name: /Tinta E2E 18L/ }).click()
  await page.getByLabel('Quantidade de Tinta E2E 18L').fill('2')
  await page.getByLabel('Preço unitário de Tinta E2E 18L').fill('280,00')
  await page.getByRole('button', { name: 'Criar orçamento' }).click()
  await expect(page.getByText('Orçamento nº 1 criado.')).toBeVisible()
  expect((await lerProduto(page.request, produto.id)).stock).toBe(5)

  await page.getByRole('link', { name: 'Abrir' }).first().click()
  await expect(page.getByLabel('Orçamento')).toContainText('TOTAL')
  await page.getByRole('button', { name: 'Converter em venda' }).click()
  await expect(page.getByText(/Orçamento nº 1 carregado/)).toBeVisible()

  await page.getByRole('button', { name: /Seguir sem identificar/ }).click()
  await page.getByRole('button', { name: /^Finalizar · R\$\s?560,00/ }).click()
  await page.getByRole('button', { name: /Pix/ }).click()
  await page.getByRole('button', { name: 'Confirmar recebimento em Pix' }).click()
  await page.getByRole('button', { name: 'Fechar venda' }).click()
  await expect(page.getByRole('heading', { name: 'Documentos fiscais' })).toBeVisible()

  expect((await lerProduto(page.request, produto.id)).stock).toBe(3)
  const lista = (await (await page.request.get('/api/orcamentos')).json()) as {
    quotes: { status: string; saleId: string | null }[]
  }
  expect(lista.quotes[0]).toMatchObject({ status: 'converted' })
  expect(lista.quotes[0]!.saleId).not.toBeNull()
})

test('caixa abre com troco, soma a venda em dinheiro e fecha batendo', async ({ page }) => {
  await lojaNova(page.request)
  const produto = await produtoNovo(page.request, {
    description: 'Pao E2E',
    salePriceCents: 3000,
    stock: 50,
  })

  await page.goto('/app/caixa')
  await aceitarCookies(page)
  await page.locator('#caixa-troco').fill('100,00')
  await page.getByRole('button', { name: 'Abrir caixa' }).click()
  await expect(page.getByText('Caixa aberto.')).toBeVisible()

  await vendaEmDinheiro(page.request, produto.id, 3000)
  await page.reload()
  await expect(page.getByText(/R\$\s?130,00/).first()).toBeVisible()

  await page.locator('#caixa-contado').fill('130,00')
  await page.getByRole('button', { name: 'Fechar caixa' }).click()
  /* Exato: o toast "Caixa fechado. Bateu certinho." tambem casa com 'bateu', e
     enquanto ele esta na tela o modo estrito recusa dois elementos. */
  await expect(page.getByText('bateu', { exact: true })).toBeVisible()
})
