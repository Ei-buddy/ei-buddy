/**
 * Busca de endereco por CEP — ADR-0008.
 *
 * Fecha um TODO que ja existia: `apps/web/src/lib/empresa-api.ts` documentava
 * a decisao de proxiar pelo backend (chave e cota do lado do servidor, cache,
 * troca de provedor sem tocar no front) mas a rota nunca foi implementada. A
 * geocodificacao veio primeiro pela busca de fornecedor por proximidade, que
 * precisa de latitude/longitude para ordenar — o resto do sistema pode
 * reaproveitar esta porta depois, para o autopreenchimento do formulario de
 * endereco.
 */
export type CepAddress = {
  readonly street: string | null
  readonly district: string | null
  readonly city: string | null
  readonly state: string | null
  /** Nulos quando o provedor nao tem cobertura de coordenada para o CEP. */
  readonly latitude: number | null
  readonly longitude: number | null
}

export type CepLookup = {
  /** `undefined` quando o CEP nao existe no provedor. So digitos, 8 caracteres. */
  lookup(cep: string): Promise<CepAddress | undefined>
}

/**
 * Coordenada pelo ENDERECO completo (rua, numero, cidade) — ADR-0008.
 *
 * O CEP sozinho e grosso: para muitos CEPs o provedor devolve o centro da
 * cidade, e duas lojas a 1,6 km apareciam a "0 km" na busca por proximidade
 * (achado do QA). Com rua e numero, a posicao e a da quadra.
 */
export type AddressGeocoder = {
  /** `undefined` quando nao achou — quem chama cai no CEP. */
  geocode(endereco: {
    readonly street: string
    readonly number?: string | undefined
    readonly city: string
    readonly state: string
  }): Promise<{ readonly latitude: number; readonly longitude: number } | undefined>
}
