/**
 * Parte o texto ja formatado em baloes de WhatsApp.
 *
 * Limite natural so: fim de frase, linha de lista ou paragrafo separado por
 * linha em branco. Palavra, quantidade, nome e valor em `R$` ficam inteiros.
 * O turno tem de 1 a 5 partes — se a quebra natural passa disso, os trechos
 * adjacentes mais curtos se grudam de novo, na ordem.
 */

const LIMITE_CURTO = 280
const LIMITE_PARAGRAFO = 400
const MAX_PARTES = 5

const LINHA_DE_LISTA = /^(?:-\s+|\d+[.)]\s+)\S/

type Trecho = {
  texto: string
  /** Como este trecho se junta ao anterior, se a fusao precisar. */
  separador: string
  /**
   * A pergunta isolada nao volta a grudar no texto: ela tem de ocupar o
   * ultimo balao sozinha.
   */
  reservado: boolean
}

export function dividirRespostaWhatsapp(texto: string): string[] {
  const limpo = texto.replaceAll('\r\n', '\n').trim()
  if (limpo === '') return []

  /*
   * Ate 280 caracteres, sem lista e sem paragrafo em branco, e uma ideia so.
   * O ponto nao abre outro balao. "Algo. Confirma?" entra aqui: nao ha texto
   * anterior separado, e isolar a pergunta mandaria um balao sem o que dizer.
   */
  if (cabeNumaMensagem(limpo)) return [limpo]

  const { corpo, confirma } = separarConfirma(limpo)
  const trechos = quebrar(confirma ? corpo : limpo)

  if (confirma) {
    trechos.push({ texto: 'Confirma?', separador: '\n\n', reservado: true })
  }

  return fundir(trechos)
}

function cabeNumaMensagem(texto: string): boolean {
  return texto.length <= LIMITE_CURTO && !/\n[ \t]*\n/.test(texto) && contarLinhasDeLista(texto) < 2
}

/**
 * So a frase final, e so quando ela e exatamente `Confirma?`.
 * "Voce confirma?" ou um "Confirma?" no meio do texto ficam onde estao.
 */
function separarConfirma(texto: string): { corpo: string; confirma: boolean } {
  const casou = /^([\s\S]*\S)(?:[ \t]*\n+[ \t]*|(?<=[.!?])[ \t]+)Confirma\?[ \t]*$/.exec(texto)
  if (casou === null) return { corpo: texto, confirma: false }

  const corpo = (casou[1] ?? '').trim()
  if (corpo === '') return { corpo: texto, confirma: false }
  return { corpo, confirma: true }
}

function quebrar(texto: string): Trecho[] {
  const paragrafos = texto
    .split(/\n[ \t]*\n/)
    .map((paragrafo) => paragrafo.trim())
    .filter((paragrafo) => paragrafo.length > 0)

  const trechos: Trecho[] = []

  for (const paragrafo of paragrafos) {
    const partes = quebrarParagrafo(paragrafo)
    partes.forEach((parte, indice) => {
      trechos.push({
        texto: parte.texto,
        separador: indice === 0 ? '\n\n' : parte.separador,
        reservado: false,
      })
    })
  }

  return trechos
}

function quebrarParagrafo(paragrafo: string): Array<{ texto: string; separador: string }> {
  if (contarLinhasDeLista(paragrafo) >= 2) return quebrarLista(paragrafo)
  if (paragrafo.length > LIMITE_PARAGRAFO) return quebrarFrases(paragrafo)
  return [{ texto: paragrafo.trim(), separador: '\n\n' }]
}

function quebrarLista(paragrafo: string): Array<{ texto: string; separador: string }> {
  const linhas = paragrafo.split('\n')
  const inicio = linhas.findIndex((linha) => ehLinhaDeLista(linha))
  const trechos: Array<{ texto: string; separador: string }> = []

  if (inicio > 0) {
    const abertura = linhas.slice(0, inicio).join('\n').trim()
    if (abertura.length > 0) trechos.push({ texto: abertura, separador: '\n\n' })
  }

  const itens = inicio < 0 ? [] : linhas.slice(inicio)
  for (const linha of itens) {
    const item = linha.trim()
    if (item.length === 0) continue
    trechos.push({ texto: item, separador: '\n' })
  }

  return trechos
}

/**
 * Corta depois de `. `, `! ` ou `? `. O espaco entre `R$` e o valor nao e
 * fim de frase, e um ponto que ainda faz parte do valor (`R$ 1.234`) tambem
 * nao — ele nao vem seguido de espaco.
 */
function quebrarFrases(paragrafo: string): Array<{ texto: string; separador: string }> {
  const frases: string[] = []
  let inicio = 0

  for (let i = 0; i < paragrafo.length; i++) {
    const caractere = paragrafo[i]
    if (caractere !== '.' && caractere !== '!' && caractere !== '?') continue

    const depois = paragrafo[i + 1]
    if (depois !== ' ' && depois !== '\t') continue
    if (pontoDeDinheiro(paragrafo, i)) continue

    const frase = paragrafo.slice(inicio, i + 1).trim()
    if (frase.length > 0) frases.push(frase)

    let proximo = i + 1
    while (proximo < paragrafo.length) {
      const atual = paragrafo[proximo]
      if (atual !== ' ' && atual !== '\t') break
      proximo++
    }

    inicio = proximo
    i = proximo - 1
  }

  const resto = paragrafo.slice(inicio).trim()
  if (resto.length > 0) frases.push(resto)

  if (frases.length <= 1) return [{ texto: paragrafo.trim(), separador: '\n\n' }]
  return frases.map((frase) => ({ texto: frase, separador: ' ' }))
}

/** `R$. 12` nao pode separar o simbolo do valor. */
function pontoDeDinheiro(texto: string, indice: number): boolean {
  if (texto[indice] !== '.') return false
  return /R\$\s*$/.test(texto.slice(0, indice))
}

function fundir(trechos: Trecho[]): string[] {
  const itens = trechos.filter((trecho) => trecho.texto.trim().length > 0)

  while (itens.length > MAX_PARTES) {
    const indice = parMaisCurto(itens)
    if (indice < 0) break

    const esquerda = itens[indice]
    const direita = itens[indice + 1]
    if (esquerda === undefined || direita === undefined) break

    itens.splice(indice, 2, {
      texto: `${esquerda.texto}${direita.separador}${direita.texto}`,
      separador: esquerda.separador,
      reservado: false,
    })
  }

  return itens.map((trecho) => trecho.texto.trim()).filter((trecho) => trecho.length > 0)
}

/**
 * O par adjacente de menor soma. Empate fica com o da esquerda, para o
 * resultado nao depender da ordem em que se olha.
 */
function parMaisCurto(itens: readonly Trecho[]): number {
  let melhor = -1
  let menor = Number.POSITIVE_INFINITY

  for (let i = 0; i < itens.length - 1; i++) {
    const esquerda = itens[i]
    const direita = itens[i + 1]
    if (esquerda === undefined || direita === undefined) continue
    if (direita.reservado) continue

    const soma = esquerda.texto.length + direita.texto.length
    if (soma < menor) {
      menor = soma
      melhor = i
    }
  }

  return melhor
}

function contarLinhasDeLista(texto: string): number {
  return texto.split('\n').filter((linha) => ehLinhaDeLista(linha)).length
}

function ehLinhaDeLista(linha: string): boolean {
  return LINHA_DE_LISTA.test(linha.trim())
}
