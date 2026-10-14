/**
 * Leitura de CSV para as importacoes do app — a mesma regra de
 * `apps/web/src/lib/planilha.ts`. Copia, e nao import: o app e a web nao
 * compartilham `lib`.
 */

export type PlanilhaLida = {
  colunas: string[]
  linhas: string[][]
}

/**
 * Le um CSV, detectando o separador usado.
 *
 * Respeita aspas: `"Silva, Maria"` e UM campo, e `""` dentro de aspas e uma
 * aspa literal. O `split` simples que havia aqui partia o nome em dois e
 * deslocava todas as colunas seguintes da linha. Tira tambem o BOM que o
 * Excel poe no comeco do arquivo, que grudava no nome da primeira coluna.
 */
export function lerCsv(texto: string): PlanilhaLida {
  const limpo = texto.replace(/^\uFEFF/, '')
  const primeira = limpo.split(/\r?\n/, 1)[0] ?? ''
  /* Planilha exportada em pt-BR costuma sair com ponto e virgula. */
  const sep = primeira.split(';').length > primeira.split(',').length ? ';' : ','

  const linhas: string[][] = []
  let linha: string[] = []
  let campo = ''
  let aspas = false

  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i]
    if (aspas) {
      if (c === '"' && limpo[i + 1] === '"') {
        campo += '"'
        i++
      } else if (c === '"') {
        aspas = false
      } else {
        campo += c
      }
    } else if (c === '"') {
      aspas = true
    } else if (c === sep) {
      linha.push(campo.trim())
      campo = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && limpo[i + 1] === '\n') i++
      linha.push(campo.trim())
      if (linha.some((v) => v !== '')) linhas.push(linha)
      linha = []
      campo = ''
    } else {
      campo += c
    }
  }
  linha.push(campo.trim())
  if (linha.some((v) => v !== '')) linhas.push(linha)

  if (linhas.length === 0) return { colunas: [], linhas: [] }
  return { colunas: linhas[0]!, linhas: linhas.slice(1) }
}
