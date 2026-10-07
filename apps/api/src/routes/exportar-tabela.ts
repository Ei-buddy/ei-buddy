import type { FastifyReply } from 'fastify'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/**
 * Exportar qualquer lista em CSV ou PDF — NR-155.
 *
 * Generalizacao do que `exportar-titulos.ts` faz para contas: cada lista
 * (clientes, produtos, vendas, relatorios, DRE) diz as COLUNAS, e o formato e
 * um so. Mesmas escolhas de la: `;` e BOM no CSV para abrir certo no Excel em
 * pt-BR; PDF A4 com cabecalho repetido a cada pagina e texto cortado na coluna,
 * sem quebrar linha.
 */

export type Coluna<T> = {
  readonly titulo: string
  readonly valor: (linha: T) => string
  /** Largura no PDF, em pontos. A soma cabe em 515 (A4 menos as margens). */
  readonly largura: number
  readonly alinhar?: 'direita'
}

export type Tabela<T> = {
  readonly titulo: string
  readonly colunas: readonly Coluna<T>[]
  readonly linhas: readonly T[]
  /** Linha de totais, na ordem das colunas. Vazio onde nao ha total. */
  readonly rodape?: readonly string[] | undefined
  /** O que dizer quando nao ha linha nenhuma. */
  readonly vazio?: string | undefined
}

const SEPARADOR = ';'

const escaparCsv = (valor: string): string =>
  /["\r\n;]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor

export function tabelaCsv<T>(t: Tabela<T>): string {
  const cabecalho = t.colunas.map((c) => c.titulo)
  const corpo = t.linhas.map((l) => t.colunas.map((c) => c.valor(l)))
  const todas = [cabecalho, ...corpo, ...(t.rodape === undefined ? [] : [[], [...t.rodape]])]
  /* BOM por escape, como em `exportar-titulos.ts`: o Excel do Windows le
     acento como lixo sem ele. */
  const BOM_UTF8 = String.fromCharCode(0xfeff)
  return BOM_UTF8 + todas.map((l) => l.map(escaparCsv).join(SEPARADOR)).join('\r\n')
}

const PAGINA = { largura: 595.28, altura: 841.89 }
const MARGEM = 40
const ALTURA_LINHA = 16

function encurtar(texto: string, largura: number, medir: (t: string) => number): string {
  if (medir(texto) <= largura) return texto
  let cortado = texto
  while (cortado.length > 1 && medir(`${cortado}…`) > largura) cortado = cortado.slice(0, -1)
  return `${cortado}…`
}

export async function tabelaPdf<T>(t: Tabela<T>, geradoEm: Date): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const fonte = await doc.embedFont(StandardFonts.Helvetica)
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold)

  let pagina = doc.addPage([PAGINA.largura, PAGINA.altura])
  let y = PAGINA.altura - MARGEM

  const xs: number[] = []
  t.colunas.reduce((x, c) => {
    xs.push(x)
    return x + c.largura
  }, 0)

  const celula = (texto: string, i: number, f: typeof fonte, tamanho = 9) => {
    const c = t.colunas[i]!
    const medir = (s: string) => f.widthOfTextAtSize(s, tamanho)
    const cortado = encurtar(texto, c.largura - 4, medir)
    const x = MARGEM + xs[i]! + (c.alinhar === 'direita' ? c.largura - 4 - medir(cortado) : 0)
    pagina.drawText(cortado, { x, y, size: tamanho, font: f, color: rgb(0.1, 0.1, 0.1) })
  }

  const cabecalho = () => {
    t.colunas.forEach((c, i) => celula(c.titulo, i, negrito))
    y -= ALTURA_LINHA * 0.6
    pagina.drawLine({
      start: { x: MARGEM, y },
      end: { x: PAGINA.largura - MARGEM, y },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    })
    y -= ALTURA_LINHA * 0.6
  }

  const quebra = () => {
    if (y >= MARGEM + ALTURA_LINHA) return
    pagina = doc.addPage([PAGINA.largura, PAGINA.altura])
    y = PAGINA.altura - MARGEM
    cabecalho()
  }

  pagina.drawText(t.titulo, { x: MARGEM, y, size: 16, font: negrito })
  y -= ALTURA_LINHA
  pagina.drawText(`Gerado em ${geradoEm.toLocaleString('pt-BR')}`, {
    x: MARGEM,
    y,
    size: 9,
    font: fonte,
    color: rgb(0.4, 0.4, 0.4),
  })
  y -= ALTURA_LINHA * 1.5
  cabecalho()

  for (const l of t.linhas) {
    quebra()
    t.colunas.forEach((c, i) => celula(c.valor(l), i, fonte))
    y -= ALTURA_LINHA
  }

  if (t.linhas.length === 0) {
    pagina.drawText(t.vazio ?? 'Nada para listar.', { x: MARGEM, y, size: 10, font: fonte })
    y -= ALTURA_LINHA
  }

  if (t.rodape !== undefined) {
    quebra()
    y -= ALTURA_LINHA * 0.3
    t.rodape.forEach((texto, i) => {
      if (texto !== '') celula(texto, i, negrito)
    })
  }

  return doc.save()
}

/** Responde o arquivo com o nome e o tipo certos. */
export async function enviarTabela<T>(
  reply: FastifyReply,
  formato: 'csv' | 'pdf',
  nomeArquivo: string,
  tabela: Tabela<T>,
  geradoEm: Date,
): Promise<FastifyReply> {
  reply.header('Content-Disposition', `attachment; filename="${nomeArquivo}.${formato}"`)
  if (formato === 'csv') return reply.type('text/csv; charset=utf-8').send(tabelaCsv(tabela))
  return reply.type('application/pdf').send(Buffer.from(await tabelaPdf(tabela, geradoEm)))
}

/** Reais formatados, como no resto das exportacoes. */
export const reais = (cents: number): string =>
  (cents / 100)
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    .replace(/\u00a0/g, ' ')

/** `AAAA-MM-DD` (ou ISO) para `DD/MM/AAAA`. */
export function dataBr(iso: string | null): string {
  if (iso === null || iso === '') return ''
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

/**
 * Percorre as paginas de uma lista ate o fim ou ate o teto. Os casos de uso
 * de lista sao paginados de proposito; a exportacao junta as paginas aqui,
 * sem abrir uma segunda porta "sem limite" para o banco.
 */
export async function todasAsPaginas<T>(
  buscar: (pagina: number) => Promise<{ readonly itens: readonly T[]; readonly total: number }>,
  teto: number,
): Promise<{ itens: T[]; cortou: boolean }> {
  const itens: T[] = []
  let total = Infinity
  for (let pagina = 1; itens.length < Math.min(total, teto); pagina += 1) {
    const r = await buscar(pagina)
    total = r.total
    if (r.itens.length === 0) break
    itens.push(...r.itens)
  }
  return { itens: itens.slice(0, teto), cortou: total > teto }
}
