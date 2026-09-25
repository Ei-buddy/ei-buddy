import type { APIRequestContext, Page } from '@playwright/test'

/** CNPJ valido e unico por execucao: o cadastro recusa CNPJ repetido. */
export function cnpjNovo(): string {
  const base = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).concat([0, 0, 0, 1])
  const dv = (n: number[]) => {
    const pesos =
      n.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const resto = n.reduce((a, d, i) => a + d * pesos[i]!, 0) % 11
    return resto < 2 ? 0 : 11 - resto
  }
  base.push(dv(base))
  base.push(dv(base))
  return base.join('')
}

/** EAN-13 valido e unico — o leitor confere o tamanho. */
export function eanNovo(): string {
  const d = [7, 8, 9, ...Array.from({ length: 9 }, () => Math.floor(Math.random() * 10))]
  const soma = d.reduce((a, n, i) => a + n * (i % 2 === 0 ? 1 : 3), 0)
  return [...d, (10 - (soma % 10)) % 10].join('')
}

/** Tira o aviso de cookies do caminho: ele cobre botoes no rodape. */
export async function aceitarCookies(page: Page): Promise<void> {
  await page
    .locator('section[aria-label="Aviso sobre cookies"] button')
    .first()
    .click({ timeout: 2_000 })
    .catch(() => undefined)
}

/**
 * Cadastro pela api, para os fluxos que NAO sao o cadastro. A sessao volta no
 * cookie do proprio contexto, como no navegador.
 */
export async function lojaNova(request: APIRequestContext): Promise<{ cnpj: string }> {
  const cnpj = cnpjNovo()
  const r = await request.post('/api/auth/signup', {
    data: {
      name: 'Dona E2E',
      email: `e2e-${cnpj}@teste.local`,
      secret: 'Senha-e2e-forte-123',
      legalName: 'Loja E2E Ficticia LTDA',
      cnpj,
      acceptedLegalTerms: true,
    },
  })
  if (r.status() !== 201) throw new Error(`cadastro ${r.status()}: ${await r.text()}`)
  return { cnpj }
}

/** Produto pela api — e preparacao, nao o que o teste prova. */
export async function produtoNovo(
  request: APIRequestContext,
  dados: { description: string; barcode?: string; salePriceCents: number; stock: number },
): Promise<{ id: string }> {
  const r = await request.post('/api/produtos', {
    data: { unitOfMeasure: 'un', costPriceCents: Math.round(dados.salePriceCents * 0.6), ...dados },
  })
  if (!r.ok()) throw new Error(`produto ${r.status()}: ${await r.text()}`)
  return (await r.json()) as { id: string }
}
