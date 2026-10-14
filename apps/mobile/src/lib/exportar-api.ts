import { File, Paths } from 'expo-file-system'
import { isAvailableAsync, shareAsync } from 'expo-sharing'
import { API_URL } from './api'
import { lerToken } from './session'

/**
 * Exportar listas em CSV ou PDF — NR-155, as mesmas rotas do web. O arquivo e
 * montado no servidor; aqui ele e baixado e entregue ao compartilhar do
 * celular (WhatsApp, e-mail, Drive).
 */

export type ListaExportavel =
  | 'clientes'
  | 'produtos'
  | 'vendas'
  | 'faturamento'
  | 'ranking-clientes'
  | 'ranking-produtos'
  | 'dre'

const CAMINHOS: Record<ListaExportavel, string> = {
  clientes: '/clientes/exportar',
  produtos: '/produtos/exportar',
  vendas: '/sales/exportar',
  faturamento: '/relatorios/faturamento/exportar',
  'ranking-clientes': '/relatorios/ranking/clientes/exportar',
  'ranking-produtos': '/relatorios/ranking/produtos/exportar',
  dre: '/relatorios/dre/exportar',
}

export async function exportarLista(
  lista: ListaExportavel,
  formato: 'csv' | 'pdf',
  filtros: Record<string, string | undefined> = {},
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const query = new URLSearchParams({ formato })
  for (const [k, v] of Object.entries(filtros)) if (v !== undefined && v !== '') query.set(k, v)

  const token = await lerToken()
  const destino = new File(Paths.cache, `${lista}.${formato}`)
  try {
    const arquivo = await File.downloadFileAsync(
      `${API_URL}${CAMINHOS[lista]}?${query.toString()}`,
      destino,
      {
        idempotent: true,
        ...(token === null ? {} : { headers: { authorization: `Bearer ${token}` } }),
      },
    )
    if (!(await isAvailableAsync())) {
      return { ok: false, erro: 'Este aparelho não permite compartilhar arquivos.' }
    }
    await shareAsync(arquivo.uri, {
      mimeType: formato === 'csv' ? 'text/csv' : 'application/pdf',
      dialogTitle: 'Exportar',
    })
    return { ok: true }
  } catch {
    return { ok: false, erro: 'Não foi possível exportar. Confira a conexão e tente de novo.' }
  }
}
