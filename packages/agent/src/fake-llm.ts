import {
  createPayableInputSchema,
  createProductInputSchema,
  createReceivableInputSchema,
} from '@na-regua/contracts'
import { mesDoDia } from './format.js'
import type { LlmDecision, LlmPort, ToolDescriptor } from './types.js'

function normalizar(texto: string): string {
  return texto.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

/**
 * LLM falso — `AGENT_PROVIDER=fake`.
 *
 * Nao fala com a OpenAI. Dois modos, e o segundo e o que importa no dia a dia:
 * roteiro gravado para teste, e um reconhecedor minimo em portugues para as
 * consultas da US-047 ("quanto vendi hoje?", "quem esta me devendo?").
 * Essas duas leituras sao o caminho de consulta desta fatia. "Resumo do mes"
 * aponta para `period_summary` (DRE / RF-108), nao para `revenue_by_month`.
 *
 * Venda, cadastro de cliente e cobranca NAO entram no reconhecedor: sem modelo,
 * o risco e executar a tool errada. Esses caminhos usam `script()`.
 * NR-117: `create_product`, `create_payable` e `create_receivable` com frases
 * minimas do quickstart (args validados pelo schema da tool).
 * Recusas RF-149–151 (certificado, OFX, nota avulsa) entram no reconhecedor:
 * o risco inverso e cair em `unknown` ou, pior, em `create_sale`.
 */
export class FakeLlm implements LlmPort {
  private readonly roteiros = new Map<string, LlmDecision>()

  script(texto: string, decisao: LlmDecision): void {
    this.roteiros.set(normalizar(texto), decisao)
  }

  async decide(input: {
    readonly text: string
    readonly tools: readonly ToolDescriptor[]
    readonly today: string
    readonly history?: readonly { readonly role: string; readonly body: string }[]
  }): Promise<LlmDecision> {
    /* history e ignorado no reconhecedor — frases completas inalteradas. */
    const chave = normalizar(input.text)
    const roteiro = this.roteiros.get(chave)
    if (roteiro !== undefined) return roteiro

    const ids = new Set(input.tools.map((t) => t.id))
    const porPalavra = reconhecerConsulta(chave, input.today)
    if (porPalavra !== undefined && ids.has(porPalavra.name)) return porPalavra

    const mutacao = reconhecerMutacaoNr117(chave, input.today)
    if (mutacao !== undefined && ids.has(mutacao.name)) return mutacao

    /* Frase fora do reconhecedor de leitura — inclusive nonsense e pedidos
       que ainda nao tem tool. processMessage lista as capacidades atuais. */
    return { type: 'unknown' }
  }
}

function reconhecerConsulta(
  texto: string,
  today: string,
): Extract<LlmDecision, { type: 'tool' }> | undefined {
  const recusa = reconhecerRecusa(texto)
  if (recusa !== undefined) return recusa

  /* US-047 / US2: vendas do dia e inadimplentes — caminhos principais. */
  if (/quanto vend|faturamento|vendas? (de )?hoje|ticket medio/.test(texto)) {
    return { type: 'tool', name: 'list_sales', args: { from: today, to: today } }
  }
  if (/quem (me )?(esta |ta )?dev|inadimplen|me devendo/.test(texto)) {
    return { type: 'tool', name: 'list_receivables', args: {} }
  }
  const pagar = reconhecerPayables(texto)
  if (pagar !== undefined) return pagar
  /* US-053 / US6: DRE do mes — faturamento, custo, despesas, resultado. */
  if (/resumo do mes|resultado do mes/.test(texto)) {
    const mes = mesDoDia(today)
    return { type: 'tool', name: 'period_summary', args: mes }
  }
  const estoque = reconhecerEstoque(texto)
  if (estoque !== undefined) return estoque
  const fiado = reconhecerFiado(texto)
  if (fiado !== undefined) return fiado
  return undefined
}

/** US2 / NR-115: contas a pagar por vencimento — leitura sem argumentos. */
function reconhecerPayables(texto: string): Extract<LlmDecision, { type: 'tool' }> | undefined {
  const limpo = texto.replace(/\?+$/, '').trim()

  /* "lanca conta a pagar" e pedido de mutacao incompleto (NR-117), nao consulta. */
  if (/^lanc(?:a|ar)\b/.test(limpo)) return undefined

  if (
    /o que vence|quais contas a pagar|contas? a pagar|quanto tenho a pagar|vencimentos?/.test(limpo)
  ) {
    return { type: 'tool', name: 'list_payables', args: {} }
  }

  return undefined
}

/** US-065 / NR-115: consulta de estoque por nome de produto. */
function reconhecerEstoque(texto: string): Extract<LlmDecision, { type: 'tool' }> | undefined {
  const limpo = texto.replace(/\?+$/, '').trim()

  const quantoTem = limpo.match(/^quanto tem de (.+)$/)?.[1]?.trim()
  if (quantoTem !== undefined && quantoTem !== '') {
    return { type: 'tool', name: 'check_stock', args: { query: quantoTem } }
  }

  const qualEstoque = limpo.match(/^qual o estoque de (.+)$/)?.[1]?.trim()
  if (qualEstoque !== undefined && qualEstoque !== '') {
    return { type: 'tool', name: 'check_stock', args: { query: qualEstoque } }
  }

  const estoqueDe = limpo.match(/^estoque de (.+)$/)?.[1]?.trim()
  if (estoqueDe !== undefined && estoqueDe !== '') {
    return { type: 'tool', name: 'check_stock', args: { query: estoqueDe } }
  }

  return undefined
}

/** US-067 / NR-115: consulta de fiado por nome de cliente. */
function reconhecerFiado(texto: string): Extract<LlmDecision, { type: 'tool' }> | undefined {
  const limpo = texto.replace(/\?+$/, '').trim()

  const padroes: Array<[RegExp, number]> = [
    [/^qual o saldo (?:do|da) (.+)$/i, 1],
    [/^quanto (?:o|a) (.+) deve$/i, 1],
    [/^quanto deve (?:o|a) (.+)$/i, 1],
    [/^fiado (?:do|da) (.+)$/i, 1],
    [/^saldo (?:do|da) (.+)$/i, 1],
    [/^quanto (?:o|a) (.+) (?:ta|esta) devendo$/i, 1],
  ]

  for (const [padrao, grupo] of padroes) {
    const match = limpo.match(padrao)
    const query = match?.[grupo]?.trim()
    if (query === undefined || query === '' || query.toLowerCase() === 'carteira') continue
    return { type: 'tool', name: 'check_customer_wallet', args: { query } }
  }

  return undefined
}

/** NR-117 — cadastro de produto, conta a pagar e recebivel avulso (quickstart). */
function reconhecerMutacaoNr117(
  texto: string,
  today: string,
): Extract<LlmDecision, { type: 'tool' }> | undefined {
  const produto = reconhecerCreateProduct(texto)
  if (produto !== undefined) return produto
  const pagar = reconhecerCreatePayable(texto, today)
  if (pagar !== undefined) return pagar
  const receber = reconhecerCreateReceivable(texto, today)
  if (receber !== undefined) return receber
  return undefined
}

function reconhecerCreateProduct(
  texto: string,
): Extract<LlmDecision, { type: 'tool' }> | undefined {
  const match = texto.match(
    /^cadastr(?:a|ar)\s+(.+?)\s+custo\s+([\d.,]+)(?:\s+reais?)?\s*,?\s*vend(?:e|a)\s+([\d.,]+)\s*$/,
  )
  if (match === null) return undefined

  const description = match[1]!.replace(/,\s*$/, '').trim()
  const costPriceCents = reaisParaCentavos(match[2]!)
  const salePriceCents = reaisParaCentavos(match[3]!)
  if (costPriceCents === undefined || salePriceCents === undefined) return undefined

  const args = {
    description,
    unitOfMeasure: 'un' as const,
    costPriceCents,
    salePriceCents,
  }
  const parsed = createProductInputSchema.safeParse(args)
  if (!parsed.success) return undefined

  return { type: 'tool', name: 'create_product', args: parsed.data }
}

function reconhecerCreatePayable(
  texto: string,
  today: string,
): Extract<LlmDecision, { type: 'tool' }> | undefined {
  const match = texto.match(/^lanc(?:a|ar)\s+(\S+)\s+([\d.,]+)\s+vence\s+dia\s+(\d{1,2})\s*$/)
  if (match === null) return undefined

  const termo = match[1]!.trim()
  const amountCents = reaisParaCentavos(match[2]!)
  const dia = Number.parseInt(match[3]!, 10)
  if (amountCents === undefined || dia < 1 || dia > 31) return undefined

  const dueDate = vencimentoNoDia(dia, today)
  if (dueDate === undefined) return undefined

  const supplier = capitalizar(termo)
  const args = {
    supplier,
    description: supplier,
    amountCents,
    dueDate,
  }
  const parsed = createPayableInputSchema.safeParse(args)
  if (!parsed.success) return undefined

  return { type: 'tool', name: 'create_payable', args: parsed.data }
}

function reconhecerCreateReceivable(
  texto: string,
  today: string,
): Extract<LlmDecision, { type: 'tool' }> | undefined {
  const match = texto.match(/^a receber\s+([\d.,]+)\s+do\s+[^,]+,\s*(.+)\s*$/)
  if (match === null) return undefined

  const amountCents = reaisParaCentavos(match[1]!)
  const description = match[2]!.trim()
  if (amountCents === undefined || description.length < 2) return undefined

  const dueDate = /na sexta/.test(texto) ? proximaSextaIso(today) : undefined
  if (dueDate === undefined) return undefined

  const args = { description, amountCents, dueDate }
  const parsed = createReceivableInputSchema.safeParse(args)
  if (!parsed.success) return undefined

  return { type: 'tool', name: 'create_receivable', args: parsed.data }
}

function reaisParaCentavos(bruto: string): number | undefined {
  const t = bruto.trim().replace(/\s/g, '')
  if (!/^[\d.,]+$/.test(t)) return undefined

  if (t.includes(',')) {
    const [parteInteiraRaw, parteDecimal = '0'] = t.split(',')
    if (parteInteiraRaw === undefined) return undefined
    const parteInteira = parteInteiraRaw
    const dec = parteDecimal.padEnd(2, '0').slice(0, 2)
    const reais = Number.parseInt(parteInteira.replace(/\./g, ''), 10)
    const centavos = Number.parseInt(dec, 10)
    if (Number.isNaN(reais) || Number.isNaN(centavos)) return undefined
    return reais * 100 + centavos
  }

  const reais = Number.parseInt(t.replace(/\./g, ''), 10)
  if (Number.isNaN(reais)) return undefined
  return reais * 100
}

/** Proximo vencimento no dia N (mes atual se ainda nao passou, senao mes seguinte). */
function vencimentoNoDia(dia: number, today: string): string | undefined {
  const partes = today.split('-').map((p) => Number.parseInt(p, 10))
  if (partes.length !== 3 || partes.some((n) => Number.isNaN(n))) return undefined
  const [anoRaw, mesRaw, diaHojeRaw] = partes
  if (anoRaw === undefined || mesRaw === undefined || diaHojeRaw === undefined) return undefined
  const ano = anoRaw
  const mes = mesRaw
  const diaHoje = diaHojeRaw

  let mesAlvo = mes
  let anoAlvo = ano
  if (dia <= diaHoje) {
    mesAlvo += 1
    if (mesAlvo > 12) {
      mesAlvo = 1
      anoAlvo += 1
    }
  }

  const mm = String(mesAlvo).padStart(2, '0')
  const dd = String(dia).padStart(2, '0')
  const candidato = `${anoAlvo}-${mm}-${dd}`
  return createPayableInputSchema.shape.dueDate.safeParse(candidato).success ? candidato : undefined
}

function proximaSextaIso(today: string): string | undefined {
  const base = new Date(`${today}T12:00:00.000Z`)
  if (Number.isNaN(base.getTime())) return undefined
  const dow = base.getUTCDay()
  let add = (5 - dow + 7) % 7
  if (add === 0) add = 7
  base.setUTCDate(base.getUTCDate() + add)
  const iso = base.toISOString().slice(0, 10)
  return createReceivableInputSchema.shape.dueDate.safeParse(iso).success ? iso : undefined
}

function capitalizar(palavra: string): string {
  if (palavra.length === 0) return palavra
  return palavra.charAt(0).toUpperCase() + palavra.slice(1)
}

/** RF-149–151: certificado, OFX/conciliacao e nota avulsa — zero efeito. */
function reconhecerRecusa(texto: string): Extract<LlmDecision, { type: 'tool' }> | undefined {
  if (/certificado|\.pfx\b|\bpfx\b|emitente|senha.{0,24}(a1|cert)|a1.{0,24}senha/.test(texto)) {
    return { type: 'tool', name: 'refuse_certificate', args: {} }
  }
  if (
    /\bofx\b|open finance|concili(ar|acao)|import(ar|e|a)\b.{0,40}(extrato|ofx|csv|banco)|extrato.{0,24}(ofx|csv|banco|import)/.test(
      texto,
    )
  ) {
    return { type: 'tool', name: 'refuse_banking', args: {} }
  }
  if (
    /emit(e|ir|a)\b.{0,32}(nota|nfc-?e)|(nota|nfc-?e).{0,24}emit|cancela(r)?\b.{0,24}(nota|nfc-?e)/.test(
      texto,
    )
  ) {
    return { type: 'tool', name: 'refuse_invoice_command', args: {} }
  }
  return undefined
}
