/**
 * Quem opera o canal — RF-094, RF-095, ADR-0012, NR-113.
 *
 * O webhook do WhatsApp traz um numero e nada mais: sem cookie, sem Bearer,
 * sem empresa. Esta porta responde a unica pergunta que permite continuar —
 * "de qual loja e este chip, e quem e a pessoa?" — e responde `undefined`
 * quando nao ha vinculo.
 *
 * ## `undefined` nao e erro
 *
 * E o caso COMUM: qualquer pessoa pode mandar mensagem para o numero da loja.
 * A RF-095 manda ignorar em silencio — sem executar acao e sem revelar
 * informacao, inclusive sem revelar que o numero nao esta cadastrado. Lancar
 * aqui faria o caminho normal passar por `catch`.
 *
 * ## O numero nao e identidade forte
 *
 * A ADR-0002 continua valendo: chip se perde, se clona e se porta. Este
 * vinculo autoriza CONSULTA e acao com confirmacao no canal; operacao
 * privilegiada continua exigindo sessao do aplicativo.
 */
export type VinculoDoCanal = {
  readonly companyId: string
  readonly userId: string
}

export type PeerDirectory = {
  /**
   * O vinculo do numero, se houver.
   *
   * O telefone chega como o provedor manda. Normalizar e de quem chama — o
   * formato varia por provedor, e esta porta nao deve conhecer nenhum.
   */
  porTelefone(phone: string): Promise<VinculoDoCanal | undefined>
}
