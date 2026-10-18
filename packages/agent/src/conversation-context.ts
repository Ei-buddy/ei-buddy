/**
 * O que a conversa sabe sem mostrar — RF-105, ADR-0016.
 *
 * Cada turno do Buddy grava em `messages.tool_calls` um snapshot com as
 * entidades tocadas e a intenção em andamento. O resumo enviado ao modelo é
 * derivado da janela ativa (até 12 mensagens, corte de 2 h): sem tabela nova,
 * e o corte de inatividade zera o resumo junto com a janela.
 */

export type TipoDeEntidade =
  'cliente' | 'produto' | 'venda' | 'conta_a_pagar' | 'recebivel' | 'compromisso'

export type EntidadeDaConversa = {
  readonly tipo: TipoDeEntidade
  /** Id interno. Vai ao modelo para as próximas chamadas; nunca à dona. */
  readonly ref: string
  readonly rotulo: string
}

export type IntencaoEmAndamento = {
  readonly acao: string
  readonly jaDito: Readonly<Record<string, unknown>>
  readonly aguardando: 'cadastro_cliente' | 'cadastro_produto' | 'dados' | 'escolha'
  readonly descricao: string
}

export type SnapshotDeTurno = {
  readonly v: 2
  readonly entidades: readonly EntidadeDaConversa[]
  readonly intencao?: IntencaoEmAndamento
  readonly propostaId?: string
}

export type ResumoDeEntidades = {
  readonly entidades: readonly EntidadeDaConversa[]
  readonly intencao?: IntencaoEmAndamento
}

export const RESUMO_VAZIO: ResumoDeEntidades = { entidades: [] }

const TIPOS = new Set<string>([
  'cliente',
  'produto',
  'venda',
  'conta_a_pagar',
  'recebivel',
  'compromisso',
])

const AGUARDANDO = new Set<string>(['cadastro_cliente', 'cadastro_produto', 'dados', 'escolha'])

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function lerEntidade(v: unknown): EntidadeDaConversa | undefined {
  if (!ehObjeto(v)) return undefined
  const { tipo, ref, rotulo } = v
  if (typeof tipo !== 'string' || !TIPOS.has(tipo)) return undefined
  if (typeof ref !== 'string' || ref === '') return undefined
  if (typeof rotulo !== 'string' || rotulo.trim() === '') return undefined
  return { tipo: tipo as TipoDeEntidade, ref, rotulo }
}

function lerIntencao(v: unknown): IntencaoEmAndamento | undefined {
  if (!ehObjeto(v)) return undefined
  const { acao, jaDito, aguardando, descricao } = v
  if (typeof acao !== 'string' || acao === '') return undefined
  if (typeof aguardando !== 'string' || !AGUARDANDO.has(aguardando)) return undefined
  if (typeof descricao !== 'string' || descricao === '') return undefined
  return {
    acao,
    jaDito: ehObjeto(jaDito) ? jaDito : {},
    aguardando: aguardando as IntencaoEmAndamento['aguardando'],
    descricao,
  }
}

/**
 * Snapshot v2, ou `undefined`. O formato v1 (`{ customerId?, saleId?, productId? }`)
 * não tinha rótulo legível, então não alimenta o resumo.
 */
export function lerSnapshot(toolCalls: unknown): SnapshotDeTurno | undefined {
  if (!ehObjeto(toolCalls) || toolCalls.v !== 2) return undefined
  const entidades = Array.isArray(toolCalls.entidades)
    ? toolCalls.entidades.map(lerEntidade).filter((e): e is EntidadeDaConversa => e !== undefined)
    : []
  const intencao = lerIntencao(toolCalls.intencao)
  const propostaId = typeof toolCalls.propostaId === 'string' ? toolCalls.propostaId : undefined
  return {
    v: 2,
    entidades,
    ...(intencao === undefined ? {} : { intencao }),
    ...(propostaId === undefined ? {} : { propostaId }),
  }
}

/** A intenção vale só se o snapshot mais recente a carrega. */
export function montarResumoDeEntidades(
  janela: readonly { readonly toolCalls?: unknown }[],
): ResumoDeEntidades {
  const porChave = new Map<string, EntidadeDaConversa>()
  let intencao: IntencaoEmAndamento | undefined

  for (const mensagem of janela) {
    const snapshot = lerSnapshot(mensagem.toolCalls)
    if (snapshot === undefined) continue
    for (const e of snapshot.entidades) {
      const chave = `${e.tipo}:${e.ref}`
      porChave.delete(chave)
      porChave.set(chave, e)
    }
    intencao = snapshot.intencao
  }

  return {
    entidades: [...porChave.values()],
    ...(intencao === undefined ? {} : { intencao }),
  }
}

const NOME_DO_TIPO: Record<TipoDeEntidade, string> = {
  cliente: 'cliente',
  produto: 'produto',
  venda: 'venda',
  conta_a_pagar: 'conta a pagar',
  recebivel: 'recebível',
  compromisso: 'compromisso',
}

const NOME_DO_AGUARDANDO: Record<IntencaoEmAndamento['aguardando'], string> = {
  cadastro_cliente: 'aguardando o cadastro do cliente',
  cadastro_produto: 'aguardando o cadastro do produto',
  dados: 'aguardando dados que faltam',
  escolha: 'aguardando a escolha entre opções',
}

/** Mensagem de sistema com o resumo. Vazio quando não há o que lembrar. */
export function resumoComoTexto(resumo: ResumoDeEntidades): string {
  if (resumo.entidades.length === 0 && resumo.intencao === undefined) return ''

  const linhas = [
    'Contexto desta conversa (uso interno: use os códigos [ref] nas ferramentas e nunca mostre os códigos à dona):',
    ...resumo.entidades.map((e) => `- ${NOME_DO_TIPO[e.tipo]}: ${e.rotulo} [ref: ${e.ref}]`),
  ]
  if (resumo.intencao !== undefined) {
    const i = resumo.intencao
    linhas.push(
      `Pedido em andamento: ${i.descricao} (${NOME_DO_AGUARDANDO[i.aguardando]}). ` +
        `Já dito: ${JSON.stringify(i.jaDito)}. Retome esse pedido quando o que falta chegar.`,
    )
  }
  return linhas.join('\n')
}
