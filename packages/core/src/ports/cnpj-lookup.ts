/**
 * Consulta de empresa por CNPJ.
 *
 * Irma de `CepLookup`, e pelo mesmo motivo: `apps/web/src/lib/empresa-api.ts`
 * documentava desde o inicio que a consulta tinha de passar pelo NOSSO backend
 * — chave e cota do lado do servidor, cache possivel, troca de provedor sem
 * tocar no front — mas devolvia sempre a mesma empresa de exemplo.
 *
 * O que vem daqui e SUGESTAO de preenchimento, nunca verdade cadastral: quem
 * decide o que fica gravado e o lojista, que ve os campos preenchidos e pode
 * corrigir qualquer um. Por isso quase tudo e anulavel — o provedor as vezes
 * tem a razao social e nao tem o resto.
 */
export type CnpjCompany = {
  /** Razao social. O unico campo que o provedor sempre traz quando acha o CNPJ. */
  readonly legalName: string
  /** Nome fantasia. Nulo e comum: muita empresa nao declarou nenhum. */
  readonly tradeName: string | null
  /** Descricao da atividade principal (CNAE), em texto — nao o codigo. */
  readonly mainActivity: string | null
  /** So digitos, 8 caracteres — quem formata e a tela. */
  readonly zipCode: string | null
  readonly street: string | null
  readonly streetNumber: string | null
  readonly district: string | null
  readonly city: string | null
  readonly state: string | null
  /**
   * Situacao cadastral em texto, como o provedor escreve ("ATIVA", "BAIXADA").
   *
   * Sai no resultado porque a tela precisa AVISAR: preencher o cadastro com os
   * dados de um CNPJ baixado e cadastrar uma empresa que nao existe mais. Nao
   * bloqueia nada — pode ser matriz baixada com filial ativa, e essa leitura e
   * do lojista, nao nossa.
   */
  readonly registrationStatus: string | null
}

export type CnpjLookup = {
  /** `undefined` quando o CNPJ nao existe no provedor. So digitos, 14 caracteres. */
  lookup(cnpj: string): Promise<CnpjCompany | undefined>
}
