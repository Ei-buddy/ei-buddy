import { expect, test } from '@playwright/test'
import { aceitarCookies, lojaNova } from './apoio'

/**
 * Conciliar da baixa — DEC-026 (NR-225).
 *
 * O extrato entra, casa sozinho com as contas, a pessoa confirma os pares lado
 * a lado e o sistema da baixa em tudo — na ordem do extrato, na conta do
 * extrato e na data do banco.
 */
test('extrato casa com as contas, confirma lado a lado e as contas ficam pagas', async ({
  page,
}) => {
  await lojaNova(page.request)
  const api = async (url: string, data: unknown) => {
    const r = await page.request.post(url, { data })
    if (!r.ok()) throw new Error(`${url} ${r.status()}: ${await r.text()}`)
    return r.json()
  }

  await api('/api/contas-bancarias', {
    name: 'Nubank PJ',
    openingBalanceCents: 100_000,
    openingDate: '2026-11-01',
  })
  const luz = (
    (await api('/api/contas-a-pagar', {
      supplier: 'Copel E2E',
      description: 'Energia de novembro',
      amountCents: 48_000,
      dueDate: '2026-11-10',
    })) as { payables: { id: string }[] }
  ).payables[0]!
  const aluguel = (
    (await api('/api/contas-a-pagar', {
      supplier: 'Imobiliaria E2E',
      description: 'Aluguel',
      amountCents: 150_000,
      dueDate: '2026-11-05',
    })) as { payables: { id: string }[] }
  ).payables[0]!

  /* O extrato: o aluguel antes da luz, como no banco. */
  const csv = [
    'Data;Historico;Valor',
    '05/11/2026;PAG ALUGUEL;-1500,00',
    '10/11/2026;DEB COPEL;-480,00',
    '12/11/2026;TARIFA PACOTE;-12,90',
  ].join('\n')
  await api('/api/extratos', {
    filename: 'extrato.csv',
    contentBase64: Buffer.from(csv, 'utf8').toString('base64'),
  })

  await page.goto('/app/financeiro/conciliacao')
  await aceitarCookies(page)
  /* Com uma conta so, ela ja vem escolhida. */
  await expect(page.getByLabel('Conta do extrato')).toHaveValue('Nubank PJ')
  await page.getByRole('button', { name: 'Conferir lado a lado' }).click()

  const lista = page.getByRole('list', { name: 'Pares do extrato, na ordem do banco' })
  await expect(lista.getByRole('listitem')).toHaveCount(3)
  /* Na ordem do extrato, e a tarifa sem par. */
  await expect(lista.getByRole('listitem').nth(0)).toContainText('PAG ALUGUEL')
  await expect(lista.getByRole('listitem').nth(0)).toContainText('Imobiliaria E2E')
  await expect(lista.getByRole('listitem').nth(2)).toContainText('Nada bate')

  await page.getByRole('button', { name: /Marcar os sem dúvida \(2\)/ }).click()
  await page.getByRole('button', { name: 'Dar baixa nos 2 confirmados' }).click()
  await expect(
    page.getByText('2 linhas conciliadas e baixadas, na ordem do extrato.'),
  ).toBeVisible()

  /* As contas ficaram pagas. A lista de contas vem agrupada; procura em todos os grupos. */
  const todas = (await (await page.request.get('/api/contas-a-pagar')).json()) as Record<
    string,
    unknown
  >
  const achar = (id: string) =>
    Object.values(todas)
      .filter(Array.isArray)
      .flat()
      .find((c) => (c as { id: string }).id === id) as
      { status: string; settledAmountCents: number } | undefined
  expect(achar(aluguel.id)).toMatchObject({ status: 'settled', settledAmountCents: 150_000 })
  expect(achar(luz.id)).toMatchObject({ status: 'settled', settledAmountCents: 48_000 })

  /* Sobrou so a tarifa na fila. */
  await expect(page.getByText('TARIFA PACOTE')).toBeVisible()
})
