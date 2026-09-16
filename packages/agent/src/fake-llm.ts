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
 * Interpretacao de venda, cadastro e cobranca NAO entra no reconhecedor: sem
 * modelo, o risco e executar a tool errada. Esses caminhos usam `script()`.
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
  }): Promise<LlmDecision> {
    const chave = normalizar(input.text)
    const roteiro = this.roteiros.get(chave)
    if (roteiro !== undefined) return roteiro

    const ids = new Set(input.tools.map((t) => t.id))
    const porPalavra = reconhecerConsulta(chave, input.today)
    if (porPalavra !== undefined && ids.has(porPalavra.name)) return porPalavra

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
  /* US-053 / US6: DRE do mes — faturamento, custo, despesas, resultado. */
  if (/resumo do mes|resultado do mes/.test(texto)) {
    const mes = mesDoDia(today)
    return { type: 'tool', name: 'period_summary', args: mes }
  }
  return undefined
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
