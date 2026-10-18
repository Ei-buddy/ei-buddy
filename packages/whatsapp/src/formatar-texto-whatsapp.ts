const JUNCAO_DE_PALAVRA = '\u2060'
const MARCADORES = ['*', '_', '~'] as const
const ENVOLTORIO_CODIGO = '\uE000'

type Marcador = (typeof MARCADORES)[number]

/**
 * Grafia de markdown comum para o que o WhatsApp desenha.
 * Sem I/O. O trecho entre tres crases sai intacto; o resto da linha passa, nesta ordem,
 * por negrito, link, tabela, lista e marcador solto — cada passo entrega
 * um asterisco que o seguinte ainda reconhece.
 */
export function formatarTextoWhatsApp(texto: string): string {
  const protegido = protegerTrechoDeCodigo(texto)
  const linhas: string[] = []
  for (const bruta of protegido.texto.split('\n')) {
    const formatada = formatarLinha(bruta.replace(/\r$/, ''))
    if (formatada !== null) linhas.push(formatada)
  }
  return restaurarTrechoDeCodigo(linhas.join('\n'), protegido.trechos)
}

function protegerTrechoDeCodigo(texto: string): { texto: string; trechos: string[] } {
  const trechos: string[] = []
  const semCodigo = texto.replace(/```[\s\S]*?```/g, (trecho) => {
    const indice = trechos.length
    trechos.push(trecho)
    return `${ENVOLTORIO_CODIGO}${indice}${ENVOLTORIO_CODIGO}`
  })
  return { texto: semCodigo, trechos }
}

function restaurarTrechoDeCodigo(texto: string, trechos: readonly string[]): string {
  return texto.replace(
    new RegExp(`${ENVOLTORIO_CODIGO}(\\d+)${ENVOLTORIO_CODIGO}`, 'g'),
    (_tudo, indice: string) => trechos[Number(indice)] ?? '',
  )
}

function formatarLinha(linha: string): string | null {
  if (ehSeparadorDeTabela(linha)) return null
  if (/^\s*#/.test(linha)) return formatarTitulo(linha)

  let atual = converterLinks(converterNegritoMarkdown(linha))
  if (atual.includes('|')) atual = juntarCelulas(atual)
  else atual = atual.replace(/^(\s*)\* /, '$1- ')
  return escaparMarcadoresSoltos(atual)
}

/** Separador de tabela: so traco, pipe, dois-pontos e espaco. Nao vira texto. */
function ehSeparadorDeTabela(linha: string): boolean {
  const aparada = linha.trim()
  if (!aparada.includes('|') || !aparada.includes('-')) return false
  return /^[\s|:-]+$/.test(aparada)
}

function formatarTitulo(linha: string): string {
  const titulo = linha.replace(/^\s*#+\s*/, '').trim()
  if (titulo === '') return ''
  const inline = converterLinks(converterNegritoMarkdown(titulo))
  /* Um par *assim* ja e negrito. Enrolar de novo colaria asterisco duplo. */
  if (inline.includes('*')) return escaparMarcadoresSoltos(inline)
  return escaparMarcadoresSoltos(`*${inline}*`)
}

function converterNegritoMarkdown(texto: string): string {
  return texto.replace(/\*\*([^*\n]+)\*\*/g, '*$1*').replace(/__([^_\n]+)__/g, '*$1*')
}

function converterLinks(texto: string): string {
  return texto.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_tudo, rotulo: string, url: string) => {
    const rotuloLimpo = rotulo.trim()
    const urlLimpa = url.trim()
    /* Sem colchetes. Os dois lados iguais ficam uma vez so. */
    if (rotuloLimpo === urlLimpa) return rotuloLimpo
    return `${rotuloLimpo} (${urlLimpa})`
  })
}

function juntarCelulas(linha: string): string {
  const celulas = linha.split('|').map((celula) => celula.trim())
  while (celulas[0] === '') celulas.shift()
  while (celulas.length > 0 && celulas[celulas.length - 1] === '') celulas.pop()
  return celulas.join(' — ')
}

/**
 * Par valido: marcador, texto que nao comeca nem termina com espaco e nao
 * tem quebra de linha, o mesmo marcador. ** nao e par — isso ja virou *texto*.
 * O que sobra ganha U+2060 logo depois: o sinal continua visivel e o WhatsApp
 * nao encosta o marcador na palavra.
 */
function escaparMarcadoresSoltos(texto: string): string {
  const par = parMaisAEsquerda(texto)
  if (par === null) {
    return texto.replace(/[*_~]/g, (marcador) => `${marcador}${JUNCAO_DE_PALAVRA}`)
  }
  const antes = texto
    .slice(0, par.inicio)
    .replace(/[*_~]/g, (marcador) => `${marcador}${JUNCAO_DE_PALAVRA}`)
  const miolo = escaparMarcadoresSoltos(texto.slice(par.inicio + 1, par.fim))
  const depois = escaparMarcadoresSoltos(texto.slice(par.fim + 1))
  return `${antes}${par.marcador}${miolo}${par.marcador}${depois}`
}

function parMaisAEsquerda(
  texto: string,
): { inicio: number; fim: number; marcador: Marcador } | null {
  let melhor: { inicio: number; fim: number; marcador: Marcador } | null = null
  for (const marcador of MARCADORES) {
    const encontrado = regexParValido(marcador).exec(texto)
    if (encontrado === null) continue
    const inicio = encontrado.index
    const fim = inicio + encontrado[0].length - 1
    if (melhor === null || inicio < melhor.inicio) melhor = { inicio, fim, marcador }
  }
  return melhor
}

function regexParValido(marcador: Marcador): RegExp {
  const escapado = marcador === '*' ? '\\*' : marcador
  return new RegExp(
    `${escapado}([^\\s${escapado}\\n](?:[^${escapado}\\n]*[^\\s${escapado}\\n])?)${escapado}`,
  )
}
