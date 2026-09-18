import type {
  Address,
  CompanyOutput,
  CustomerListItem,
  CustomerOutput,
  ProductOutput,
} from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'

/**
 * Portas dos repositorios de cadastro — RF-001 a RF-019.
 *
 * Declaradas aqui, implementadas por `db` — a seta aponta para dentro. Como em
 * `AppointmentRepository`, os tipos podem morar em `core` porque quem implementa
 * e `db`, e `db` tem permissao para importar `core`. As portas de adapter
 * (`fiscal`, `payments`, `whatsapp`) precisam dos tipos em `contracts` por causa
 * da regra `adapter-nao-importa-core`; esta nao.
 *
 * `companyId` aparece em toda assinatura por decisao, nao por descuido: o
 * isolamento nao pode depender de o chamador lembrar de filtrar. Quem implementa
 * aplica o filtro; quem chama nao tem como esquecer. No banco, a segunda
 * barreira e a politica de RLS (ADR-0001) — as duas juntas, porque uma so
 * depende de disciplina.
 */

/**
 * Geocodificada a partir do CEP — ADR-0008. `null` para limpar (CEP removido
 * ou sem cobertura), `undefined` para nao mexer (endereco nao mudou).
 */
export type CompanyCoordinates = { readonly latitude: number; readonly longitude: number } | null

export type NewCompany = {
  readonly legalName: string
  readonly tradeName?: string | undefined
  /** So digitos, ja normalizado por `contracts`. */
  readonly cnpj: string
  readonly email: string
  readonly phone: string
  /** Os fiscais, todos opcionais — MEI nao tem estadual, e a RF-001 nao pede. */
  readonly stateRegistration?: string | undefined
  readonly municipalRegistration?: string | undefined
  readonly businessSegment?: string | undefined
  readonly address?: Address | undefined
  /**
   * Nunca chega pela entrada da rota — `contracts` nao tem este campo em
   * lugar nenhum. Quem preenche e o caso de uso, depois de chamar
   * `CepLookup`, e so quando `address.zipCode` esta presente.
   */
  readonly coordinates?: CompanyCoordinates | undefined
  readonly createdAt: Date
}

/**
 * O que pode mudar depois de cadastrada.
 *
 * O CNPJ NAO esta aqui: trocar CNPJ e outra empresa, nao a mesma com outro
 * numero — as notas ja emitidas, os recebiveis e a trilha de auditoria
 * continuariam apontando para a anterior.
 *
 * Cada campo e opcional e `undefined` significa "nao mexa". Guardar
 * `undefined` como `null` apagaria a inscricao estadual de quem salvou a tela
 * de endereco sem tocar na aba fiscal.
 */
export type CompanyChanges = {
  readonly legalName?: string | undefined
  readonly tradeName?: string | undefined
  readonly email?: string | undefined
  readonly phone?: string | undefined
  readonly stateRegistration?: string | undefined
  readonly municipalRegistration?: string | undefined
  readonly businessSegment?: string | undefined
  readonly address?: Address | undefined
  /** Ver `NewCompany.coordinates`. */
  readonly coordinates?: CompanyCoordinates | undefined
}

export type CompanyRepository = {
  /**
   * Grava a empresa e devolve o que ficou gravado.
   *
   * O `id` e gerado por quem implementa, e nao recebido: a politica raiz de RLS
   * exige que a empresa nasca sob o proprio tenant, e quem sabe orquestrar isso
   * e `db` (ver packages/db/README.md#tabelas).
   */
  create(company: NewCompany): Promise<CompanyOutput>

  /**
   * Procura por CNPJ, sem escopo de empresa.
   *
   * E a unica consulta do sistema que atravessa tenants, e de proposito: um
   * CNPJ e uma empresa no pais inteiro, e RF-002 pede recusar o repetido. Por
   * isso devolve apenas se EXISTE — nunca a linha. Devolver os dados da
   * empresa existente vazaria razao social e endereco para quem so digitou um
   * numero.
   */
  cnpjTaken(cnpj: string): Promise<boolean>

  /**
   * A propria empresa — RF-003.
   *
   * `undefined` quando nao existe. Nao ha "de outra empresa" aqui: a politica
   * raiz de `companies` so deixa ver a linha do proprio tenant.
   */
  findById(companyId: CompanyId): Promise<CompanyOutput | undefined>

  /** Atualiza o cadastro e devolve o que ficou gravado — RF-003. */
  update(companyId: CompanyId, mudancas: CompanyChanges): Promise<CompanyOutput>
}

export type NewCustomer = {
  readonly companyId: CompanyId
  readonly name: string
  readonly document?: string | undefined
  readonly phone?: string | undefined
  readonly email?: string | undefined
  readonly notes?: string | undefined
  readonly walletLimitCents?: number | undefined
  readonly createdBy: UserId
  readonly createdAt: Date
  /**
   * O endereco, inteiro opcional — RF-009.
   *
   * Ate a migration 0019 nao havia onde guardar, e a tela descartava os sete
   * campos que pedia.
   */
  readonly address?: Address | undefined
}

export type CustomerRepository = {
  create(customer: NewCustomer): Promise<CustomerOutput>

  /** Um cliente. `undefined` quando nao existe OU e de outra empresa. */
  findById(companyId: CompanyId, customerId: string): Promise<CustomerOutput | undefined>

  /**
   * Procura cliente parecido por telefone ou documento — RF-010.
   *
   * Devolve os candidatos em vez de recusar o cadastro: a decisao de reusar o
   * existente e de quem esta no balcao, com o cliente na frente. Recusar
   * automaticamente travaria a venda de dois irmaos com o mesmo telefone de
   * casa, que acontece.
   */
  findSimilar(
    companyId: CompanyId,
    criteria: { readonly phone?: string | undefined; readonly document?: string | undefined },
  ): Promise<readonly CustomerOutput[]>

  /**
   * A lista da tela, paginada e com o historico de compra — RF-011.
   *
   * O historico vem na MESMA consulta. A tela mostra "ultima compra" em toda
   * linha, e busca-lo por cliente daria vinte e cinco idas ao banco para uma
   * pagina — o problema N+1 na sua forma mais cara, porque cresce com o
   * tamanho da tela.
   *
   * Devolve a pagina E o total que casa com o filtro. Sem o total, pagina cheia
   * e indistinguivel de fim da lista.
   */
  list(
    companyId: CompanyId,
    criterio: {
      readonly termo?: string
      readonly filtro: 'todos' | 'inativos' | 'fiado'
      /** Dias sem comprar que tornam o cliente inativo. Vem de `contracts`. */
      readonly diasParaInativo: number
      readonly hoje: Date
      readonly offset: number
      readonly limite: number
    },
  ): Promise<{ readonly clientes: readonly CustomerListItem[]; readonly total: number }>

  /**
   * Busca textual limitada para consulta conversacional de fiado — NR-115.
   *
   * Metodo proprio, e nao `list` com pagina 1: a lista traz historico de compra
   * e total, e aqui basta zero, um ou poucos candidatos distinguiveis.
   */
  search(
    companyId: CompanyId,
    criterio: { readonly termo?: string; readonly limite: number },
  ): Promise<readonly CustomerOutput[]>
}

export type NewProduct = {
  readonly companyId: CompanyId
  readonly description: string
  readonly barcode?: string | undefined
  /** Gerado por `core` quando nao ha codigo de barras — RF-019. */
  readonly internalCode: string
  readonly unitOfMeasure: ProductOutput['unitOfMeasure']
  readonly salePriceCents: number
  readonly costPriceCents: number
  readonly taxRate?: number | undefined
  readonly minStock: number
  readonly category?: string | undefined
  readonly supplier?: string | undefined
  readonly createdBy: UserId
  readonly createdAt: Date
  /* Fiscais — RF-046. Nulos ate o lojista informar. */
  readonly ncm: string | null
  readonly cfop: string | null
  readonly taxSituationCode: string | null
}

export type ProductRepository = {
  create(product: NewProduct): Promise<ProductOutput>

  /** Localiza pelo codigo de barras lido — RF-018. */
  findByBarcode(companyId: CompanyId, barcode: string): Promise<ProductOutput | undefined>

  /**
   * Um produto pelo id — RF-017.
   *
   * Separado de `findByBarcode` porque nem todo produto TEM codigo de barras:
   * granel, produto sem embalagem e etiqueta amassada usam o codigo interno, e
   * a ficha precisa abrir para eles tambem.
   *
   * `undefined` quando nao existe OU e de outra empresa.
   */
  findById(companyId: CompanyId, productId: string): Promise<ProductOutput | undefined>

  /**
   * Catalogo para o balcao — RF-019.
   *
   * O `termo` chega ate o SQL de proposito, ao contrario do valor na
   * conciliacao: aqui nao ha regra nenhuma para esconder, e filtrar em memoria
   * significaria carregar o catalogo inteiro a cada tecla digitada. Uma loja de
   * mercearia tem milhares de itens.
   *
   * Sem `deleted_at`: produto apagado nao se vende. O `limite` existe porque
   * a tela mostra uma lista, nao um banco de dados — quem nao achou refina a
   * busca, e devolver dez mil linhas so trava o navegador.
   */
  search(
    companyId: CompanyId,
    criterio: { readonly termo?: string; readonly limite: number },
  ): Promise<readonly ProductOutput[]>

  /**
   * O catalogo do backoffice, paginado — NR-072.
   *
   * Metodo proprio, e nao `search` com mais parametros. O `search` e a busca
   * do BALCAO: teto rigido, sem total, sem filtro de estoque, e o PDV depende
   * desse formato. Somar paginacao nele mudaria o contrato de quem ja usa.
   *
   * Devolve a pagina E o total que casa com o filtro. O total sai da mesma
   * chamada porque e o complemento da pagina: pedi-lo em separado varreria a
   * mesma tabela de novo, e entre as duas leituras um cadastro novo faria a
   * conta "23 de 300" deixar de fechar.
   */
  listCatalog(
    companyId: CompanyId,
    criterio: {
      readonly termo?: string
      readonly stock: 'todos' | 'baixo' | 'esgotado'
      readonly offset: number
      readonly limite: number
    },
  ): Promise<{ readonly produtos: readonly ProductOutput[]; readonly total: number }>

  /**
   * Os numeros do topo da tela, sobre o catalogo INTEIRO.
   *
   * Nao sao somaveis a partir da pagina: "valor em estoque" calculado sobre 24
   * de 300 produtos da um numero que parece certo e erra por um fator de doze
   * — e o lojista decide compra com ele.
   */
  catalogSummary(companyId: CompanyId): Promise<{
    readonly total: number
    readonly belowMinimum: number
    readonly outOfStock: number
    readonly stockValueCents: number
  }>

  /**
   * Quantos produtos a empresa tem, para gerar o proximo codigo interno.
   *
   * Contagem, e nao "proximo codigo": gerar o codigo e regra (o formato), e
   * regra mora em `core`. O repositorio informa o fato.
   */
  countAll(companyId: CompanyId): Promise<number>

  /**
   * Categoria e fornecedor ja usados por algum produto — as sugestoes do
   * formulario de cadastro.
   *
   * Distintos e ordenados: e a mesma lista que `CampoTag` mostra como opcao,
   * e uma lista fora de ordem faria a sugestao pular a cada letra digitada.
   */
  listSuggestions(companyId: CompanyId): Promise<{
    readonly categories: readonly string[]
    readonly suppliers: readonly string[]
  }>
}
