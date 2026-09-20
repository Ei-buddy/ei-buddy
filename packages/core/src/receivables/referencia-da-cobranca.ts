/**
 * A referencia que vai ao provedor na cobranca a distancia — RF-068.
 *
 * ## Por que ela carrega a empresa
 *
 * O aviso de pagamento chega SEM contexto de tenant: e um POST do provedor,
 * nao requisicao de alguem logado. E a RLS recusa leitura sem tenant — entao,
 * para achar a cobranca, e preciso saber a empresa ANTES de consultar
 * qualquer coisa.
 *
 * As alternativas eram piores: uma funcao `SECURITY DEFINER` para mapear
 * referencia -> empresa acrescentaria superficie privilegiada para responder
 * algo que o proprio aviso pode carregar. Mesma decisao tomada na assinatura
 * (NR-063), e pelo mesmo motivo.
 *
 * O pedido entra junto porque a empresa sozinha nao serve: uma loja manda
 * varias cobrancas, e a referencia precisa identificar UMA.
 *
 * ## Duas funcoes, uma verdade
 *
 * Montar e ler moram no mesmo arquivo de proposito. Sao os dois lados de um
 * formato combinado, e um formato combinado escrito em dois lugares diverge
 * na primeira mudanca — aqui, divergir significa o pagamento entrar e a baixa
 * nao achar o titulo.
 */

const SEPARADOR = ':'

export function referenciaDaCobranca(companyId: string, requestId: string): string {
  return `${companyId}${SEPARADOR}${requestId}`
}

/**
 * A empresa dentro da referencia, ou `undefined` se nao houver.
 *
 * `undefined` para qualquer coisa fora do formato — inclusive referencia de
 * cobranca criada a mao no painel do provedor, que existe e nao e nossa.
 * Nunca lanca: quem chama e um webhook, e derrubar o processamento por causa
 * de um aviso alheio faria o provedor reentregar para sempre.
 */
export function empresaDaReferencia(referencia: string): string | undefined {
  const corte = referencia.indexOf(SEPARADOR)
  if (corte <= 0) return undefined

  const empresa = referencia.slice(0, corte)
  /* Precisa parecer um uuid. Sem esta conferencia, uma referencia qualquer com
     dois-pontos viraria um `app.company_id` invalido e o erro apareceria como
     falha de banco, longe daqui. */
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(empresa)
    ? empresa
    : undefined
}
