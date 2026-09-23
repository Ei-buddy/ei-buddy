import type { ExecutionContext } from '../context.js'
import type { PeerDirectory } from '../ports/peer-directory.js'

export type AbrirCanalDeps = {
  readonly peers: PeerDirectory
}

/**
 * O que fazer com uma mensagem que chegou pelo WhatsApp — RF-094, RF-095.
 *
 * Duas respostas, e so duas: um contexto para trabalhar, ou silencio.
 */
export type ResultadoDaBarragem =
  | { readonly status: 'autorizado'; readonly ctx: ExecutionContext }
  /**
   * Nada e respondido. Nem "voce nao tem acesso", nem "numero nao cadastrado".
   *
   * A RF-095 pede ignorar "sem executar acao nem revelar informacao", e a
   * segunda metade e a que costuma ser esquecida: responder "numero nao
   * cadastrado" confirma, para quem esta sondando, que OUTROS numeros estao.
   * Com isso da para descobrir o celular da dona da loja tentando de um em um.
   */
  | { readonly status: 'silencio'; readonly motivo: string }

/**
 * Normaliza o telefone para o formato do cadastro — NR-113.
 *
 * O provedor entrega `5541999998888`, a tela de cadastro guarda o que a pessoa
 * digitou. So os digitos sobrevivem dos dois lados; o `55` do Brasil cai
 * quando vier na frente de um numero que ja tem DDD, porque `users.phone`
 * guarda sem ele.
 *
 * Isto e mecanica de PROVEDOR, e por isso mora aqui e nao na porta: o dia em
 * que entrar um segundo canal, ele traz o proprio formato e esta funcao ganha
 * um irmao — em vez de a porta ganhar um `if`.
 */
function digitosDoCanal(bruto: string): string {
  return bruto.replace(/\D/g, '')
}

/** Nacional sem DDI `55` — so quando sobram 12+ digitos (nao confundir DDD 55). */
function nacionalSemDdi(digitos: string): string {
  return digitos.length >= 12 && digitos.startsWith('55') ? digitos.slice(2) : digitos
}

/** O 9 entra depois do DDD so no nacional de 10 digitos cujo primeiro digito do assinante e 6, 7, 8 ou 9. */
function movelNacionalDe10(nacional: string): boolean {
  return nacional.length === 10 && '6789'.includes(nacional[2] ?? '')
}

function celularCanonicoDe10(nacional10: string): string {
  const ddd = nacional10.slice(0, 2)
  const primeiroAssinante = nacional10[2] ?? ''
  /* Assinante ja comeca em 9: o nono digito entra depois desse 9 (ex. DDD 55). */
  if (primeiroAssinante === '9') {
    return `${nacional10.slice(0, 3)}9${nacional10.slice(3)}`
  }
  return `${ddd}9${nacional10.slice(2)}`
}

function celularLegadoDe11(canonico11: string): string | undefined {
  if (canonico11.length !== 11 || canonico11[2] !== '9') {
    return undefined
  }
  if (canonico11[3] === '9' && '6789'.includes(canonico11[4] ?? '')) {
    return `${canonico11.slice(0, 3)}${canonico11.slice(4)}`
  }
  if ('6789'.includes(canonico11[3] ?? '')) {
    return `${canonico11.slice(0, 2)}${canonico11.slice(3)}`
  }
  return undefined
}

export function normalizarTelefoneDoCanal(bruto: string): string {
  const nacional = nacionalSemDdi(digitosDoCanal(bruto))
  if (nacional === '') {
    return ''
  }
  if (nacional.length === 11) {
    return nacional
  }
  if (movelNacionalDe10(nacional)) {
    return celularCanonicoDe10(nacional)
  }
  return nacional
}

/**
 * Chaves para `porTelefone`, canônica primeiro e legada depois (só móvel).
 * Valor calculado — ver data-model NR-046, seção Celular canônico.
 */
export function chavesConsultaTelefoneDoCanal(bruto: string): readonly string[] {
  const nacional = nacionalSemDdi(digitosDoCanal(bruto))
  if (nacional === '') {
    return []
  }

  if (nacional.length === 11) {
    const legado = celularLegadoDe11(nacional)
    return legado === undefined ? [nacional] : [nacional, legado]
  }

  if (movelNacionalDe10(nacional)) {
    const canonico = celularCanonicoDe10(nacional)
    return [canonico, nacional]
  }

  return [nacional]
}

/**
 * A barragem do canal — RF-094, RF-095, ADR-0012.
 *
 * ## Por que o contexto nasce aqui, e nao na rota
 *
 * `ExecutionContext` e o que carrega `companyId` para a RLS e o papel para a
 * autorizacao. Monta-lo na rota espalharia por cada canal novo a decisao de
 * quem pode o que — e um canal que esquecesse o `role` abriria escrita para
 * quem so podia ler.
 *
 * ## `owner`, sempre
 *
 * O vinculo so existe para owner (ponto 4 da ADR-0012, e o filtro esta na
 * propria funcao SQL). O papel no contexto reflete isso em vez de ser
 * adivinhado.
 *
 * ## O canal e `whatsapp`
 *
 * E o que a auditoria vai registrar. Dizer `app` aqui faria a trilha mentir
 * sobre de onde veio cada acao — e a trilha e o que se consulta quando algo
 * nao bate.
 */
export async function abrirCanal(
  deps: AbrirCanalDeps,
  entrada: {
    readonly telefone: string
    readonly requestId: string
    readonly agora: Date
  },
): Promise<ResultadoDaBarragem> {
  const chaves = chavesConsultaTelefoneDoCanal(entrada.telefone)

  if (chaves.length === 0) {
    return { status: 'silencio', motivo: 'Mensagem sem telefone de origem.' }
  }

  let vinculo: Awaited<ReturnType<PeerDirectory['porTelefone']>> = undefined
  for (const chave of chaves) {
    vinculo = await deps.peers.porTelefone(chave)
    if (vinculo !== undefined) {
      break
    }
  }

  if (vinculo === undefined) {
    return { status: 'silencio', motivo: 'Numero sem vinculo com loja nenhuma.' }
  }

  return {
    status: 'autorizado',
    ctx: {
      companyId: vinculo.companyId,
      userId: vinculo.userId,
      role: 'owner',
      channel: 'whatsapp',
      requestId: entrada.requestId,
      now: entrada.agora,
    },
  }
}
