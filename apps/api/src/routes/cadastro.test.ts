import type { CompanyOutput, CustomerOutput, ProductOutput } from '@na-regua/contracts'
import type {
  CompanyRepository,
  CustomerRepository,
  NewCustomer,
  NewProduct,
  ProductRepository,
} from '@na-regua/core'
import {
  InMemoryAuditTrail,
  InMemoryChartOfAccounts,
  InMemoryInventory,
  TETO_DO_CATALOGO,
} from '@na-regua/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import type { AuthenticatedPrincipal } from '../plugins/execution-context.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { type CadastroDeps, registerCadastroRoutes } from './cadastro.js'

const PRINCIPAL: AuthenticatedPrincipal = {
  companyId: 'empresa-1',
  userId: 'usuario-1',
  role: 'owner',
}

function cadastroEmMemoria() {
  const empresas: CompanyOutput[] = []
  const clientes: (CustomerOutput & { companyId: string })[] = []
  const produtos: (ProductOutput & { companyId: string })[] = []
  let seq = 0

  const companies: CompanyRepository = {
    create: async (c) => {
      seq += 1
      const e: CompanyOutput = {
        id: `emp-${seq}`,
        legalName: c.legalName,
        tradeName: c.tradeName ?? c.legalName,
        cnpj: c.cnpj,
        email: c.email,
        phone: c.phone,
        address: {
          zipCode: c.address?.zipCode ?? null,
          street: c.address?.street ?? null,
          number: c.address?.number ?? null,
          complement: c.address?.complement ?? null,
          district: c.address?.district ?? null,
          city: c.address?.city ?? null,
          state: c.address?.state ?? null,
        },
        stateRegistration: c.stateRegistration ?? null,
        municipalRegistration: c.municipalRegistration ?? null,
        businessSegment: c.businessSegment ?? null,
        createdAt: c.createdAt.toISOString(),
      }
      empresas.push(e)
      return e
    },
    cnpjTaken: async (cnpj) => empresas.some((e) => e.cnpj === cnpj),

    /* A empresa do contexto. O falso guarda uma lista porque o cadastro cria
       varias no mesmo teste; em producao a RLS deixa ver so a propria. */
    findById: async (companyId) => empresas.find((e) => e.id === companyId),

    /*
     * Campo ausente fica como esta — a mesma regra do `COALESCE` do SQL.
     * Um `{ ...atual, ...mudancas }` cru apagaria com `undefined` explicito, e
     * o teste ficaria verde enquanto o banco faria outra coisa.
     */
    update: async (companyId, m) => {
      const i = empresas.findIndex((e) => e.id === companyId)
      if (i < 0) throw new Error(`empresa ${companyId} nao encontrada`)

      const atual = empresas[i]!
      const atualizada: CompanyOutput = {
        ...atual,
        ...(m.legalName === undefined ? {} : { legalName: m.legalName }),
        ...(m.tradeName === undefined ? {} : { tradeName: m.tradeName }),
        ...(m.email === undefined ? {} : { email: m.email }),
        ...(m.phone === undefined ? {} : { phone: m.phone }),
        ...(m.stateRegistration === undefined ? {} : { stateRegistration: m.stateRegistration }),
        ...(m.municipalRegistration === undefined
          ? {}
          : { municipalRegistration: m.municipalRegistration }),
        ...(m.businessSegment === undefined ? {} : { businessSegment: m.businessSegment }),
        ...(m.address === undefined
          ? {}
          : {
              /* Campo a campo tambem DENTRO do endereco: mandar so o CEP nao
                 pode limpar cidade e UF. */
              address: {
                zipCode: m.address.zipCode ?? atual.address.zipCode,
                street: m.address.street ?? atual.address.street,
                number: m.address.number ?? atual.address.number,
                complement: m.address.complement ?? atual.address.complement,
                district: m.address.district ?? atual.address.district,
                city: m.address.city ?? atual.address.city,
                state: m.address.state ?? atual.address.state,
              },
            }),
      }

      empresas[i] = atualizada
      return atualizada
    },
  }

  const customers: CustomerRepository = {
    create: async (c: NewCustomer) => {
      seq += 1
      const cl = {
        id: `cli-${seq}`,
        companyId: c.companyId,
        name: c.name,
        document: c.document ?? null,
        phone: c.phone ?? null,
        email: c.email ?? null,
        notes: c.notes ?? null,
        walletLimitCents: c.walletLimitCents ?? 0,
        walletBalanceCents: 0,
        /* Campo a campo, e nao `c.address ?? SEM_ENDERECO`: quem manda so o
           CEP tem que ver os outros seis voltarem `null`, e nao sumirem. */
        address: {
          zipCode: c.address?.zipCode ?? null,
          street: c.address?.street ?? null,
          number: c.address?.number ?? null,
          complement: c.address?.complement ?? null,
          district: c.address?.district ?? null,
          city: c.address?.city ?? null,
          state: c.address?.state ?? null,
        },
        createdAt: c.createdAt.toISOString(),
        anonymizedAt: null,
      }
      clientes.push(cl)
      return cl
    },
    /* O falso nao guarda venda: o historico volta zerado, e isso e honesto —
       quem testa a ROTA testa paginacao e filtro, nao a agregacao de compras,
       que so o banco faz. */
    list: async (companyId, criterio) => {
      const termo = criterio.termo?.toLowerCase() ?? ''
      const casam = clientes
        .filter((c) => c.companyId === companyId)
        .filter((c) => termo === '' || c.name.toLowerCase().includes(termo))
        .sort((a, b) => a.name.localeCompare(b.name))

      return {
        total: casam.length,
        clientes: casam
          .slice(criterio.offset, criterio.offset + criterio.limite)
          .map((c) => ({ ...c, lastSaleOn: null, salesCount: 0, totalSpentCents: 0 })),
      }
    },

    findById: async (companyId, customerId) =>
      clientes.find((c) => c.id === customerId && c.companyId === companyId),

    findSimilar: async (companyId, criteria) =>
      criteria.phone === undefined && criteria.document === undefined
        ? []
        : clientes.filter(
            (c) =>
              c.companyId === companyId &&
              ((criteria.phone !== undefined && c.phone === criteria.phone) ||
                (criteria.document !== undefined && c.document === criteria.document)),
          ),

    search: async (companyId, criterio) => {
      const termo = criterio.termo?.toLowerCase() ?? ''
      return clientes
        .filter((c) => c.companyId === companyId)
        .filter(
          (c) =>
            termo === '' ||
            c.name.toLowerCase().includes(termo) ||
            (c.document?.toLowerCase().includes(termo) ?? false) ||
            (c.phone?.includes(termo) ?? false),
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, criterio.limite)
    },
  }

  const inventario = new InMemoryInventory(new InMemoryAuditTrail())

  const products: ProductRepository = {
    /* O catalogo do balcao (RF-019). Imita o LIMITE e a ORDEM do repositorio de
       verdade: um falso que devolvesse tudo em qualquer ordem deixaria passar
       um SQL sem `LIMIT` nem `ORDER BY`. */
    search: async (companyId, criterio) => {
      const termo = criterio.termo?.toLowerCase() ?? ''
      return produtos
        .filter((p) => p.companyId === companyId)
        .filter((p) => termo === '' || p.description.toLowerCase().includes(termo))
        .sort((a, b) => a.description.localeCompare(b.description))
        .slice(0, criterio.limite)
    },

    /* O catalogo do backoffice (NR-072). Corta a pagina DEPOIS de contar,
       como o SQL faz: contar sobre a pagina daria `total` sempre igual ao
       tamanho dela, e a tela nunca ofereceria a proxima. */
    listCatalog: async (companyId, criterio) => {
      const termo = criterio.termo?.toLowerCase() ?? ''
      const casam = produtos
        .filter((p) => p.companyId === companyId)
        .filter((p) => termo === '' || p.description.toLowerCase().includes(termo))
        .filter((p) => {
          if (criterio.stock === 'esgotado') return p.stock <= 0
          if (criterio.stock === 'baixo') return p.stock > 0 && p.stock < p.minStock
          return true
        })
        .sort((a, b) => a.description.localeCompare(b.description))

      return {
        total: casam.length,
        produtos: casam.slice(criterio.offset, criterio.offset + criterio.limite),
      }
    },

    catalogSummary: async (companyId) => {
      const meus = produtos.filter((p) => p.companyId === companyId)
      return {
        total: meus.length,
        belowMinimum: meus.filter((p) => p.stock < p.minStock).length,
        outOfStock: meus.filter((p) => p.stock <= 0).length,
        stockValueCents: meus.reduce((acc, p) => acc + p.stock * p.costPriceCents, 0),
      }
    },

    create: async (p: NewProduct) => {
      seq += 1
      const pr = {
        id: `prod-${seq}`,
        companyId: p.companyId,
        description: p.description,
        barcode: p.barcode ?? null,
        internalCode: p.internalCode,
        unitOfMeasure: p.unitOfMeasure,
        salePriceCents: p.salePriceCents,
        costPriceCents: p.costPriceCents,
        taxRate: p.taxRate ?? null,
        ncm: p.ncm,
        cfop: p.cfop,
        taxSituationCode: p.taxSituationCode,
        stock: 0,
        minStock: p.minStock,
        category: p.category ?? null,
        supplier: p.supplier ?? null,
      }
      produtos.push(pr)

      /* Costura os dois falsos: em producao o cadastro e o estoque falam da
         MESMA tabela `products`, e sem isto o saldo inicial da importacao
         cairia em "produto nao encontrado" — erro do teste, nao do codigo. */
      inventario.adicionarProduto(p.companyId, {
        id: pr.id,
        description: pr.description,
        salePriceCents: pr.salePriceCents,
        stockQuantity: 0,
        location: null,
        minStock: pr.minStock,
      })

      return pr
    },
    /* Filtra por empresa de verdade: um falso que ignorasse isso faria o teste
       de isolamento medir o vazio. */
    findByBarcode: async (companyId, barcode) =>
      produtos.find((p) => p.companyId === companyId && p.barcode === barcode),
    findById: async (companyId, productId) =>
      produtos.find((p) => p.companyId === companyId && p.id === productId),
    countAll: async (companyId) => produtos.filter((p) => p.companyId === companyId).length,
    listSuggestions: async (companyId) => {
      const meus = produtos.filter((p) => p.companyId === companyId)
      const distintosEmOrdem = (valores: (string | null)[]) =>
        [...new Set(valores.filter((v): v is string => v !== null))].sort((a, b) =>
          a.localeCompare(b),
        )
      return {
        categories: distintosEmOrdem(meus.map((p) => p.category)),
        suppliers: distintosEmOrdem(meus.map((p) => p.supplier)),
      }
    },
  }

  /* O onboarding semeia o plano de contas (RF-081, NR-077), entao a rota
     precisa da porta. Falso de verdade, e nao um objeto vazio: assim o teste
     do 201 prova que a semeadura roda, em vez de so nao explodir. */
  const accounts = new InMemoryChartOfAccounts()

  /*
   * O estoque entra porque a IMPORTACAO grava saldo inicial, e saldo so muda
   * por movimento (RF-124). Em producao o cadastro e o estoque falam da mesma
   * tabela `products`; aqui sao dois falsos, e o `create` acima ja registra
   * cada produto novo no inventario para costura-los.
   */
  const uow = inventario
  const audit = new InMemoryAuditTrail()

  return {
    companies,
    customers,
    products,
    accounts,
    uow,
    audit,
    empresas,
    clientes,
    produtos,
    inventario,
  }
}

/**
 * `memoria` entra por fora para testar isolamento entre lojas.
 *
 * Sem isso, "a outra empresa nao ve" passaria pelo motivo errado: cada
 * `buildApp` teria um banco novo, e o cliente nao existiria para NINGUEM. O
 * teste ficaria verde provando nada.
 */
async function buildApp(
  principal: AuthenticatedPrincipal | null = PRINCIPAL,
  memoria = cadastroEmMemoria(),
) {
  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  await registerRateLimit(app)
  app.addHook('onRequest', async (request) => {
    if (principal !== null) request.principal = principal
  })
  registerCadastroRoutes(app, memoria as unknown as CadastroDeps)
  return { app, memoria }
}

let app: FastifyInstance

afterEach(async () => {
  await app?.close()
})

const EMPRESA = {
  legalName: 'Mercearia Sol Nascente LTDA',
  cnpj: '11222333000181',
  email: 'contato@sol.local',
  phone: '41999990000',
}

describe('cadastrar empresa — RF-001, RF-002', () => {
  it('cria e responde 201', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'POST', url: '/empresas', payload: EMPRESA })

    expect(r.statusCode).toBe(201)
    expect(r.json().cnpj).toBe('11222333000181')
  })

  /**
   * RF-002 pede recusar CNPJ repetido "sem revelar dados da empresa existente".
   * A mensagem nao pode trazer razao social — quem digitou so um numero nao
   * deveria descobrir de quem ele e.
   */
  it('recusa CNPJ repetido sem revelar a empresa existente', async () => {
    const c = await buildApp()
    app = c.app
    await app.inject({ method: 'POST', url: '/empresas', payload: EMPRESA })

    const r = await app.inject({
      method: 'POST',
      url: '/empresas',
      payload: { ...EMPRESA, legalName: 'Outra Razao Social LTDA' },
    })

    expect(r.statusCode).toBe(409)
    expect(JSON.stringify(r.json())).not.toContain('Sol Nascente')
  })

  it('CNPJ invalido responde 400', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/empresas',
      payload: { ...EMPRESA, cnpj: '11111111111111' },
    })

    expect(r.statusCode).toBe(400)
  })

  it('sem sessao responde 401', async () => {
    const c = await buildApp(null)
    app = c.app

    expect(
      (await app.inject({ method: 'POST', url: '/empresas', payload: EMPRESA })).statusCode,
    ).toBe(401)
  })
})

/**
 * O ponto mais interessante do cadastro: duplicado NAO e erro, e resposta.
 *
 * A decisao de reusar o existente e de quem esta no balcao, com o cliente na
 * frente — recusar automaticamente travaria o cadastro de dois irmaos com o
 * telefone de casa, que acontece.
 */
describe('cadastrar cliente — RF-009, RF-010', () => {
  const CLIENTE = { name: 'Dona Marta', phone: '41988887777' }

  it('cria com apenas nome — RF-009', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'POST', url: '/clientes', payload: { name: 'Marta' } })

    expect(r.statusCode).toBe(201)
  })

  it('telefone repetido responde 409 COM os candidatos', async () => {
    const c = await buildApp()
    app = c.app
    await app.inject({ method: 'POST', url: '/clientes', payload: CLIENTE })

    const r = await app.inject({
      method: 'POST',
      url: '/clientes',
      payload: { name: 'Marta Souza', phone: '41988887777' },
    })

    expect(r.statusCode).toBe(409)
    expect(r.json().candidates).toHaveLength(1)
    expect(r.json().candidates[0].name).toBe('Dona Marta')
  })

  /* Os candidatos vao FORA do envelope de erro: nao sao detalhe do erro, sao a
     informacao que permite decidir. */
  it('os candidatos nao ficam dentro do envelope de erro', async () => {
    const c = await buildApp()
    app = c.app
    await app.inject({ method: 'POST', url: '/clientes', payload: CLIENTE })

    const r = await app.inject({ method: 'POST', url: '/clientes', payload: CLIENTE })

    expect(r.json().error.candidates).toBeUndefined()
    expect(r.json().candidates).toBeDefined()
  })

  it('quem decidiu reenvia com ?duplicado=permitir e cadastra', async () => {
    const c = await buildApp()
    app = c.app
    await app.inject({ method: 'POST', url: '/clientes', payload: CLIENTE })

    const r = await app.inject({
      method: 'POST',
      url: '/clientes?duplicado=permitir',
      payload: { name: 'Marta Souza', phone: '41988887777' },
    })

    expect(r.statusCode).toBe(201)
    expect(c.memoria.clientes).toHaveLength(2)
  })

  it('cliente sem telefone nem documento nao dispara busca de duplicado', async () => {
    const c = await buildApp()
    app = c.app
    await app.inject({ method: 'POST', url: '/clientes', payload: { name: 'Joao' } })

    const r = await app.inject({ method: 'POST', url: '/clientes', payload: { name: 'Joao' } })

    expect(r.statusCode).toBe(201)
  })

  it('accountant recebe 403', async () => {
    const c = await buildApp({ ...PRINCIPAL, role: 'accountant' })
    app = c.app

    expect(
      (await app.inject({ method: 'POST', url: '/clientes', payload: CLIENTE })).statusCode,
    ).toBe(403)
  })

  it('grava o endereco que veio, e devolve na ficha — RF-009', async () => {
    const c = await buildApp()
    app = c.app

    const criado = await app.inject({
      method: 'POST',
      url: '/clientes',
      payload: {
        ...CLIENTE,
        address: { zipCode: '80010000', street: 'Rua XV', number: '100', state: 'PR' },
      },
    })

    const r = await app.inject({ method: 'GET', url: `/clientes/${criado.json().id}` })

    expect(r.statusCode).toBe(200)
    expect(r.json().address.street).toBe('Rua XV')
    expect(r.json().address.state).toBe('PR')
    /* O que nao veio volta `null`. Antes da migration 0019 nao havia coluna, e
       a tela pedia os sete campos so para descarta-los. */
    expect(r.json().address.district).toBeNull()
  })

  it('cliente de outra empresa responde 404, e nao 403', async () => {
    const c = await buildApp()
    app = c.app
    const criado = await app.inject({ method: 'POST', url: '/clientes', payload: CLIENTE })
    await app.close()

    /* O MESMO banco, outra loja — e o que torna o teste honesto: o cliente
       existe, e some por isolamento e nao por o banco estar vazio.
       403 confirmaria que aquele id existe em algum lugar, e quem varre ids
       aprenderia o cadastro do vizinho sem ler uma linha dele. */
    const outra = await buildApp({ ...PRINCIPAL, companyId: 'emp-outra' }, c.memoria)
    app = outra.app

    const r = await app.inject({ method: 'GET', url: `/clientes/${criado.json().id}` })

    expect(r.statusCode).toBe(404)
  })

  it('id desconhecido responde 404, e nao 200 com corpo vazio', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'GET', url: '/clientes/cli-999' })

    expect(r.statusCode).toBe(404)
  })

  it('nao confunde /clientes/importacao com /clientes/:id', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/clientes/importacao',
      payload: { customers: [{ name: 'Do lote' }] },
    })

    expect(r.statusCode).toBe(200)
    expect(r.json().imported).toBe(1)
  })
})

describe('cadastrar produto — RF-017, RF-019', () => {
  const PRODUTO = {
    description: 'Cafe torrado 500g',
    unitOfMeasure: 'un' as const,
    salePriceCents: 1990,
    costPriceCents: 1200,
  }

  it('cria e responde 201', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'POST', url: '/produtos', payload: PRODUTO })

    expect(r.statusCode).toBe(201)
  })

  /*
   * O defeito que isto guarda: `products.supplier` existia desde a migration
   * 0007, mas o contrato de cadastro nunca a expunha — o lojista digitava o
   * fornecedor e o cadastro descartava o campo em silencio.
   */
  it('grava categoria e fornecedor', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/produtos',
      payload: { ...PRODUTO, category: 'Mercearia', supplier: 'Torrefacao Aurora' },
    })

    expect(r.json().category).toBe('Mercearia')
    expect(r.json().supplier).toBe('Torrefacao Aurora')
  })

  it('sem categoria nem fornecedor, os dois voltam nulos', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'POST', url: '/produtos', payload: PRODUTO })

    expect(r.json().category).toBeNull()
    expect(r.json().supplier).toBeNull()
  })

  /* RF-019: sem codigo de barras, `core` gera o interno. A rota nao participa
     disso — se participasse, o canal WhatsApp geraria outro formato. */
  it('sem codigo de barras, ganha codigo interno', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'POST', url: '/produtos', payload: PRODUTO })

    expect(r.json().internalCode).toBeTruthy()
    expect(r.json().barcode).toBeNull()
  })

  it('preco negativo responde 400', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/produtos',
      payload: { ...PRODUTO, salePriceCents: -1 },
    })

    expect(r.statusCode).toBe(400)
  })
})

describe('localizar por codigo de barras — RF-018', () => {
  const COM_CODIGO = {
    description: 'Arroz 5kg',
    barcode: '7891234567895',
    unitOfMeasure: 'un' as const,
    salePriceCents: 2890,
    costPriceCents: 2100,
  }

  it('devolve o produto lido', async () => {
    const c = await buildApp()
    app = c.app
    await app.inject({ method: 'POST', url: '/produtos', payload: COM_CODIGO })

    const r = await app.inject({ method: 'GET', url: '/produtos/codigo-de-barras/7891234567895' })

    expect(r.statusCode).toBe(200)
    expect(r.json().description).toBe('Arroz 5kg')
  })

  /* 404 e nao lista vazia: o balcao precisa distinguir "nao existe" de "existe
     e esta zerado" — a segunda e cadastro feito, a primeira e cadastro a
     fazer. */
  it('codigo desconhecido responde 404, nao lista vazia', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'GET', url: '/produtos/codigo-de-barras/0000000000000' })

    expect(r.statusCode).toBe(404)
  })

  it('produto de outra empresa responde 404', async () => {
    const c = await buildApp()
    app = c.app
    await app.inject({ method: 'POST', url: '/produtos', payload: COM_CODIGO })
    await app.close()

    const outra = await buildApp({ ...PRINCIPAL, companyId: 'empresa-2' })
    app = outra.app

    const r = await app.inject({ method: 'GET', url: '/produtos/codigo-de-barras/7891234567895' })

    expect(r.statusCode).toBe(404)
  })

  /* Somente leitura nao e sem acesso — o contador confere cadastro. */
  it('accountant consulta', async () => {
    const c = await buildApp({ ...PRINCIPAL, role: 'accountant' })
    app = c.app

    expect(
      (await app.inject({ method: 'GET', url: '/produtos/codigo-de-barras/0000000000000' }))
        .statusCode,
    ).toBe(404)
  })
})

describe('catalogo do balcao — RF-019', () => {
  const CAFE = {
    description: 'Cafe torrado 500g',
    unitOfMeasure: 'un' as const,
    salePriceCents: 1990,
    costPriceCents: 1200,
  }
  const ACUCAR = {
    description: 'Acucar refinado 1kg',
    unitOfMeasure: 'un' as const,
    salePriceCents: 599,
    costPriceCents: 400,
  }

  async function comCatalogo() {
    const c = await buildApp()
    app = c.app
    await app.inject({ method: 'POST', url: '/produtos', payload: CAFE })
    await app.inject({ method: 'POST', url: '/produtos', payload: ACUCAR })
    return c
  }

  it('sem termo, devolve o catalogo — e o estado em que o PDV abre', async () => {
    await comCatalogo()

    const r = await app.inject({ method: 'GET', url: '/produtos' })

    expect(r.statusCode).toBe(200)
    expect(r.json().products).toHaveLength(2)
  })

  it('ordena por descricao, para a lista nao dancar entre buscas iguais', async () => {
    await comCatalogo()

    const r = await app.inject({ method: 'GET', url: '/produtos' })

    expect(r.json().products.map((p: { description: string }) => p.description)).toEqual([
      'Acucar refinado 1kg',
      'Cafe torrado 500g',
    ])
  })

  it('filtra pelo termo, sem depender da caixa', async () => {
    await comCatalogo()

    const r = await app.inject({ method: 'GET', url: '/produtos?q=CAFE' })

    expect(r.json().products).toHaveLength(1)
    expect(r.json().products[0].description).toBe('Cafe torrado 500g')
  })

  it('nada encontrado e lista VAZIA, e nao 404', async () => {
    await comCatalogo()

    const r = await app.inject({ method: 'GET', url: '/produtos?q=bicicleta' })

    /*
     * Aqui e busca sobre colecao: "nenhum produto com esse nome" e uma
     * resposta. O 404 fica para o codigo de barras, onde nao achar significa
     * "existe no mundo e falta cadastrar" — e o balcao age diferente nos dois.
     */
    expect(r.statusCode).toBe(200)
    expect(r.json().products).toEqual([])
  })

  it('nao passa do teto, mesmo se pedirem mais', async () => {
    const c = await comCatalogo()
    app = c.app

    const r = await app.inject({ method: 'GET', url: `/produtos?limite=${TETO_DO_CATALOGO + 500}` })

    /* O teto e decisao de produto e mora em `core`: na rota, cada cliente novo
       — mobile, assistente — escolheria o seu. Quem pede pode reduzir. */
    expect(r.json().products.length).toBeLessThanOrEqual(TETO_DO_CATALOGO)
  })

  it('sem sessao, 401', async () => {
    const c = await buildApp(null)
    app = c.app

    expect((await app.inject({ method: 'GET', url: '/produtos' })).statusCode).toBe(401)
  })
})

describe('catalogo do backoffice — NR-072, US-008', () => {
  const produto = (description: string, salePriceCents: number) => ({
    description,
    unitOfMeasure: 'un' as const,
    salePriceCents,
    costPriceCents: 400,
  })

  async function comCatalogo() {
    const c = await buildApp()
    app = c.app
    for (const d of ['Acucar', 'Biscoito', 'Cafe', 'Detergente', 'Erva-mate']) {
      await app.inject({ method: 'POST', url: '/produtos', payload: produto(d, 1000) })
    }
    return c
  }

  it('devolve a pagina com o total do catalogo, e nao o tamanho da pagina', async () => {
    await comCatalogo()

    const r = await app.inject({ method: 'GET', url: '/produtos/catalogo?pageSize=2' })

    expect(r.statusCode).toBe(200)
    expect(r.json().products).toHaveLength(2)
    /* CINCO. E o que faz a tela dizer "2 de 5" e oferecer a proxima pagina. */
    expect(r.json().total).toBe(5)
  })

  it('converte pagina e tamanho, que chegam como TEXTO na query', async () => {
    await comCatalogo()

    const r = await app.inject({ method: 'GET', url: '/produtos/catalogo?page=2&pageSize=2' })

    /* Numeros, e nao "2": um OFFSET com texto passaria aqui e explodiria no
       banco. E o `page` ecoado prova que a rota nao caiu no padrao. */
    expect(r.json().page).toBe(2)
    expect(r.json().pageSize).toBe(2)
    expect(r.json().products.map((p: { description: string }) => p.description)).toEqual([
      'Cafe',
      'Detergente',
    ])
  })

  it('usa o padrao quando ninguem pede pagina', async () => {
    await comCatalogo()

    const r = await app.inject({ method: 'GET', url: '/produtos/catalogo' })

    expect(r.json().page).toBe(1)
    expect(r.json().pageSize).toBe(24)
  })

  it('recusa pagina acima do teto em vez de varrer o catalogo inteiro', async () => {
    await comCatalogo()

    const r = await app.inject({ method: 'GET', url: '/produtos/catalogo?pageSize=5000' })

    expect(r.statusCode).toBe(400)
  })

  it('nao confunde /produtos/catalogo com /produtos/codigo-de-barras/:codigo', async () => {
    await comCatalogo()

    /* As duas sao GET sob `/produtos/`. Se a rota de codigo de barras casasse
       primeiro, "catalogo" viraria um codigo procurado e a tela receberia 404
       em vez do catalogo. */
    const r = await app.inject({ method: 'GET', url: '/produtos/catalogo' })

    expect(r.statusCode).toBe(200)
    expect(r.json().products).toHaveLength(5)
  })

  it('o resumo fala do catalogo inteiro', async () => {
    await comCatalogo()

    const r = await app.inject({ method: 'GET', url: '/produtos/resumo' })

    expect(r.statusCode).toBe(200)
    expect(r.json().total).toBe(5)
    /* Produto nasce com estoque zero — o saldo so muda por movimento (NR-023).
       Entao os cinco estao esgotados, e o valor parado e zero. */
    expect(r.json().outOfStock).toBe(5)
    expect(r.json().stockValueCents).toBe(0)
  })
})

/**
 * Sugestoes do formulario — categoria e fornecedor ja usados.
 *
 * Ate aqui o formulario oferecia uma lista de exemplo FIXA (`Mercearia`,
 * `Laticinios`...), sempre a mesma para toda loja: a sugestao nunca refletia
 * o que o proprio lojista ja tinha digitado.
 */
describe('sugestoes de categoria e fornecedor — GET /produtos/sugestoes', () => {
  it('devolve so o que ja foi usado, sem repetir e em ordem', async () => {
    const c = await buildApp()
    app = c.app
    await app.inject({
      method: 'POST',
      url: '/produtos',
      payload: {
        description: 'Cafe torrado',
        unitOfMeasure: 'un',
        salePriceCents: 1990,
        costPriceCents: 1200,
        category: 'Mercearia',
        supplier: 'Torrefacao Aurora',
      },
    })
    await app.inject({
      method: 'POST',
      url: '/produtos',
      payload: {
        description: 'Acucar',
        unitOfMeasure: 'un',
        salePriceCents: 500,
        costPriceCents: 300,
        category: 'Mercearia',
        supplier: 'Engenho Doce',
      },
    })

    const r = await app.inject({ method: 'GET', url: '/produtos/sugestoes' })

    expect(r.statusCode).toBe(200)
    expect(r.json().categories).toEqual(['Mercearia'])
    expect(r.json().suppliers).toEqual(['Engenho Doce', 'Torrefacao Aurora'])
  })

  it('produto sem categoria nem fornecedor nao vira sugestao em branco', async () => {
    const c = await buildApp()
    app = c.app
    await app.inject({
      method: 'POST',
      url: '/produtos',
      payload: {
        description: 'Item avulso',
        unitOfMeasure: 'un',
        salePriceCents: 500,
        costPriceCents: 300,
      },
    })

    const r = await app.inject({ method: 'GET', url: '/produtos/sugestoes' })

    expect(r.json()).toEqual({ categories: [], suppliers: [] })
  })

  it('catalogo vazio devolve listas vazias, e nao erro', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'GET', url: '/produtos/sugestoes' })

    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ categories: [], suppliers: [] })
  })

  it('sem sessao responde 401', async () => {
    const c = await buildApp(null)
    app = c.app

    expect((await app.inject({ method: 'GET', url: '/produtos/sugestoes' })).statusCode).toBe(401)
  })
})

describe('importacao de catalogo — NR-072, US-008', () => {
  const linha = (description: string, over: Record<string, unknown> = {}) => ({
    description,
    unitOfMeasure: 'un',
    salePriceCents: 1000,
    costPriceCents: 400,
    ...over,
  })

  it('importa o lote e devolve 200, e nao 201', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/produtos/importacao',
      payload: { products: [linha('Cafe'), linha('Acucar')] },
    })

    /*
     * 200 e nao 201 porque o lote pode ter entrado inteiro, pela metade ou
     * nada — e 201 diria "criei" para um pedido em que talvez nada tenha sido
     * criado.
     */
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ imported: 2, rejected: [] })
  })

  it('recusa a linha ruim e importa o resto, dizendo qual falhou', async () => {
    const c = await buildApp()
    app = c.app

    await app.inject({
      method: 'POST',
      url: '/produtos',
      payload: linha('Ja existe', { barcode: '7891234567895' }),
    })

    const r = await app.inject({
      method: 'POST',
      url: '/produtos/importacao',
      payload: {
        products: [linha('Cafe'), linha('Repetido', { barcode: '7891234567895' })],
      },
    })

    expect(r.json().imported).toBe(1)
    expect(r.json().rejected).toHaveLength(1)
    expect(r.json().rejected[0]).toMatchObject({ index: 1, description: 'Repetido' })
  })

  it('grava o saldo inicial como movimento de estoque', async () => {
    const c = await buildApp()
    app = c.app

    await app.inject({
      method: 'POST',
      url: '/produtos/importacao',
      payload: { products: [linha('Cafe', { stock: 40 })] },
    })

    /* Movimento, e nao coluna escrita direto: o saldo e consequencia da trilha
       (RF-124). Antes disto, `stock` era aceito e descartado em silencio. */
    expect(c.memoria.inventario.movimentos).toHaveLength(1)
    expect(c.memoria.inventario.movimentos[0]).toMatchObject({
      quantityDelta: 40,
      balanceAfter: 40,
    })
  })

  it('recusa forma invalida no contrato, antes de tocar em qualquer linha', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/produtos/importacao',
      /* Preco de venda abaixo do custo: quem recusa e o contrato, e a recusa
         vale para o lote inteiro — forma errada nao e "linha ignorada". */
      payload: { products: [linha('Prejuizo', { salePriceCents: 100, costPriceCents: 900 })] },
    })

    expect(r.statusCode).toBe(400)
    expect(c.memoria.produtos).toHaveLength(0)
  })

  it('recusa lote acima do teto', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/produtos/importacao',
      payload: { products: Array.from({ length: 501 }, (_, i) => linha(`P${i}`)) },
    })

    expect(r.statusCode).toBe(400)
  })

  it('recusa lote vazio em vez de responder "importei zero"', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({
      method: 'POST',
      url: '/produtos/importacao',
      payload: { products: [] },
    })

    expect(r.statusCode).toBe(400)
  })
})

describe('a ficha do produto — RF-017', () => {
  const CAFE = {
    description: 'Cafe torrado 500g',
    unitOfMeasure: 'un' as const,
    salePriceCents: 1990,
    costPriceCents: 1200,
  }

  it('devolve o produto pelo id, mesmo sem codigo de barras', async () => {
    const c = await buildApp()
    app = c.app
    const criado = await app.inject({ method: 'POST', url: '/produtos', payload: CAFE })

    /* O motivo de a rota existir ao lado da de codigo de barras: granel e
       etiqueta amassada nao tem EAN, e a ficha tem de abrir para eles. */
    expect(criado.json().barcode).toBeNull()

    const r = await app.inject({ method: 'GET', url: `/produtos/${criado.json().id}` })

    expect(r.statusCode).toBe(200)
    expect(r.json().internalCode).toBe(criado.json().internalCode)
  })

  it('id desconhecido responde 404, e nao 200 com corpo vazio', async () => {
    const c = await buildApp()
    app = c.app

    expect((await app.inject({ method: 'GET', url: '/produtos/prod-999' })).statusCode).toBe(404)
  })

  it('produto de outra empresa responde 404, e nao 403', async () => {
    const c = await buildApp()
    app = c.app
    const criado = await app.inject({ method: 'POST', url: '/produtos', payload: CAFE })
    await app.close()

    /* O MESMO banco, outra loja: o produto existe, e some por isolamento e nao
       por a tabela estar vazia. 403 confirmaria que aquele id existe. */
    const outra = await buildApp({ ...PRINCIPAL, companyId: 'emp-outra' }, c.memoria)
    app = outra.app

    const r = await app.inject({ method: 'GET', url: `/produtos/${criado.json().id}` })

    expect(r.statusCode).toBe(404)
  })

  /*
   * `/produtos/:id` e um curinga sob `/produtos/`, e convive com quatro rotas
   * estaticas irmas. Se ele casasse primeiro, "catalogo" viraria um id
   * procurado e cada uma dessas telas receberia 404.
   */
  it.each([
    ['/produtos/catalogo', 200],
    ['/produtos/resumo', 200],
  ])('%s continua sendo a rota estatica, e nao um id', async (url, esperado) => {
    const c = await buildApp()
    app = c.app

    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(esperado)
  })

  it('o codigo de barras continua tendo rota propria', async () => {
    const c = await buildApp()
    app = c.app
    await app.inject({
      method: 'POST',
      url: '/produtos',
      payload: { ...CAFE, barcode: '7891234567895' },
    })

    const r = await app.inject({
      method: 'GET',
      url: '/produtos/codigo-de-barras/7891234567895',
    })

    expect(r.statusCode).toBe(200)
    expect(r.json().description).toBe('Cafe torrado 500g')
  })
})

describe('o cadastro da propria loja — RF-003', () => {
  /** Cria a empresa e devolve o app ja falando como ela. */
  async function comEmpresa(extra: Record<string, unknown> = {}) {
    const c = await buildApp()
    app = c.app
    const criada = await app.inject({
      method: 'POST',
      url: '/empresas',
      payload: { ...EMPRESA, ...extra },
    })
    await app.close()

    /* O MESMO banco, agora com o principal apontando para a empresa criada:
       e o que a sessao faz depois do cadastro. */
    const dentro = await buildApp({ ...PRINCIPAL, companyId: criada.json().id }, c.memoria)
    app = dentro.app
    return { ...dentro, empresa: criada.json() }
  }

  it('devolve o cadastro da empresa do contexto', async () => {
    await comEmpresa()

    const r = await app.inject({ method: 'GET', url: '/empresa' })

    expect(r.statusCode).toBe(200)
    expect(r.json().cnpj).toBe(EMPRESA.cnpj)
  })

  it('grava inscricoes e ramo — antes eram digitados e descartados', async () => {
    await comEmpresa({
      stateRegistration: '9076288293',
      municipalRegistration: '112233',
      businessSegment: 'Mercearia e minimercado',
    })

    const r = await app.inject({ method: 'GET', url: '/empresa' })

    expect(r.json().stateRegistration).toBe('9076288293')
    expect(r.json().municipalRegistration).toBe('112233')
    expect(r.json().businessSegment).toBe('Mercearia e minimercado')
  })

  /* MEI nao tem inscricao estadual, e a RF-001 nao pede nenhum dos tres.
     Exigi-los quebraria o cadastro de conta, que e a primeira coisa que o
     lojista faz. */
  it('empresa sem os fiscais volta com os tres NULOS, e nao com erro', async () => {
    await comEmpresa()

    const r = await app.inject({ method: 'GET', url: '/empresa' })

    expect(r.json().stateRegistration).toBeNull()
    expect(r.json().businessSegment).toBeNull()
  })

  it('atualiza o que veio e responde 200', async () => {
    await comEmpresa()

    const r = await app.inject({
      method: 'PUT',
      url: '/empresa',
      payload: { tradeName: 'Mercearia Sol', stateRegistration: 'ISENTO' },
    })

    expect(r.statusCode).toBe(200)
    expect(r.json().tradeName).toBe('Mercearia Sol')
    /* "ISENTO" e valor legitimo em varios estados: um formato numerico fixo
       recusaria empresa de verdade. */
    expect(r.json().stateRegistration).toBe('ISENTO')
  })

  /*
   * O defeito que este teste guarda: com um UPDATE que grava tudo, salvar a
   * aba de endereco limparia a inscricao estadual preenchida na aba fiscal.
   */
  it('campo ausente NAO apaga o que ja estava', async () => {
    await comEmpresa({ stateRegistration: '9076288293' })

    await app.inject({
      method: 'PUT',
      url: '/empresa',
      payload: { address: { city: 'Curitiba', state: 'PR' } },
    })

    const r = await app.inject({ method: 'GET', url: '/empresa' })

    expect(r.json().address.city).toBe('Curitiba')
    expect(r.json().stateRegistration).toBe('9076288293')
  })

  it('o CNPJ nao entra na atualizacao — trocar CNPJ e outra empresa', async () => {
    await comEmpresa()

    const r = await app.inject({
      method: 'PUT',
      url: '/empresa',
      payload: { cnpj: '11222333000181' },
    })

    /* Recusado pelo `.strict()`, e nao ignorado em silencio: ignorar
       responderia 200 para um pedido que nao foi atendido. */
    expect(r.statusCode).toBe(400)
  })

  it('corpo vazio responde 400, e nao 200 sem ter mudado nada', async () => {
    await comEmpresa()

    const r = await app.inject({ method: 'PUT', url: '/empresa', payload: {} })

    expect(r.statusCode).toBe(400)
  })

  it('accountant le, mas nao escreve', async () => {
    const c = await comEmpresa()
    await app.close()

    const leitor = await buildApp(
      { ...PRINCIPAL, companyId: c.empresa.id, role: 'accountant' },
      c.memoria,
    )
    app = leitor.app

    /* Fechar o mes exige CNPJ e inscricoes; mudar o cadastro nao. */
    expect((await app.inject({ method: 'GET', url: '/empresa' })).statusCode).toBe(200)
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/empresa',
          payload: { tradeName: 'Outro' },
        })
      ).statusCode,
    ).toBe(403)
  })

  it('sem sessao responde 401', async () => {
    const c = await buildApp(null)
    app = c.app

    expect((await app.inject({ method: 'GET', url: '/empresa' })).statusCode).toBe(401)
  })

  /* `/empresa` no singular convive com `/empresas` do cadastro: sao rotas
     diferentes, e trocar uma pela outra criaria empresa ao tentar ler. */
  it('nao confunde /empresa com /empresas', async () => {
    const c = await buildApp()
    app = c.app

    const r = await app.inject({ method: 'POST', url: '/empresas', payload: EMPRESA })

    expect(r.statusCode).toBe(201)
  })
})
