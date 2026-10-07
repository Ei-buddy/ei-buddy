/**
 * Baixar uma lista exportada — NR-155.
 *
 * Nao passa por `pedir()`: ele le a resposta como JSON, e um CSV ou PDF
 * quebraria ali. O sucesso e um ARQUIVO, que ja sai como download.
 */

export type ListaExportavel =
  | 'clientes'
  | 'produtos'
  | 'vendas'
  | 'faturamento'
  | 'ranking-clientes'
  | 'ranking-produtos'
  | 'dre'

export type Formato = 'csv' | 'pdf'

const nomeDoArquivo = (cd: string | null): string | null =>
  cd === null ? null : (/filename="([^"]+)"/.exec(cd)?.[1] ?? null)

export async function baixarExportacao(
  lista: ListaExportavel,
  formato: Formato,
  filtros: Record<string, string | undefined> = {},
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const query = new URLSearchParams({ formato })
  for (const [k, v] of Object.entries(filtros)) if (v !== undefined && v !== '') query.set(k, v)

  let resposta: Response
  try {
    resposta = await fetch(`/api/exportar/${lista}?${query.toString()}`, {
      credentials: 'same-origin',
    })
  } catch {
    return { ok: false, erro: 'Sem conexão. Verifique sua internet.' }
  }

  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => ({}))) as { error?: { message?: string } }
    return { ok: false, erro: corpo.error?.message ?? 'Não foi possível exportar.' }
  }

  const url = URL.createObjectURL(await resposta.blob())
  const link = document.createElement('a')
  link.href = url
  link.download =
    nomeDoArquivo(resposta.headers.get('content-disposition')) ?? `${lista}.${formato}`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  return { ok: true }
}
