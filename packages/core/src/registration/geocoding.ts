import type { Address } from '@na-regua/contracts'
import type { AddressGeocoder, CepLookup } from '../ports/cep-lookup.js'
import type { CompanyCoordinates } from '../ports/registration-repositories.js'

/**
 * Resolve a coordenada de um endereco, para a busca de fornecedor por
 * proximidade — ADR-0008.
 *
 * `undefined` quando nao ha CEP para geocodificar (endereco ausente ou sem
 * `zipCode`) — o chamador NAO deve escrever nada nesse caso, para nao apagar
 * uma coordenada ja resolvida por um CEP anterior enquanto outro campo do
 * endereco muda. `null` quando ha CEP mas o provedor nao devolveu coordenada
 * — aí sim e uma limpeza deliberada, porque o CEP mudou para um sem cobertura.
 *
 * Uma falha no provedor (rede fora, CEP invalido) NUNCA impede o resto do
 * cadastro de salvar — ela vira `undefined`, como se o CEP nao tivesse
 * mudado. A empresa fica sem coordenada nova ate a proxima edicao bem
 * sucedida; nao aparecer na busca por proximidade e um custo bem menor que
 * travar o cadastro por causa de um servico de terceiro fora do ar.
 */
export async function resolveCoordinates(
  cepLookup: CepLookup,
  address: Address | undefined,
  /**
   * Opcional: com ele, a coordenada sai do endereco completo, e o CEP so entra
   * se o endereco nao for achado. Ver `AddressGeocoder`.
   */
  geocoder?: AddressGeocoder,
): Promise<CompanyCoordinates | undefined> {
  if (address?.zipCode === undefined) return undefined

  if (geocoder !== undefined && address.street && address.city && address.state) {
    const pelaRua = await geocoder
      .geocode({
        street: address.street,
        number: address.number,
        city: address.city,
        state: address.state,
      })
      .catch(() => undefined)
    if (pelaRua !== undefined) return pelaRua
  }

  const encontrado = await cepLookup.lookup(address.zipCode).catch(() => undefined)
  if (encontrado === undefined) return undefined

  if (encontrado.latitude === null || encontrado.longitude === null) return null

  return { latitude: encontrado.latitude, longitude: encontrado.longitude }
}
