/**
 * Consulta a tabela oficial de NCM — RF-046, Topico 6 do TXT ("validar a
 * existencia do NCM").
 *
 * Tres respostas, e nao duas: "nao existe" e "nao deu para perguntar" levam a
 * decisoes opostas. O primeiro recusa o cadastro — o NCM digitado nao sai em
 * nota nenhuma. O segundo deixa passar: travar o balcao porque um provedor de
 * terceiro caiu seria pior que aceitar um codigo que a emissao ainda confere.
 */
export type NcmConsulta =
  | { readonly status: 'existe'; readonly descricao: string }
  | { readonly status: 'inexistente' }
  | { readonly status: 'indisponivel' }

export type NcmLookup = {
  /** So digitos, 8 caracteres. */
  consultar(ncm: string): Promise<NcmConsulta>
}
