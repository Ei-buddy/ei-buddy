import { randomUUID } from 'node:crypto'
import type { CompanyOutput, CustomerOutput, ProductOutput } from '@na-regua/contracts'
import type {
  CompanyChanges,
  CompanyRepository,
  CustomerRepository,
  NewCompany,
  NewCustomer,
  NewProduct,
  ProductRepository,
} from '@na-regua/core'
import type { Sql } from 'postgres'
import { withPlatformScope, withTenant } from './tenant.js'

/**
 * Repositorios de cadastro — NR-026, RF-001 a RF-019.
 *
 * `bigint` volta como STRING no postgres.js, de proposito, para nao perder
 * precisao acima de 2^53. As portas declaram `number`, e um valor em string
 * entrando num calculo estoura com "Cannot mix BigInt and other types" — a CI
 * ja mostrou isso no repositorio de vendas. A conversao acontece na BORDA.
 */
const numero = (valor: unknown): number => Number(valor)

type LinhaEmpresa = {
  id: string
  legal_name: string
  trade_name: string | null
  cnpj: string
  email: string
  phone: string
  tax_regime: string
  is_active: boolean
  state_registration: string | null
  municipal_registration: string | null
  business_segment: string | null
  postal_code: string | null
  street: string | null
  street_number: string | null
  complement: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  created_at: Date
}

/**
 * O endereco de qualquer linha de cadastro.
 *
 * Um mapeador so para `companies` e `customers`: as colunas tem o mesmo nome
 * nas duas de proposito (migration 0019), e escrever a conversao duas vezes
 * abriria espaco para uma esquecer um campo — o tipo de defeito que aparece
 * como "o complemento some quando salvo por esta tela e nao pela outra".
 */
const paraEndereco = (l: {
  postal_code: string | null
  street: string | null
  street_number: string | null
  complement: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
}) => ({
  zipCode: l.postal_code,
  street: l.street,
  number: l.street_number,
  complement: l.complement,
  district: l.neighborhood,
  city: l.city,
  state: l.state,
})

const paraEmpresa = (l: LinhaEmpresa): CompanyOutput => ({
  id: l.id,
  legalName: l.legal_name,
  /* O contrato pede `string`, a coluna aceita nulo: quem nao informou nome
     fantasia opera com a razao social, e e isso que a tela mostra. */
  tradeName: l.trade_name ?? l.legal_name,
  cnpj: l.cnpj,
  email: l.email,
  phone: l.phone,
  address: paraEndereco(l),
  stateRegistration: l.state_registration,
  municipalRegistration: l.municipal_registration,
  businessSegment: l.business_segment,
  createdAt: l.created_at.toISOString(),
})

export function createCompanyRepository(sql: Sql): CompanyRepository {
  return {
    create: async (c: NewCompany) => {
      /*
       * O id e gerado AQUI e passado no INSERT, e nao deixado para o
       * `DEFAULT gen_random_uuid()`.
       *
       * A politica raiz de `companies` e `WITH CHECK (id = current_company_id())`:
       * para inserir, o tenant do contexto ja precisa ser o id da linha. Com o
       * id vindo do default, nao haveria o que colocar em `app.company_id`
       * antes de inserir — o INSERT seria recusado pela propria politica que
       * protege a tabela. Ver packages/db/README.md#tabelas.
       */
      const id = randomUUID()

      const [linha] = await withTenant(
        sql,
        id,
        (tx) => tx<LinhaEmpresa[]>`
          INSERT INTO companies
            (id, legal_name, trade_name, cnpj, email, phone,
             state_registration, municipal_registration, business_segment,
             postal_code, street, street_number, complement, neighborhood, city, state,
             latitude, longitude,
             created_at)
          VALUES (${id}, ${c.legalName}, ${c.tradeName ?? null}, ${c.cnpj},
                  ${c.email}, ${c.phone},
                  ${c.stateRegistration ?? null}, ${c.municipalRegistration ?? null},
                  ${c.businessSegment ?? null},
                  ${c.address?.zipCode ?? null}, ${c.address?.street ?? null},
                  ${c.address?.number ?? null}, ${c.address?.complement ?? null},
                  ${c.address?.district ?? null}, ${c.address?.city ?? null},
                  ${c.address?.state ?? null},
                  ${c.coordinates?.latitude ?? null}, ${c.coordinates?.longitude ?? null},
                  ${c.createdAt})
          RETURNING *
        `,
      )
      return paraEmpresa(linha!)
    },

    /*
     * A UNICA consulta do sistema que atravessa tenants, e por isso usa
     * `withPlatformScope` — nomeado assim para quem le ver uma excecao
     * consciente, e nao um esquecimento.
     *
     * Devolve booleano, nunca a linha: RF-002 pede recusar CNPJ repetido "sem
     * revelar dados da empresa existente". Devolver a linha vazaria razao
     * social para quem so digitou um numero.
     */
    /**
     * Este CNPJ ja tem cadastro? — RF-002.
     *
     * Pela funcao `auth_cnpj_taken` (migration 0017), e nao por um SELECT
     * direto. O SELECT direto so funcionava em conexao que IGNORA a RLS: sem
     * empresa no contexto — e no cadastro nao ha, por definicao — a consulta
     * LANCA desde a 0004 (RF-121). Num papel comum, o cadastro morria na
     * primeira linha e a tela mostrava "algo deu errado do nosso lado".
     *
     * A funcao devolve um booleano e nada mais, que e o que a RF-002 pede:
     * recusar "sem revelar dados da empresa existente".
     */
    cnpjTaken: async (cnpj) =>
      withPlatformScope(sql, async (tx) => {
        const [linha] = await tx<{ existe: boolean }[]>`
          SELECT auth_cnpj_taken(${cnpj}) AS existe
        `
        return linha?.existe === true
      }),

    /**
     * A propria empresa — RF-003.
     *
     * Sem `WHERE id =`: a politica raiz de `companies` e
     * `USING (id = current_company_id())`, entao a linha do proprio tenant e a
     * UNICA visivel. Repetir o filtro daria a impressao de que ele e o que
     * protege — e alguem, um dia, o removeria achando que e redundante.
     */
    findById: async (companyId) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaEmpresa[]>`SELECT * FROM companies`,
      )
      return linha === undefined ? undefined : paraEmpresa(linha)
    },

    /**
     * Atualiza o cadastro — RF-003.
     *
     * ## `COALESCE` e o que faz "campo ausente" significar "nao mexa"
     *
     * Cada coluna recebe `COALESCE(${valor}, coluna)`: veio um valor, grava;
     * veio `null` (o `undefined` do TypeScript vira `null` no driver), fica o
     * que estava. Um UPDATE que gravasse tudo faria a tela de endereco, ao
     * salvar, limpar a inscricao estadual preenchida na aba fiscal.
     *
     * O preco disso e nao dar para APAGAR um campo por aqui — mandar
     * "sem inscricao estadual" e indistinguivel de nao mandar nada. Nenhuma
     * tela pede isso hoje, e quando pedir sera com um verbo proprio, e nao
     * confundindo ausencia com apagamento.
     *
     * ## `updated_at` a mao
     *
     * A coluna tem `DEFAULT now()`, e default so vale no INSERT. Sem esta
     * linha, a data de atualizacao ficaria congelada no dia do cadastro.
     */
    update: async (companyId, m) => {
      /*
       * Coordenada nao segue o padrao `COALESCE` do resto do UPDATE.
       *
       * As outras colunas so tem dois estados possiveis para quem chama:
       * "nao mexeu" (undefined) ou "novo valor" — `COALESCE(novo, atual)`
       * resolve os dois com uma so expressao. Coordenada tem TRES: nao mexeu
       * (undefined, nao inclui a coluna no SET), limpou de proposito (`null`,
       * o CEP mudou para um sem cobertura — precisa MESMO virar nulo), ou
       * novo valor. `COALESCE` nao distingue "limpar" de "nao mexer": um
       * `null` ali seria absorvido e a coordenada antiga, errada para o CEP
       * novo, ficaria gravada como se ainda valesse.
       */
      const coordenadas: CompanyChanges['coordinates'] = m.coordinates
      const setCoordenadas =
        coordenadas === undefined
          ? sql``
          : sql`, latitude = ${coordenadas?.latitude ?? null}, longitude = ${coordenadas?.longitude ?? null}`

      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaEmpresa[]>`
          UPDATE companies SET
            legal_name             = COALESCE(${m.legalName ?? null}, legal_name),
            trade_name             = COALESCE(${m.tradeName ?? null}, trade_name),
            email                  = COALESCE(${m.email ?? null}, email),
            phone                  = COALESCE(${m.phone ?? null}, phone),
            state_registration     = COALESCE(${m.stateRegistration ?? null}, state_registration),
            municipal_registration = COALESCE(${m.municipalRegistration ?? null},
                                              municipal_registration),
            business_segment       = COALESCE(${m.businessSegment ?? null}, business_segment),
            postal_code               = COALESCE(${m.address?.zipCode ?? null}, postal_code),
            street                 = COALESCE(${m.address?.street ?? null}, street),
            street_number          = COALESCE(${m.address?.number ?? null}, street_number),
            complement             = COALESCE(${m.address?.complement ?? null}, complement),
            neighborhood           = COALESCE(${m.address?.district ?? null}, neighborhood),
            city                   = COALESCE(${m.address?.city ?? null}, city),
            state                  = COALESCE(${m.address?.state ?? null}, state)
            ${setCoordenadas},
            updated_at             = now()
          RETURNING *
        `,
      )

      if (linha === undefined) {
        /* A RLS escondeu a linha, ou ela nao existe. Nos dois casos nao ha o
           que atualizar, e devolver um objeto vazio faria a tela desenhar um
           cadastro em branco como se tivesse salvado. */
        throw new Error(`empresa ${companyId} nao encontrada`)
      }

      return paraEmpresa(linha)
    },
  }
}

type LinhaCliente = {
  id: string
  name: string
  trade_name: string | null
  document: string | null
  phone: string | null
  email: string | null
  notes: string | null
  wallet_limit_cents: string | number
  wallet_balance_cents: string | number
  postal_code: string | null
  street: string | null
  street_number: string | null
  complement: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  created_at: Date
  anonymized_at: Date | null
}

const paraCliente = (l: LinhaCliente): CustomerOutput => ({
  id: l.id,
  name: l.name,
  tradeName: l.trade_name,
  document: l.document,
  phone: l.phone,
  email: l.email,
  notes: l.notes,
  walletLimitCents: numero(l.wallet_limit_cents),
  walletBalanceCents: numero(l.wallet_balance_cents),
  address: paraEndereco(l),
  createdAt: l.created_at.toISOString(),
  /* A ficha precisa disto para nao oferecer "atender pedido de exclusao" a um
     cliente ja anonimizado — RF-127. */
  anonymizedAt: l.anonymized_at?.toISOString() ?? null,
})

export function createCustomerRepository(sql: Sql): CustomerRepository {
  return {
    create: async (c: NewCustomer) => {
      const [linha] = await withTenant(
        sql,
        c.companyId,
        (tx) => tx<LinhaCliente[]>`
          INSERT INTO customers
            (company_id, name, trade_name, document, phone, email, notes, wallet_limit_cents,
             postal_code, street, street_number, complement, neighborhood, city, state,
             created_by, created_at)
          VALUES (${c.companyId}, ${c.name}, ${c.tradeName ?? null}, ${c.document ?? null}, ${c.phone ?? null},
                  ${c.email ?? null}, ${c.notes ?? null}, ${c.walletLimitCents ?? 0},
                  ${c.address?.zipCode ?? null}, ${c.address?.street ?? null},
                  ${c.address?.number ?? null}, ${c.address?.complement ?? null},
                  ${c.address?.district ?? null}, ${c.address?.city ?? null},
                  ${c.address?.state ?? null},
                  ${c.createdBy}, ${c.createdAt})
          RETURNING *
        `,
      )
      return paraCliente(linha!)
    },

    /**
     * Um cliente — RF-011.
     *
     * Sem historico de compra: quem abre a ficha ja tem a lista atras, e o
     * detalhe pede as OUTRAS coisas (endereco, fiado, observacao). Repetir a
     * agregacao aqui custaria uma varredura de vendas para mostrar um numero
     * que a tela anterior ja mostrou.
     */
    findById: async (companyId, customerId) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaCliente[]>`SELECT * FROM customers WHERE id = ${customerId}`,
      )
      /* De outra empresa e o mesmo que inexistente: a RLS ja escondeu a linha,
         e devolver `undefined` e o certo — um erro diferente de "nao existe"
         confirmaria que o cliente existe em alguma outra loja. */
      return linha === undefined ? undefined : paraCliente(linha)
    },

    /**
     * A lista da tela, com o historico de compra — RF-011, US-036.
     *
     * ## O historico vem por LATERAL, e nao por JOIN
     *
     * Um `JOIN sales` multiplicaria a linha do cliente por venda: quem comprou
     * doze vezes viraria doze linhas, e o `LIMIT 24` cortaria no meio de um
     * cliente. O `LATERAL` agrega ANTES de juntar, entao cada cliente e uma
     * linha so. E evita o N+1: buscar por cliente daria vinte e cinco idas ao
     * banco para uma pagina.
     *
     * ## O total sai da mesma varredura
     *
     * `count(*) OVER ()` conta as linhas que casaram com o `WHERE` antes do
     * `LIMIT`. E o que faz a tela dizer "24 de 300"; sem ele, pagina cheia e
     * indistinguivel de fim da lista.
     *
     * ## "Inativo" e regra de `core`, e chega pronta
     *
     * O numero de dias vem por parametro (`diasParaInativo`) e nao esta escrito
     * aqui: e a mesma fronteira que o CRM usa para dizer "faz dois meses que ela
     * nao vem", e deixa-la no SQL espalharia a definicao por cada consulta.
     *
     * Cliente que NUNCA comprou tambem entra em "inativos". Ele e o caso mais
     * extremo do que o filtro procura — alguem que precisa de um contato — e
     * deixa-lo de fora esconderia justamente quem mais precisa aparecer.
     */
    list: async (companyId, criterio) => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<
          (LinhaCliente & {
            total_geral: string
            last_sale_on: string | null
            sales_count: string
            total_spent_cents: string
          })[]
        >`
          SELECT c.*,
                 count(*) OVER ()                       AS total_geral,
                 to_char(h.last_sale_at, 'YYYY-MM-DD') AS last_sale_on,
                 COALESCE(h.sales_count, 0)             AS sales_count,
                 COALESCE(h.total_spent_cents, 0)       AS total_spent_cents
          FROM customers c
          LEFT JOIN LATERAL (
            /* O INSTANTE, e nao o texto: e por ele que o filtro de inativos
               compara. Formatar aqui obrigaria a comparar string com data. */
            SELECT max(s.created_at)                    AS last_sale_at,
                   count(*)                             AS sales_count,
                   COALESCE(sum(s.net_amount_cents), 0) AS total_spent_cents
            FROM sales s
            WHERE s.customer_id = c.id AND s.status <> 'cancelled'
          ) h ON true
          WHERE true
          ${
            criterio.termo === undefined
              ? tx``
              : tx`AND (c.name ILIKE ${'%' + criterio.termo + '%'}
                     OR c.document ILIKE ${'%' + criterio.termo + '%'}
                     OR c.phone ILIKE ${'%' + criterio.termo + '%'})`
          }
          ${
            criterio.filtro === 'fiado'
              ? tx`AND c.wallet_balance_cents > 0`
              : criterio.filtro === 'inativos'
                ? tx`AND (h.last_sale_at IS NULL
                       OR h.last_sale_at < ${criterio.hoje}::timestamptz
                          - make_interval(days => ${criterio.diasParaInativo}))`
                : tx``
          }
          ORDER BY c.name, c.id
          LIMIT ${criterio.limite} OFFSET ${criterio.offset}
        `,
      )

      return {
        total: numero(linhas[0]?.total_geral ?? 0),
        clientes: linhas.map((l) => ({
          ...paraCliente(l),
          lastSaleOn: l.last_sale_on,
          salesCount: numero(l.sales_count),
          totalSpentCents: numero(l.total_spent_cents),
        })),
      }
    },

    findSimilar: async (companyId, criteria) => {
      /*
       * Sem criterio nao ha semelhanca a procurar. Sair antes evita um
       * `WHERE false` que varreria o indice a toa — e, pior, evita que uma
       * mudanca futura no SQL transforme isso em "traz todo mundo".
       */
      if (criteria.phone === undefined && criteria.document === undefined) return []

      return withTenant(sql, companyId, async (tx) => {
        const linhas = await tx<LinhaCliente[]>`
          SELECT * FROM customers
          WHERE deleted_at IS NULL
            AND (
              ${criteria.phone ?? null}::text IS NOT NULL AND phone = ${criteria.phone ?? null}
              OR
              ${criteria.document ?? null}::text IS NOT NULL AND document = ${criteria.document ?? null}
            )
          ORDER BY created_at DESC
          LIMIT 10
        `
        return linhas.map(paraCliente)
      })
    },

    search: async (companyId, criterio) => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaCliente[]>`
          SELECT * FROM customers
          WHERE deleted_at IS NULL
          ${
            criterio.termo === undefined
              ? tx``
              : tx`AND (name ILIKE ${'%' + criterio.termo + '%'}
                     OR document ILIKE ${'%' + criterio.termo + '%'}
                     OR phone ILIKE ${'%' + criterio.termo + '%'})`
          }
          ORDER BY name, id
          LIMIT ${criterio.limite}
        `,
      )
      return linhas.map(paraCliente)
    },
  }
}

type LinhaProduto = {
  id: string
  description: string
  barcode: string | null
  internal_code: string
  unit_of_measure: string
  sale_price_cents: string | number
  cost_price_cents: string | number
  tax_rate: string | null
  stock: number
  min_stock: number
  category: string | null
  supplier: string | null
  is_active: boolean
  created_at: Date
  ncm: string | null
  cfop: string | null
  tax_situation_code: string | null
}

const paraProduto = (l: LinhaProduto): ProductOutput => ({
  id: l.id,
  description: l.description,
  barcode: l.barcode,
  internalCode: l.internal_code,
  unitOfMeasure: l.unit_of_measure as ProductOutput['unitOfMeasure'],
  salePriceCents: numero(l.sale_price_cents),
  costPriceCents: numero(l.cost_price_cents),
  /* `numeric` tambem volta como string — e `null` continua `null`. */
  taxRate: l.tax_rate === null ? null : numero(l.tax_rate),
  ncm: l.ncm,
  cfop: l.cfop,
  taxSituationCode: l.tax_situation_code,
  /* A coluna chama `stock`; o contrato chama `stock`. */
  stock: l.stock,
  minStock: l.min_stock,
  category: l.category,
  supplier: l.supplier,
})

export function createProductRepository(sql: Sql): ProductRepository {
  return {
    create: async (p: NewProduct) => {
      const [linha] = await withTenant(
        sql,
        p.companyId,
        (tx) => tx<LinhaProduto[]>`
          INSERT INTO products
            (company_id, description, barcode, internal_code, unit_of_measure,
             sale_price_cents, cost_price_cents, tax_rate, min_stock, category,
             supplier, ncm, cfop, tax_situation_code,
             created_by, created_at)
          VALUES (${p.companyId}, ${p.description}, ${p.barcode ?? null}, ${p.internalCode},
                  ${p.unitOfMeasure}, ${p.salePriceCents}, ${p.costPriceCents},
                  ${p.taxRate ?? null}, ${p.minStock}, ${p.category ?? null},
                  ${p.supplier ?? null},
                  ${p.ncm}, ${p.cfop}, ${p.taxSituationCode},
                  ${p.createdBy}, ${p.createdAt})
          RETURNING *
        `,
      )
      return paraProduto(linha!)
    },

    findByBarcode: async (companyId, barcode) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaProduto[]>`
          SELECT * FROM products
          WHERE barcode = ${barcode} AND deleted_at IS NULL
        `,
      )
      return linha === undefined ? undefined : paraProduto(linha)
    },

    findById: async (companyId, productId) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaProduto[]>`
          SELECT * FROM products
          WHERE id = ${productId} AND deleted_at IS NULL
        `,
      )
      /* `deleted_at IS NULL` como nas outras leituras: produto apagado nao
         reaparece por um link antigo. A RLS ja cuida da outra loja. */
      return linha === undefined ? undefined : paraProduto(linha)
    },

    /**
     * O catalogo do balcao — RF-019.
     *
     * O termo vai para o SQL porque aqui nao ha regra a esconder, e filtrar em
     * memoria significaria carregar o catalogo inteiro a cada tecla. `ILIKE`
     * resolve a caixa sem `lower()` dos dois lados.
     *
     * Ordena por descricao para a lista nao dancar entre buscas iguais — sem
     * `ORDER BY`, o Postgres pode devolver em qualquer ordem e a tela pisca.
     *
     * `company_id` entra no WHERE de proposito, nao so na RLS. A CI conecta
     * com o `POSTGRES_USER` (superusuario), que ignora politica; turbo ainda
     * roda `db` e `api` no mesmo Postgres. Sem o filtro, `q=camiseta` via a
     * "Camiseta exclusiva" do teste de estoque da outra loja.
     */
    search: async (companyId, criterio) => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaProduto[]>`
          SELECT * FROM products
          WHERE company_id = ${companyId} AND deleted_at IS NULL
          ${
            criterio.termo === undefined
              ? tx``
              : tx`AND (description ILIKE ${'%' + criterio.termo + '%'}
                     OR internal_code ILIKE ${'%' + criterio.termo + '%'}
                     OR barcode = ${criterio.termo})`
          }
          ORDER BY description
          LIMIT ${criterio.limite}
        `,
      )
      return linhas.map(paraProduto)
    },

    /**
     * O catalogo do backoffice — NR-072.
     *
     * ## A pagina e o total saem da MESMA varredura
     *
     * `count(*) OVER ()` conta as linhas que casaram com o `WHERE` ANTES do
     * `LIMIT`, e vem repetido em toda linha da pagina. E o que faz a tela dizer
     * "24 de 300". Um `SELECT count(*)` separado varreria a tabela de novo, e
     * entre as duas leituras um cadastro novo faria a conta deixar de fechar.
     *
     * A pagina vazia (busca sem resultado, ou pagina alem do fim) devolve zero
     * linhas e, com elas, nenhum total — por isso `total` cai para 0 aqui, que
     * e a resposta certa nos dois casos.
     *
     * ## O filtro de estoque e do BANCO
     *
     * "Esgotados" calculado sobre a pagina mostraria os esgotados DAQUELES 24,
     * e nao os da loja. O lojista abre esse filtro justamente para achar o que
     * nao esta na frente dele.
     */
    listCatalog: async (companyId, criterio) => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<(LinhaProduto & { total_geral: string })[]>`
          SELECT *, count(*) OVER () AS total_geral FROM products
          WHERE company_id = ${companyId} AND deleted_at IS NULL
          ${
            criterio.termo === undefined
              ? tx``
              : tx`AND (description ILIKE ${'%' + criterio.termo + '%'}
                     OR internal_code ILIKE ${'%' + criterio.termo + '%'}
                     OR barcode = ${criterio.termo})`
          }
          ${
            criterio.stock === 'esgotado'
              ? tx`AND stock <= 0`
              : criterio.stock === 'baixo'
                ? tx`AND stock > 0 AND stock < min_stock`
                : tx``
          }
          ORDER BY description, id
          LIMIT ${criterio.limite} OFFSET ${criterio.offset}
        `,
      )

      return {
        produtos: linhas.map(paraProduto),
        total: numero(linhas[0]?.total_geral ?? 0),
      }
    },

    /**
     * Os numeros do topo, sobre o catalogo inteiro — NR-072.
     *
     * Uma consulta so com quatro agregacoes, e nao quatro consultas. Alem de
     * varrer a tabela uma vez, garante que os quatro numeros descrevem o MESMO
     * instante: em quatro leituras, um cadastro no meio faria "produtos no
     * catalogo" e "valor em estoque" discordarem.
     *
     * `belowMinimum` inclui os zerados de proposito — quem esta em zero esta
     * abaixo do minimo. Sao duas contagens que se sobrepoem, e nao parcelas de
     * um total; a tela nao pode soma-las.
     */
    catalogSummary: async (companyId) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<
          {
            total: string
            below_minimum: string
            out_of_stock: string
            stock_value_cents: string
          }[]
        >`
          SELECT count(*)                                              AS total,
                 count(*) FILTER (WHERE stock < min_stock)    AS below_minimum,
                 count(*) FILTER (WHERE stock <= 0)           AS out_of_stock,
                 COALESCE(SUM(stock * cost_price_cents), 0)   AS stock_value_cents
          FROM products
          WHERE company_id = ${companyId} AND deleted_at IS NULL
        `,
      )

      return {
        total: numero(linha?.total ?? 0),
        belowMinimum: numero(linha?.below_minimum ?? 0),
        outOfStock: numero(linha?.out_of_stock ?? 0),
        stockValueCents: numero(linha?.stock_value_cents ?? 0),
      }
    },

    countAll: async (companyId) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        /* Conta os apagados tambem: o codigo interno nao pode ser reusado, e
           contar so os vivos faria o proximo colidir com um que ja existiu. */
        (tx) =>
          tx<{ total: string }[]>`
            SELECT count(*)::text AS total FROM products
            WHERE company_id = ${companyId}
          `,
      )
      return numero(linha?.total ?? 0)
    },

    /**
     * Categoria e fornecedor ja usados — as sugestoes do formulario.
     *
     * Uma varredura so, com as duas listas: `array_agg(DISTINCT col ORDER BY
     * col)` ja devolve ordenado, e o `FILTER` descarta o nulo antes de
     * agregar (produto sem categoria/fornecedor nao vira sugestao vazia).
     * `COALESCE` cobre a empresa sem nenhum produto ainda — `array_agg` sobre
     * zero linhas e `NULL`, nao lista vazia.
     */
    listSuggestions: async (companyId) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<{ categories: string[]; suppliers: string[] }[]>`
          SELECT
            COALESCE(
              array_agg(DISTINCT category ORDER BY category) FILTER (WHERE category IS NOT NULL),
              '{}'
            ) AS categories,
            COALESCE(
              array_agg(DISTINCT supplier ORDER BY supplier) FILTER (WHERE supplier IS NOT NULL),
              '{}'
            ) AS suppliers
          FROM products
          WHERE deleted_at IS NULL
        `,
      )
      return { categories: linha?.categories ?? [], suppliers: linha?.suppliers ?? [] }
    },
  }
}
