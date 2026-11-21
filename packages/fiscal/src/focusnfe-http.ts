import { ErroDeIntegracao } from '@na-regua/contracts'

/**
 * A chamada HTTP a Focus NFe, comum a NFC-e e a NFS-e nacional — NR-240.
 *
 * Saiu do emissor de NFC-e quando a NFS-e chegou: as duas falam com o mesmo
 * provedor, com a mesma autenticacao e o mesmo jeito de falhar, e duas copias
 * disto divergiriam na primeira correcao.
 */

/**
 * Basic com senha vazia — `Base64("token:")`.
 *
 * Os dois pontos sem nada depois sao intencionais e estao na documentacao.
 * Omiti-los muda o token e a autenticacao falha com uma mensagem que nao
 * explica nada.
 */
export const autorizacaoFocus = (token: string): string =>
  `Basic ${Buffer.from(`${token}:`, 'utf8').toString('base64')}`

/**
 * A referencia (`ref`) de uma nota na Focus: so letras e numeros.
 *
 * A Focus pede que a referencia fique em letras e numeros, sem caracteres
 * especiais (`docs/arquitetura/integracoes/focusnfe.md`, "Referencia"), e o
 * nosso id e um UUID com hifens. Tirar os hifens nao cria colisao: o que sobra
 * continua unico.
 */
export function referenciaFocus(id: string, sufixo = ''): string {
  return `${id.replace(/[^A-Za-z0-9]/g, '')}${sufixo}`
}

export type ChamadaFocus = (
  caminho: string,
  init: { method: string; token: string; body?: unknown },
) => Promise<{ status: number; corpo: Record<string, unknown> }>

export function criarChamadaFocus(opcoes: {
  /** `https://homologacao.focusnfe.com.br` ou `https://api.focusnfe.com.br`, sem `/v2`. */
  readonly base: string
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs: number
}): ChamadaFocus {
  const buscar = opcoes.fetch ?? globalThis.fetch

  return async function chamar(caminho, init) {
    const controle = new AbortController()
    const relogio = setTimeout(() => controle.abort(), opcoes.timeoutMs)

    try {
      const resposta = await buscar(`${opcoes.base}/v2${caminho}`, {
        method: init.method,
        headers: {
          authorization: autorizacaoFocus(init.token),
          'content-type': 'application/json',
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: controle.signal,
      })

      const texto = await resposta.text()

      /*
       * Corpo ilegivel e falha de INFRAESTRUTURA, e por isso lanca: a porta diz
       * que so infraestrutura lanca, e "o provedor respondeu HTML de erro" e
       * exatamente isso. Traduzir para rejeicao faria o job desistir de uma nota
       * que talvez tenha sido autorizada do outro lado.
       */
      let corpo: Record<string, unknown>
      try {
        corpo = texto === '' ? {} : (JSON.parse(texto) as Record<string, unknown>)
      } catch {
        throw new ErroDeIntegracao(
          `Focus NFe respondeu ${resposta.status} com corpo ilegivel em ${caminho}.`,
          {
            provedor: 'focusnfe',
            operacao: `${init.method} ${caminho}`,
            status: resposta.status,
            resposta: texto,
          },
        )
      }

      return { status: resposta.status, corpo }
    } finally {
      clearTimeout(relogio)
    }
  }
}
