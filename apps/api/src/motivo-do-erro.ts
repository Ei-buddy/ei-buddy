/**
 * O motivo legivel de um erro, para o campo `motivo` dos avisos.
 *
 * ## Por que nao basta `erro.message`
 *
 * `AggregateError` tem `message` VAZIA. O ioredis lanca exatamente isso quando
 * nao consegue conectar — um `AggregateError [ECONNREFUSED]` cujos detalhes
 * moram em `errors`, um por endereco tentado.
 *
 * O resultado era que todo aviso de indisponibilidade imprimia a razao em
 * branco, justamente quando alguem precisava dela:
 *
 *   {"msg":"redis indisponivel — limite cai para memoria","motivo":""}
 *   {"msg":"fila de whatsapp indisponivel","motivo":""}
 *   {"msg":"fila de emissao indisponivel","motivo":""}
 *
 * Tres avisos escritos com cuidado, dizendo nada. E logo abaixo o Node
 * despejava o `AggregateError` cru com vinte e cinco linhas de pilha — a
 * informacao existia, so nao estava onde o aviso prometia.
 *
 * ## O que sai daqui
 *
 * A mensagem, quando ha uma. Senao, as mensagens dos erros agregados, sem
 * repetir: as duas tentativas de conexao (IPv6 e IPv4) dizem a mesma coisa
 * duas vezes, e "connect ECONNREFUSED ::1:6379; connect ECONNREFUSED
 * 127.0.0.1:6379" cansa sem informar mais que a primeira metade.
 *
 * Em ultimo caso o NOME do erro — `AggregateError` sozinho ja e mais util que
 * string vazia, porque diz que houve erro e de que tipo.
 */
export function motivoDoErro(erro: unknown): string {
  if (!(erro instanceof Error)) return String(erro)

  if (erro.message !== '') return erro.message

  if (erro instanceof AggregateError && Array.isArray(erro.errors)) {
    const motivos = [
      ...new Set(
        erro.errors.map((e: unknown) =>
          e instanceof Error ? (e.message !== '' ? e.message : e.name) : String(e),
        ),
      ),
    ]
    if (motivos.length > 0) return motivos.join('; ')
  }

  /* `code` do Node (ECONNREFUSED, ENOTFOUND) quando nao ha mensagem nenhuma:
     e o que um AggregateError sem `errors` ainda costuma carregar. */
  const codigo = (erro as { code?: unknown }).code
  if (typeof codigo === 'string' && codigo !== '') return `${erro.name}: ${codigo}`

  return erro.name
}
