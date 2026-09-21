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
export function normalizarTelefoneDoCanal(bruto: string): string {
  const digitos = bruto.replace(/\D/g, '')
  /* 55 + DDD (2) + numero (8 ou 9). Menos que isso nao tem DDI na frente. */
  return digitos.length >= 12 && digitos.startsWith('55') ? digitos.slice(2) : digitos
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
  const telefone = normalizarTelefoneDoCanal(entrada.telefone)

  if (telefone === '') {
    return { status: 'silencio', motivo: 'Mensagem sem telefone de origem.' }
  }

  const vinculo = await deps.peers.porTelefone(telefone)

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
