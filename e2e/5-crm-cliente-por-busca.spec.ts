import { expect, test } from '@playwright/test'
import { aceitarCookies, clienteNovo, lojaNova } from './apoio'

/**
 * CRM: o card novo acha QUALQUER cliente pela busca — NR-217.
 *
 * Achado do QA: o formulario do card era um `<select>` com a primeira pagina
 * de clientes (24, em ordem de nome). Com 25 ou mais, quem ficava depois na
 * ordem alfabetica nao podia ser vinculado. "Zuleica" e a ultima de 26: fora
 * da primeira pagina, de proposito.
 */
test('card novo vincula um cliente que esta fora da primeira pagina', async ({ page }) => {
  await lojaNova(page.request)
  for (let i = 1; i <= 25; i++) {
    const nn = String(i).padStart(2, '0')
    await clienteNovo(page.request, `Cliente E2E ${nn}`, `419888800${nn}`)
  }
  await clienteNovo(page.request, 'Zuleica E2E', '41988880099')

  await page.goto('/app/crm')
  await aceitarCookies(page)
  await page.getByRole('button', { name: 'Nova pendência' }).first().click()

  const dialogo = page.getByRole('dialog')
  await dialogo.getByLabel('Título').fill('Ligar para a Zuleica')
  await dialogo.getByRole('combobox', { name: 'Cliente' }).fill('Zuleica')
  await dialogo.getByRole('button', { name: /Zuleica E2E/ }).click()
  await expect(dialogo.getByText('Zuleica E2E', { exact: true })).toBeVisible()

  await dialogo.getByRole('button', { name: 'Criar card' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Ligar para a Zuleica').first()).toBeVisible()

  /* Gravado com o vinculo, e nao so na tela. */
  const r = await page.request.get('/api/crm/cards')
  const corpo = (await r.json()) as { cards: { title: string; customerName: string | null }[] }
  expect(corpo.cards.find((c) => c.title === 'Ligar para a Zuleica')?.customerName).toBe(
    'Zuleica E2E',
  )
})

test('Enter e Esc na busca de cliente nao mexem no card', async ({ page }) => {
  await lojaNova(page.request)
  await clienteNovo(page.request, 'Unico E2E')

  await page.goto('/app/crm')
  await aceitarCookies(page)
  await page.getByRole('button', { name: 'Nova pendência' }).first().click()

  const dialogo = page.getByRole('dialog')
  await dialogo.getByLabel('Título').fill('Card do Enter')
  const busca = dialogo.getByRole('combobox', { name: 'Cliente' })
  await busca.fill('Unico')
  const achado = dialogo.getByRole('button', { name: /Unico E2E/ })
  await expect(achado).toBeVisible()
  /* Esc fecha a LISTA, e nao o dialogo com o que ja foi digitado. */
  await busca.press('Escape')
  await expect(achado).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(1)
  /* Enter reabre; com um achado so, o segundo Enter escolhe — e nao envia. */
  await busca.press('Enter')
  await expect(achado).toBeVisible()
  await busca.press('Enter')
  await expect(dialogo.getByText('Unico E2E', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(1)

  /* Sem lista aberta, o Esc volta a ser do dialogo: fecha, sem criar nada. */
  await dialogo.getByLabel('Título').press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Card do Enter')).toHaveCount(0)
})
