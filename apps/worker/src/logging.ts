/**
 * Log estruturado do worker — NR-030.
 *
 * O worker nao tem requisicao HTTP, entao o que correlaciona aqui e o job:
 * fila, id e tentativa. Sem isso, uma falha que so acontece na terceira
 * tentativa e indistinguivel de tres falhas diferentes.
 */

import { ehErroDeIntegracao } from '@na-regua/contracts'

export type Level = 'debug' | 'info' | 'warn' | 'error'

/**
 * URL de conexao NUNCA vai inteira para o log.
 *
 * `REDIS_URL` e `DATABASE_URL` sao marcadas como segredo em ambientes.md e
 * carregam usuario e senha no proprio texto (`redis://user:senha@host`).
 * Logar "conectado a redis://..." publica a credencial em qualquer lugar que
 * agregue log — RNF-022.
 */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.hostname}:${u.port || '(padrao)'}`
  } catch {
    /* Nao parseou: melhor omitir do que arriscar imprimir credencial. */
    return '[url invalida]'
  }
}

export function log(level: Level, msg: string, extra: Record<string, unknown> = {}): void {
  const linha = JSON.stringify({
    level,
    service: 'worker',
    time: new Date().toISOString(),
    msg,
    ...extra,
  })

  if (level === 'error') {
    console.error(linha)
    return
  }
  console.log(linha)
}

/**
 * O que a falha de um job leva para o log — RF-129, US-064.
 *
 * A mensagem sozinha nao resolve chamado: "o Asaas nao devolveu id da
 * cobranca" sem o que o Asaas respondeu manda alguem pedir print ao cliente.
 * Erro de integracao leva provedor, operacao, status e o trecho da resposta.
 *
 * `ref` e a venda (ou a mensagem) do job: e o mesmo id que aparece na URL da
 * requisicao que pediu a emissao, e e por ele que o log da api encontra o do
 * worker.
 */
export function camposDaFalha(erro: Error, dados: unknown): Record<string, unknown> {
  const d = (dados ?? {}) as Record<string, unknown>
  const ref = typeof d.saleId === 'string' ? d.saleId : typeof d.id === 'string' ? d.id : undefined
  return {
    /* Mensagem, nunca a stack: log agregado nao ganha nada com ela. */
    error: erro.message,
    ...(ref === undefined ? {} : { ref }),
    ...(ehErroDeIntegracao(erro) ? { integracao: erro.detalhes() } : {}),
  }
}
