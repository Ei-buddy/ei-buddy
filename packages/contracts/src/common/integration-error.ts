/**
 * Falha de integracao com provedor externo — RF-129, US-064.
 *
 * Quem investiga um chamado ("a nota nao saiu", "a cobranca nao foi") precisa
 * achar o erro e ver O QUE O PROVEDOR RESPONDEU, sem pedir print ao cliente.
 * Um `Error` com so a mensagem perdia a resposta: o log dizia "o Asaas nao
 * devolveu id da cobranca" e o motivo real ficava no corpo jogado fora.
 *
 * Vive em `contracts` porque todos os adaptadores (fiscal, pagamento, cobranca,
 * WhatsApp) ja dependem dele, e o log da api e do worker leem o mesmo formato.
 *
 * Nao e regra de negocio: e o envelope de uma falha de INFRAESTRUTURA. Recusa
 * esperada (cartao recusado, numero sem WhatsApp) continua sendo resultado, nao
 * excecao.
 */

/** O bastante para o motivo; pouco o bastante para nao inflar o log. */
export const LIMITE_DA_RESPOSTA = 1000

/** A resposta do provedor como texto curto, pronto para o log. */
export function resumirResposta(resposta: unknown): string {
  let texto: string
  if (typeof resposta === 'string') texto = resposta
  else {
    try {
      texto = JSON.stringify(resposta) ?? ''
    } catch {
      texto = String(resposta)
    }
  }
  texto = texto.trim()
  return texto.length > LIMITE_DA_RESPOSTA ? `${texto.slice(0, LIMITE_DA_RESPOSTA)}…` : texto
}

export type DetalhesDaIntegracao = {
  readonly provedor: string
  readonly operacao: string
  /** HTTP devolvido pelo provedor; nulo quando nem houve resposta. */
  readonly status: number | null
  /** Trecho do corpo devolvido, ja resumido. */
  readonly resposta: string
}

export class ErroDeIntegracao extends Error {
  readonly provedor: string
  readonly operacao: string
  readonly status: number | null
  readonly resposta: string

  constructor(
    mensagem: string,
    detalhes: { provedor: string; operacao: string; status?: number | null; resposta?: unknown },
  ) {
    super(mensagem)
    this.name = 'ErroDeIntegracao'
    this.provedor = detalhes.provedor
    this.operacao = detalhes.operacao
    this.status = detalhes.status ?? null
    this.resposta = detalhes.resposta === undefined ? '' : resumirResposta(detalhes.resposta)
  }

  /** O que vai para o log, sem a stack. */
  detalhes(): DetalhesDaIntegracao {
    return {
      provedor: this.provedor,
      operacao: this.operacao,
      status: this.status,
      resposta: this.resposta,
    }
  }
}

/**
 * Por `name`, e nao so `instanceof`: o erro pode atravessar uma copia diferente
 * do pacote (bundle do worker, fila), e `instanceof` falharia em silencio.
 */
export function ehErroDeIntegracao(erro: unknown): erro is ErroDeIntegracao {
  return (
    erro instanceof ErroDeIntegracao ||
    (erro instanceof Error &&
      erro.name === 'ErroDeIntegracao' &&
      typeof (erro as Partial<ErroDeIntegracao>).provedor === 'string')
  )
}
