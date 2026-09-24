import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import type { Role } from '@na-regua/contracts'
import type { ExecutionContext } from '../context.js'
import {
  InMemoryCepLookup,
  InMemoryCompanyRepository,
  InMemoryCustomerRepository,
  InMemoryProductRepository,
} from './fakes.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import { InMemoryInventory } from '../inventory/fakes.js'
import type { ProductRepository } from '../ports/registration-repositories.js'
import { InMemoryChartOfAccounts } from '../accounting/fakes.js'
import { PLANO_DE_CONTAS_PADRAO } from '../accounting/default-chart.js'
import { registerCompany } from './register-company.js'
import { getCompany, updateCompany } from './manage-company.js'
import {
  assertIdentifiable,
  checkCustomerWalletByQuery,
  deleteCustomer,
  getCustomer,
  listCustomers,
  registerCustomer,
  restoreCustomer,
} from './register-customer.js'
import {
  catalogSummary,
  findProductByBarcode,
  getProduct,
  importProducts,
  generateInternalCode,
  listCatalog,
  productSuggestions,
  registerProduct,
  registerProductWithStock,
} from './register-product.js'

const AGORA = new Date('2026-09-02T13:00:00.000Z')

function contexto(sobrescreve: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: 'emp-1',
    userId: 'usr-1',
    role: 'owner' as Role,
    channel: 'app',
    requestId: 'req-1',
    now: AGORA,
    ...sobrescreve,
  }
}

/** Sem CEP semeado em teste nenhum aqui — a geocodificacao tem cobertura propria em geocoding.test.ts. */
const cepLookup = new InMemoryCepLookup()

const empresaValida = {
  legalName: 'Mercearia do Joao LTDA',
  cnpj: '12345678000195',
  email: 'joao@mercearia.local',
  phone: '4133330000',
}

describe('registerCompany — RF-001, RF-002', () => {
  it('cadastra a empresa', async () => {
    const companies = new InMemoryCompanyRepository()
    const accounts = new InMemoryChartOfAccounts()

    const empresa = await registerCompany(
      { companies, accounts, cepLookup },
      contexto(),
      empresaValida,
    )

    expect(empresa.cnpj).toBe('12345678000195')
    expect(empresa.createdAt).toBe(AGORA.toISOString())
  })

  it('usa a razao social como nome fantasia quando ele nao vem', async () => {
    const companies = new InMemoryCompanyRepository()
    const accounts = new InMemoryChartOfAccounts()
    const empresa = await registerCompany(
      { companies, accounts, cepLookup },
      contexto(),
      empresaValida,
    )
    expect(empresa.tradeName).toBe('Mercearia do Joao LTDA')
  })

  it('recusa CNPJ repetido', async () => {
    const companies = new InMemoryCompanyRepository()
    const accounts = new InMemoryChartOfAccounts()
    await registerCompany({ companies, accounts, cepLookup }, contexto(), empresaValida)

    await expect(
      registerCompany({ companies, accounts, cepLookup }, contexto(), empresaValida),
    ).rejects.toThrow(/ja tem cadastro/i)
  })

  it('nao revela nada da empresa existente na recusa — RF-002', async () => {
    const companies = new InMemoryCompanyRepository()
    const accounts = new InMemoryChartOfAccounts()
    await registerCompany({ companies, accounts, cepLookup }, contexto(), empresaValida)

    expect.assertions(3)
    try {
      await registerCompany({ companies, accounts, cepLookup }, contexto(), {
        ...empresaValida,
        legalName: 'Outra Empresa ME',
      })
    } catch (erro) {
      if (!isAppError(erro)) throw erro
      expect(erro.code).toBe('CONFLICT')
      /*
       * A mensagem nao pode conter razao social, e-mail nem telefone da
       * empresa ja cadastrada: com eles, o formulario de cadastro vira um
       * consultor de CNPJ para qualquer um.
       */
      expect(erro.message).not.toContain('Mercearia')
      expect(erro.message).not.toContain('joao@mercearia.local')
    }
  })

  it('a empresa nasce com o plano de contas padrao — RF-081', async () => {
    const companies = new InMemoryCompanyRepository()
    const accounts = new InMemoryChartOfAccounts()

    const empresa = await registerCompany(
      { companies, accounts, cepLookup },
      contexto(),
      empresaValida,
    )

    /*
     * Sem isto o lojista abre a tela de classificacao vazia, e a resposta
     * pratica dele e nao classificar nada — o que reduz o DRE a uma linha so.
     */
    const plano = await accounts.list(empresa.id)
    expect(plano).toHaveLength(PLANO_DE_CONTAS_PADRAO.length)
    expect(plano.every((c) => c.isDefault)).toBe(true)
  })

  it('semear duas vezes nao duplica o plano', async () => {
    const companies = new InMemoryCompanyRepository()
    const accounts = new InMemoryChartOfAccounts()

    const empresa = await registerCompany(
      { companies, accounts, cepLookup },
      contexto(),
      empresaValida,
    )
    /* A semeadura roda fora da transacao da empresa: refazer precisa ser
       seguro, senao a recuperacao de uma falha parcial deixa o plano em dobro. */
    await accounts.insertDefaults(empresa.id, PLANO_DE_CONTAS_PADRAO, 'usr-1', AGORA)

    expect(await accounts.list(empresa.id)).toHaveLength(PLANO_DE_CONTAS_PADRAO.length)
  })

  it('nao exige papel na empresa, porque ela ainda nao existe', async () => {
    const companies = new InMemoryCompanyRepository()
    const accounts = new InMemoryChartOfAccounts()

    /*
     * Unico caso de uso de escrita sem `assertCanWrite`. Quem cria a empresa
     * nao tem papel NELA — e `accountant` aqui e o papel que a pessoa tem em
     * outra loja, que nao diz nada sobre esta.
     */
    const empresa = await registerCompany(
      { companies, accounts, cepLookup },
      contexto({ role: 'accountant' as Role }),
      empresaValida,
    )
    expect(empresa.id).toBeTruthy()
  })
})

describe('registerCustomer — RF-009, RF-010', () => {
  it('cadastra exigindo apenas o nome', async () => {
    const customers = new InMemoryCustomerRepository()

    const r = await registerCustomer({ customers }, contexto(), { name: 'Joao do Bar' })

    expect(r.status).toBe('created')
    if (r.status !== 'created') return
    expect(r.customer.phone).toBeNull()
    /* Nao deve nada e zero, nao nulo. */
    expect(r.customer.walletBalanceCents).toBe(0)
  })

  it('avisa do parecido por telefone em vez de recusar — RF-010', async () => {
    const customers = new InMemoryCustomerRepository()
    await registerCustomer({ customers }, contexto(), { name: 'Joao', phone: '41999990000' })

    const r = await registerCustomer({ customers }, contexto(), {
      name: 'Joao da Silva',
      phone: '41999990000',
    })

    /*
     * "Achei alguem parecido" nao e erro, e pergunta — e a resposta e do
     * balcao, com o cliente na frente. Por isso e resultado, nao excecao.
     */
    expect(r.status).toBe('duplicate_found')
    if (r.status !== 'duplicate_found') return
    expect(r.candidates.map((c) => c.name)).toEqual(['Joao'])
  })

  it('avisa do parecido por documento', async () => {
    const customers = new InMemoryCustomerRepository()
    await registerCustomer({ customers }, contexto(), { name: 'Maria', document: '12345678909' })

    const r = await registerCustomer({ customers }, contexto(), {
      name: 'Maria Souza',
      document: '12345678909',
    })

    expect(r.status).toBe('duplicate_found')
  })

  it('cadastra mesmo assim quando o balcao confirma', async () => {
    const customers = new InMemoryCustomerRepository()
    await registerCustomer({ customers }, contexto(), { name: 'Joao', phone: '41999990000' })

    const r = await registerCustomer(
      { customers },
      contexto(),
      { name: 'Pedro', phone: '41999990000' },
      { allowDuplicate: true },
    )

    /* Dois irmaos com o mesmo telefone de casa acontece; recusar travaria a
       venda dos dois. */
    expect(r.status).toBe('created')
  })

  it('nao procura parecido quando nao ha telefone nem documento', async () => {
    const customers = new InMemoryCustomerRepository()
    await registerCustomer({ customers }, contexto(), { name: 'Cliente Balcao' })

    const r = await registerCustomer({ customers }, contexto(), { name: 'Cliente Balcao' })

    /* Dois "Cliente Balcao" sem contato nenhum nao sao duplicata detectavel —
       e travar por homonimo travaria o balcao. */
    expect(r.status).toBe('created')
  })

  it('nao ve o cliente de outra empresa como parecido', async () => {
    const customers = new InMemoryCustomerRepository()
    await registerCustomer({ customers }, contexto({ companyId: 'emp-1' }), {
      name: 'Joao',
      phone: '41999990000',
    })

    const r = await registerCustomer({ customers }, contexto({ companyId: 'emp-2' }), {
      name: 'Joao',
      phone: '41999990000',
    })

    /* Se o filtro por empresa falhasse, uma loja veria o cadastro da outra —
       e o teste passaria se o falso nao filtrasse de verdade. */
    expect(r.status).toBe('created')
  })

  it('recusa escrita de quem so pode ler', async () => {
    const customers = new InMemoryCustomerRepository()

    await expect(
      registerCustomer({ customers }, contexto({ role: 'accountant' as Role }), { name: 'X' }),
    ).rejects.toThrow(/somente de leitura/i)
  })

  it('assertIdentifiable recusa cliente sem telefone e sem documento', async () => {
    const customers = new InMemoryCustomerRepository()
    const r = await registerCustomer({ customers }, contexto(), { name: 'Anonimo' })
    if (r.status !== 'created') throw new Error('esperava created')

    expect(() => assertIdentifiable(r.customer)).toThrow(/telefone nem documento/i)
  })

  it('assertIdentifiable aceita quem tem so telefone', async () => {
    const customers = new InMemoryCustomerRepository()
    const r = await registerCustomer({ customers }, contexto(), {
      name: 'Joao',
      phone: '41999990000',
    })
    if (r.status !== 'created') throw new Error('esperava created')

    expect(() => assertIdentifiable(r.customer)).not.toThrow()
  })
})

describe('getCustomer — RF-011', () => {
  it('devolve a ficha com o endereco que foi cadastrado', async () => {
    const customers = new InMemoryCustomerRepository()
    const r = await registerCustomer({ customers }, contexto(), {
      name: 'Joao do Bar',
      phone: '41999990000',
      address: { zipCode: '80010000', city: 'Curitiba', state: 'PR' },
    })
    if (r.status !== 'created') throw new Error('esperava created')

    const ficha = await getCustomer({ customers }, contexto(), r.customer.id)

    expect(ficha.address.city).toBe('Curitiba')
    expect(ficha.address.state).toBe('PR')
    /* O que nao foi informado volta `null`, e nao ausente: a tela distingue
       "nao tem numero" de "esqueci de mandar o campo". */
    expect(ficha.address.number).toBeNull()
  })

  it('cliente de outra empresa responde NOT_FOUND, e nao FORBIDDEN', async () => {
    const customers = new InMemoryCustomerRepository()
    const r = await registerCustomer({ customers }, contexto({ companyId: 'emp-1' }), {
      name: 'Joao do Bar',
      phone: '41999990000',
    })
    if (r.status !== 'created') throw new Error('esperava created')

    /* FORBIDDEN confirmaria que o id existe em alguma loja — quem varre ids
       aprenderia o cadastro do vizinho sem nunca ler uma linha dele. */
    const erro = await getCustomer(
      { customers },
      contexto({ companyId: 'emp-2' }),
      r.customer.id,
    ).catch((e: unknown) => e)

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })

  it('id que nunca existiu responde NOT_FOUND', async () => {
    const customers = new InMemoryCustomerRepository()

    const erro = await getCustomer({ customers }, contexto(), 'cli-inexistente').catch(
      (e: unknown) => e,
    )

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })
})

describe('excluir e reativar cliente — RF-009', () => {
  async function comCliente(sobrescreve: Record<string, unknown> = {}) {
    const customers = new InMemoryCustomerRepository()
    const r = await registerCustomer({ customers }, contexto(), {
      name: 'Joao do Bar',
      phone: '41999990000',
      ...sobrescreve,
    })
    if (r.status !== 'created') throw new Error('esperava created')

    return { customers, id: r.customer.id }
  }

  const PAGINA = { filter: 'todos' as const, page: 1, pageSize: 24 }

  it('cliente nasce ativo', async () => {
    const { customers, id } = await comCliente()

    const ficha = await getCustomer({ customers }, contexto(), id)

    expect(ficha.deletedAt).toBeNull()
  })

  it('excluido sai da lista', async () => {
    const { customers, id } = await comCliente()

    await deleteCustomer({ customers }, contexto(), id)
    const lista = await listCustomers({ customers }, contexto(), PAGINA)

    expect(lista.total).toBe(0)
    expect(lista.customers).toHaveLength(0)
  })

  /*
   * A ficha continua abrindo, e e isso que torna a exclusao reversivel: e nela
   * que mora o botao de trazer de volta. Se `findById` escondesse o excluido,
   * "desfazer" so existiria por SQL a mao.
   */
  it('a ficha do excluido continua abrindo, com a data', async () => {
    const { customers, id } = await comCliente()

    await deleteCustomer({ customers }, contexto(), id)
    const ficha = await getCustomer({ customers }, contexto(), id)

    expect(ficha.deletedAt).toBe(AGORA.toISOString())
  })

  it('reativar traz de volta para a lista', async () => {
    const { customers, id } = await comCliente()

    await deleteCustomer({ customers }, contexto(), id)
    await restoreCustomer({ customers }, contexto(), id)

    const lista = await listCustomers({ customers }, contexto(), PAGINA)
    expect(lista.total).toBe(1)

    const ficha = await getCustomer({ customers }, contexto(), id)
    expect(ficha.deletedAt).toBeNull()
  })

  /*
   * Sumir da lista um cliente que deve e esconder a divida de quem precisa
   * cobra-la: o saldo continuaria somando no relatorio, sem ninguem para
   * associar a ele.
   */
  it('recusa excluir quem tem fiado em aberto', async () => {
    const customers = new InMemoryCustomerRepository()
    const r = await registerCustomer({ customers }, contexto(), { name: 'Devedor' })
    if (r.status !== 'created') throw new Error('esperava created')

    /* O falso nao movimenta fiado; o saldo entra direto, que e o estado que o
       caso de uso le. */
    customers.definirSaldoCarteira(r.customer.id, 5000)

    const erro = await deleteCustomer({ customers }, contexto(), r.customer.id).catch(
      (e: unknown) => e,
    )

    expect(isAppError(erro) && erro.code).toBe('CONFLICT')
  })

  /* Dois cliques no botao nao viram erro na tela: o estado pedido ja e o atual. */
  it('excluir duas vezes e sucesso, nao conflito', async () => {
    const { customers, id } = await comCliente()

    await deleteCustomer({ customers }, contexto(), id)
    await expect(deleteCustomer({ customers }, contexto(), id)).resolves.toBeUndefined()
  })

  it('cliente de outra empresa responde NOT_FOUND', async () => {
    const { customers, id } = await comCliente()

    const erro = await deleteCustomer({ customers }, contexto({ companyId: 'emp-2' }), id).catch(
      (e: unknown) => e,
    )

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })

  /*
   * Excluido nao conta como parecido: cadastrar de novo alguem que saiu da
   * lista e o caminho normal, e oferecer "ja existe" ali confundiria.
   */
  it('excluido nao aparece como duplicado num cadastro novo', async () => {
    const { customers, id } = await comCliente()
    await deleteCustomer({ customers }, contexto(), id)

    const r = await registerCustomer({ customers }, contexto(), {
      name: 'Joao do Bar',
      phone: '41999990000',
    })

    expect(r.status).toBe('created')
  })
})

describe('checkCustomerWalletByQuery — US3 / NR-115', () => {
  it('devolve saldo devedor para candidato unico', async () => {
    const customers = new InMemoryCustomerRepository()
    const r = await registerCustomer({ customers }, contexto(), {
      name: 'Maria Devedora',
      phone: '41999991111',
    })
    if (r.status !== 'created') throw new Error('esperava created')
    customers.definirSaldoCarteira(r.customer.id, 3_500)

    const consulta = await checkCustomerWalletByQuery({ customers }, contexto(), { query: 'Maria' })

    expect(consulta).toEqual({
      status: 'found',
      customerName: 'Maria Devedora',
      walletBalanceCents: 3_500,
    })
  })

  it('declara saldo zerado explicitamente', async () => {
    const customers = new InMemoryCustomerRepository()
    await registerCustomer({ customers }, contexto(), {
      name: 'Joao Quitado',
      phone: '41999992222',
    })

    const consulta = await checkCustomerWalletByQuery({ customers }, contexto(), {
      query: 'Joao Quitado',
    })

    expect(consulta).toEqual({
      status: 'found',
      customerName: 'Joao Quitado',
      walletBalanceCents: 0,
    })
  })

  it('nao encontra cliente ausente', async () => {
    const customers = new InMemoryCustomerRepository()

    const consulta = await checkCustomerWalletByQuery({ customers }, contexto(), {
      query: 'Inexistente',
    })

    expect(consulta).toEqual({ status: 'not_found' })
  })

  it('nao escolhe entre homonimos', async () => {
    const customers = new InMemoryCustomerRepository()
    const a = await registerCustomer({ customers }, contexto(), {
      name: 'Maria Silva',
      phone: '41999993333',
    })
    const b = await registerCustomer({ customers }, contexto(), {
      name: 'Maria Souza',
      phone: '41999994444',
    })
    if (a.status !== 'created' || b.status !== 'created') throw new Error('esperava created')
    customers.definirSaldoCarteira(a.customer.id, 1_000)
    customers.definirSaldoCarteira(b.customer.id, 2_000)

    const consulta = await checkCustomerWalletByQuery({ customers }, contexto(), { query: 'Maria' })

    expect(consulta.status).toBe('ambiguous')
    if (consulta.status !== 'ambiguous') return
    expect(consulta.alternatives.map((c) => c.name).sort()).toEqual(['Maria Silva', 'Maria Souza'])
  })

  it('nao enxerga cliente de outra empresa', async () => {
    const customers = new InMemoryCustomerRepository()
    const r = await registerCustomer({ customers }, contexto({ companyId: 'emp-2' }), {
      name: 'Maria da outra loja',
      phone: '41999995555',
    })
    if (r.status !== 'created') throw new Error('esperava created')
    customers.definirSaldoCarteira(r.customer.id, 9_000)

    const consulta = await checkCustomerWalletByQuery(
      { customers },
      contexto({ companyId: 'emp-1' }),
      { query: 'Maria' },
    )

    expect(consulta).toEqual({ status: 'not_found' })
  })
})

describe('generateInternalCode — RF-019', () => {
  it.each([
    [0, 'PROD-0001'],
    [1, 'PROD-0002'],
    [41, 'PROD-0042'],
  ])('com %i produtos gera %s', (quantos, esperado) => {
    expect(generateInternalCode(quantos)).toBe(esperado)
  })

  it('nao usa caractere ambiguo', () => {
    /* O codigo vai na etiqueta escrita a mao e e ditado no telefone: `a1b2c3`
       volta como `alb2c3`. Digito e prefixo fixo evitam isso. */
    expect(generateInternalCode(9)).toMatch(/^PROD-\d{4}$/)
  })
})

describe('registerProduct — RF-017, RF-018', () => {
  const produtoValido = {
    description: 'Cafe torrado 500g',
    unitOfMeasure: 'un' as const,
    salePriceCents: 1990,
    costPriceCents: 1200,
    stock: 0,
    minStock: 0,
  }

  it('cadastra e gera codigo interno', async () => {
    const products = new InMemoryProductRepository()

    const p = await registerProduct({ products }, contexto(), produtoValido)

    expect(p.internalCode).toBe('PROD-0001')
    expect(p.barcode).toBeNull()
  })

  /*
   * O defeito que isto guarda: a coluna `products.supplier` existia desde a
   * migration 0007, mas `registerProduct` nunca a repassava — o formulario
   * mandava o fornecedor e ele era descartado antes de chegar ao repositorio.
   */
  it('repassa categoria e fornecedor ao repositorio', async () => {
    const products = new InMemoryProductRepository()

    const p = await registerProduct({ products }, contexto(), {
      ...produtoValido,
      category: 'Mercearia',
      supplier: 'Torrefacao Aurora',
    })

    expect(p.category).toBe('Mercearia')
    expect(p.supplier).toBe('Torrefacao Aurora')
  })

  it('sem categoria nem fornecedor, os dois voltam nulos — nao ausentes', async () => {
    const products = new InMemoryProductRepository()

    const p = await registerProduct({ products }, contexto(), produtoValido)

    expect(p.category).toBeNull()
    expect(p.supplier).toBeNull()
  })

  it('gera codigo interno tambem para produto com codigo de barras', async () => {
    const products = new InMemoryProductRepository()

    const p = await registerProduct({ products }, contexto(), {
      ...produtoValido,
      barcode: '7891234567895',
    })

    /* E por ele que o lojista se refere ao item quando o leitor nao le. */
    expect(p.internalCode).toBe('PROD-0001')
    expect(p.barcode).toBe('7891234567895')
  })

  it('recusa codigo de barras repetido, dizendo em qual produto ele esta', async () => {
    const products = new InMemoryProductRepository()
    await registerProduct({ products }, contexto(), {
      ...produtoValido,
      barcode: '7891234567895',
    })

    /*
     * Dois cadastros para o mesmo EAN deixariam a loja com dois precos para o
     * mesmo produto — e o problema se descobre no dia em que o caixa cobra o
     * barato. Aqui a mensagem PODE nomear o produto: e dado da propria loja.
     */
    await expect(
      registerProduct({ products }, contexto(), {
        ...produtoValido,
        description: 'Cafe outro cadastro',
        barcode: '7891234567895',
      }),
    ).rejects.toThrow(/Cafe torrado 500g/)
  })

  it('o mesmo codigo de barras vale em outra empresa', async () => {
    const products = new InMemoryProductRepository()
    await registerProduct({ products }, contexto({ companyId: 'emp-1' }), {
      ...produtoValido,
      barcode: '7891234567895',
    })

    const p = await registerProduct({ products }, contexto({ companyId: 'emp-2' }), {
      ...produtoValido,
      barcode: '7891234567895',
    })

    /* Duas lojas vendem o mesmo produto: EAN igual nas duas e o caso normal. */
    expect(p.id).toBeTruthy()
  })

  it('a sequencia do codigo interno e por empresa', async () => {
    const products = new InMemoryProductRepository()
    await registerProduct({ products }, contexto({ companyId: 'emp-1' }), produtoValido)
    await registerProduct({ products }, contexto({ companyId: 'emp-1' }), produtoValido)

    const naOutra = await registerProduct(
      { products },
      contexto({ companyId: 'emp-2' }),
      produtoValido,
    )

    expect(naOutra.internalCode).toBe('PROD-0001')
  })

  it('recusa escrita de quem so pode ler', async () => {
    const products = new InMemoryProductRepository()
    await expect(
      registerProduct({ products }, contexto({ role: 'accountant' as Role }), produtoValido),
    ).rejects.toThrow(/somente de leitura/i)
  })

  it('findProductByBarcode devolve undefined em vez de lancar', async () => {
    const products = new InMemoryProductRepository()

    const achado = await findProductByBarcode({ products }, contexto(), '0000000000000')

    /* No PDV, "nao achei" e resposta normal e leva a tela de cadastro. */
    expect(achado).toBeUndefined()
  })

  it('findProductByBarcode acha o da propria empresa e nao o da outra', async () => {
    const products = new InMemoryProductRepository()
    await registerProduct({ products }, contexto({ companyId: 'emp-1' }), {
      ...produtoValido,
      barcode: '7891234567895',
    })

    const naPropria = await findProductByBarcode(
      { products },
      contexto({ companyId: 'emp-1' }),
      '7891234567895',
    )
    const naOutra = await findProductByBarcode(
      { products },
      contexto({ companyId: 'emp-2' }),
      '7891234567895',
    )

    expect(naPropria?.description).toBe('Cafe torrado 500g')
    expect(naOutra).toBeUndefined()
  })
})

describe('getProduct — RF-017', () => {
  const produtoValido = {
    description: 'Cafe torrado 500g',
    unitOfMeasure: 'un' as const,
    salePriceCents: 1990,
    costPriceCents: 1200,
    stock: 0,
    minStock: 0,
  }

  it('abre a ficha de produto SEM codigo de barras — granel, etiqueta amassada', async () => {
    const products = new InMemoryProductRepository()
    const criado = await registerProduct({ products }, contexto(), produtoValido)

    /* O motivo de existir separado de `findProductByBarcode`: este produto nao
       tem codigo nenhum, so o interno gerado, e a ficha tem de abrir. */
    expect(criado.barcode).toBeNull()

    const ficha = await getProduct({ products }, contexto(), criado.id)

    expect(ficha.internalCode).toBe(criado.internalCode)
  })

  /* Ao contrario de `findProductByBarcode`, que devolve `undefined`: no PDV
     "nao achei este codigo" leva ao cadastro; abrir a ficha de um id que nao
     existe e link quebrado, e a tela precisa dizer isso. */
  it('LANCA quando nao acha, em vez de devolver undefined', async () => {
    const products = new InMemoryProductRepository()

    const erro = await getProduct({ products }, contexto(), 'prod-inexistente').catch(
      (e: unknown) => e,
    )

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })

  it('produto de outra empresa cai no mesmo NOT_FOUND, e nao em FORBIDDEN', async () => {
    const products = new InMemoryProductRepository()
    const criado = await registerProduct(
      { products },
      contexto({ companyId: 'emp-1' }),
      produtoValido,
    )

    const erro = await getProduct({ products }, contexto({ companyId: 'emp-2' }), criado.id).catch(
      (e: unknown) => e,
    )

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })
})

describe('catalogo do backoffice — NR-072, US-008', () => {
  const base = {
    unitOfMeasure: 'un' as const,
    salePriceCents: 1000,
    costPriceCents: 400,
    stock: 0,
    minStock: 5,
  }

  /** Cinco produtos, com saldos que cobrem os tres niveis de estoque. */
  async function catalogo() {
    const products = new InMemoryProductRepository()

    const criados = []
    for (const description of ['Cafe', 'Acucar', 'Biscoito', 'Detergente', 'Erva-mate']) {
      criados.push(await registerProduct({ products }, contexto(), { ...base, description }))
    }

    /* Cafe esgotado, Acucar abaixo do minimo, o resto normal. */
    products.definirEstoque(criados[0]!.id, 0)
    products.definirEstoque(criados[1]!.id, 2)
    products.definirEstoque(criados[2]!.id, 10)
    products.definirEstoque(criados[3]!.id, 10)
    products.definirEstoque(criados[4]!.id, 10)

    return { products, criados }
  }

  const pedido = {
    stock: 'todos' as const,
    page: 1,
    pageSize: 24,
  }

  it('devolve a pagina em ordem de descricao, com o total do catalogo', async () => {
    const { products } = await catalogo()

    const r = await listCatalog({ products }, contexto(), { ...pedido, pageSize: 2 })

    expect(r.products.map((p) => p.description)).toEqual(['Acucar', 'Biscoito'])
    /* CINCO, e nao dois: o total e o que faz a tela dizer "2 de 5". Se ele
       viesse do tamanho da pagina, o lojista nunca saberia que ha mais. */
    expect(r.total).toBe(5)
    expect(r.page).toBe(1)
  })

  it('a segunda pagina continua de onde a primeira parou', async () => {
    const { products } = await catalogo()

    const r = await listCatalog({ products }, contexto(), { ...pedido, page: 2, pageSize: 2 })

    expect(r.products.map((p) => p.description)).toEqual(['Cafe', 'Detergente'])
    expect(r.total).toBe(5)
  })

  it('pagina alem do fim vem vazia, e o total continua dizendo quantos ha', async () => {
    const { products } = await catalogo()

    const r = await listCatalog({ products }, contexto(), { ...pedido, page: 99, pageSize: 2 })

    expect(r.products).toEqual([])
    expect(r.total).toBe(5)
  })

  it('busca por termo estreita o total, e nao so a pagina', async () => {
    const { products } = await catalogo()

    const r = await listCatalog({ products }, contexto(), { ...pedido, q: 'cafe' })

    expect(r.products.map((p) => p.description)).toEqual(['Cafe'])
    /* Se o total ignorasse o filtro, a tela mostraria "1 de 5" numa busca que
       achou um so — e o lojista procuraria os outros quatro. */
    expect(r.total).toBe(1)
  })

  it('filtra esgotados, e zerado NAO conta como estoque baixo', async () => {
    const { products } = await catalogo()

    const esgotados = await listCatalog({ products }, contexto(), { ...pedido, stock: 'esgotado' })
    const baixos = await listCatalog({ products }, contexto(), { ...pedido, stock: 'baixo' })

    expect(esgotados.products.map((p) => p.description)).toEqual(['Cafe'])
    /*
     * Os dois filtros sao EXCLUDENTES na lista, ainda que as contagens do
     * resumo se sobreponham. Quem abre "estoque baixo" quer o que ainda da
     * para vender e esta acabando; o zerado ja tem a propria aba, e aparecer
     * nas duas faria o lojista contar o mesmo produto duas vezes ao repor.
     */
    expect(baixos.products.map((p) => p.description)).toEqual(['Acucar'])
  })

  it('nao enxerga o catalogo da outra loja', async () => {
    const { products } = await catalogo()
    await registerProduct({ products }, contexto({ companyId: 'outra' }), {
      ...base,
      description: 'Farinha',
    })

    const r = await listCatalog({ products }, contexto(), pedido)

    expect(r.total).toBe(5)
    expect(r.products.map((p) => p.description)).not.toContain('Farinha')
  })
})

describe('resumo do catalogo — NR-072', () => {
  it('conta o zerado nas DUAS contagens, porque ele esta nas duas', async () => {
    const products = new InMemoryProductRepository()
    const base = {
      unitOfMeasure: 'un' as const,
      salePriceCents: 1000,
      costPriceCents: 400,
      stock: 0,
      minStock: 5,
    }

    const cafe = await registerProduct({ products }, contexto(), { ...base, description: 'Cafe' })
    const acucar = await registerProduct({ products }, contexto(), {
      ...base,
      description: 'Acucar',
    })
    const cheio = await registerProduct({ products }, contexto(), { ...base, description: 'Sal' })

    products.definirEstoque(cafe.id, 0)
    products.definirEstoque(acucar.id, 2)
    products.definirEstoque(cheio.id, 10)

    const r = await catalogSummary({ products }, contexto())

    expect(r.total).toBe(3)
    /*
     * 2 abaixo do minimo (Cafe e Acucar) e 1 esgotado (Cafe): o Cafe entra nos
     * dois. Sao contagens que se SOBREPOEM, e nao parcelas de um total —
     * somá-las daria 3 de 3 produtos precisando de reposicao, quando sao 2.
     */
    expect(r.belowMinimum).toBe(2)
    expect(r.outOfStock).toBe(1)
  })

  it('valor em estoque e a preco de CUSTO, sobre o catalogo inteiro', async () => {
    const products = new InMemoryProductRepository()

    const p = await registerProduct({ products }, contexto(), {
      description: 'Cafe',
      unitOfMeasure: 'un' as const,
      salePriceCents: 2000,
      costPriceCents: 700,
      stock: 0,
      minStock: 0,
    })
    products.definirEstoque(p.id, 3)

    const r = await catalogSummary({ products }, contexto())

    /* 3 x 700, e nao 3 x 2000: o que o lojista tem parado e o que ele pagou. */
    expect(r.stockValueCents).toBe(2100)
  })

  it('catalogo vazio devolve zeros, e nao erro', async () => {
    const r = await catalogSummary({ products: new InMemoryProductRepository() }, contexto())

    expect(r).toEqual({ total: 0, belowMinimum: 0, outOfStock: 0, stockValueCents: 0 })
  })
})

describe('sugestoes do formulario — categoria e fornecedor', () => {
  const base = {
    unitOfMeasure: 'un' as const,
    salePriceCents: 1000,
    costPriceCents: 400,
    stock: 0,
    minStock: 0,
  }

  it('devolve so o que ja foi usado, distinto e em ordem', async () => {
    const products = new InMemoryProductRepository()
    await registerProduct({ products }, contexto(), {
      ...base,
      description: 'Cafe',
      category: 'Mercearia',
      supplier: 'Torrefacao Aurora',
    })
    await registerProduct({ products }, contexto(), {
      ...base,
      description: 'Acucar',
      category: 'Mercearia',
      supplier: 'Engenho Doce',
    })

    const r = await productSuggestions({ products }, contexto())

    /* Mercearia aparece nos DOIS produtos — a sugestao nao repete. */
    expect(r.categories).toEqual(['Mercearia'])
    expect(r.suppliers).toEqual(['Engenho Doce', 'Torrefacao Aurora'])
  })

  it('produto sem categoria nem fornecedor nao vira sugestao em branco', async () => {
    const products = new InMemoryProductRepository()
    await registerProduct({ products }, contexto(), { ...base, description: 'Item avulso' })

    const r = await productSuggestions({ products }, contexto())

    expect(r).toEqual({ categories: [], suppliers: [] })
  })

  it('catalogo vazio devolve listas vazias, e nao erro', async () => {
    const r = await productSuggestions({ products: new InMemoryProductRepository() }, contexto())

    expect(r).toEqual({ categories: [], suppliers: [] })
  })
})

describe('importacao de catalogo — NR-072, US-008', () => {
  const linha = (description: string, over: Record<string, unknown> = {}) => ({
    description,
    unitOfMeasure: 'un' as const,
    salePriceCents: 1000,
    costPriceCents: 400,
    stock: 0,
    minStock: 0,
    ...over,
  })

  /**
   * Costura os dois falsos.
   *
   * Em producao o cadastro e o estoque falam da MESMA tabela `products`. Aqui
   * sao dois falsos independentes, e sem esta ligacao o saldo inicial cairia em
   * "produto nao encontrado" — um erro do teste, nao do codigo.
   */
  function cenario() {
    const produtos = new InMemoryProductRepository()
    const inventario = new InMemoryInventory(new InMemoryAuditTrail())

    const products: ProductRepository = {
      create: async (p) => {
        const criado = await produtos.create(p)
        inventario.adicionarProduto(p.companyId, {
          id: criado.id,
          description: criado.description,
          salePriceCents: criado.salePriceCents,
          stockQuantity: 0,
          location: null,
          minStock: criado.minStock,
        })
        return criado
      },
      findByBarcode: (c, b) => produtos.findByBarcode(c, b),
      findById: (c, id) => produtos.findById(c, id),
      search: (c, k) => produtos.search(c, k),
      listCatalog: (c, k) => produtos.listCatalog(c, k),
      catalogSummary: (c) => produtos.catalogSummary(c),
      countAll: (c) => produtos.countAll(c),
      listSuggestions: (c) => produtos.listSuggestions(c),
    }

    return {
      deps: { products, uow: inventario, audit: new InMemoryAuditTrail() },
      inventario,
      produtos,
    }
  }

  it('importa todas as linhas validas e gera codigo interno em sequencia', async () => {
    const c = cenario()

    const r = await importProducts(c.deps, contexto(), {
      products: [linha('Cafe'), linha('Acucar'), linha('Sal')],
    })

    expect(r.imported).toBe(3)
    expect(r.rejected).toEqual([])

    const catalogo = await c.produtos.listCatalog('emp-1', {
      stock: 'todos',
      offset: 0,
      limite: 10,
    })
    /* Em sequencia, e nao em paralelo: em paralelo as tres leriam a mesma
       contagem e receberiam o mesmo PROD-0001. */
    expect(catalogo.produtos.map((p) => p.internalCode).sort()).toEqual([
      'PROD-0001',
      'PROD-0002',
      'PROD-0003',
    ])
  })

  it('uma linha ruim nao derruba as que vem depois dela', async () => {
    const c = cenario()

    /*
     * A recusa e de NEGOCIO — codigo de barras que ja esta em outro produto.
     * Forma invalida (preco abaixo do custo, descricao vazia) e recusada antes,
     * no contrato, e nem chega aqui: quem valida forma e `contracts`, quem
     * valida regra e `core`.
     */
    await registerProduct(c.deps, contexto(), linha('Ja cadastrado', { barcode: '7891234567895' }))

    const r = await importProducts(c.deps, contexto(), {
      products: [linha('Cafe'), linha('Repetido', { barcode: '7891234567895' }), linha('Sal')],
    })

    expect(r.imported).toBe(2)
    expect(r.rejected).toHaveLength(1)
    /* O indice e a descricao sao o que permite achar a linha na planilha. */
    expect(r.rejected[0]).toMatchObject({ index: 1, description: 'Repetido' })

    /* E a linha 2 entrou: a recusa nao interrompeu o lote. */
    const catalogo = await c.produtos.listCatalog('emp-1', {
      stock: 'todos',
      offset: 0,
      limite: 10,
    })
    expect(catalogo.produtos.map((p) => p.description)).toContain('Sal')
  })

  it('recusa codigo de barras repetido dentro do proprio lote', async () => {
    const c = cenario()

    const r = await importProducts(c.deps, contexto(), {
      products: [
        linha('Cafe', { barcode: '7891234567895' }),
        linha('Cafe de novo', { barcode: '7891234567895' }),
      ],
    })

    expect(r.imported).toBe(1)
    expect(r.rejected[0]?.reason).toMatch(/codigo de barras/i)
  })

  it('saldo inicial vira MOVIMENTO, e nao coluna escrita direto', async () => {
    const c = cenario()

    await importProducts(c.deps, contexto(), { products: [linha('Cafe', { stock: 40 })] })

    const [movimento] = c.inventario.movimentos

    expect(movimento?.quantityDelta).toBe(40)
    expect(movimento?.balanceAfter).toBe(40)
    /* Sem o movimento, o saldo seria um numero que a trilha nao explica —
       e a trilha existe justamente para explicar (RF-124). */
    expect(movimento?.reason).toMatch(/inicial/i)
  })

  it('recusa NCM que a tabela oficial diz que nao existe, no campo ncm', async () => {
    const c = cenario()
    const deps = {
      ...c.deps,
      ncmLookup: { consultar: async () => ({ status: 'inexistente' as const }) },
    }

    await expect(
      registerProduct(deps, contexto(), linha('Cafe', { ncm: '99999999' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', fields: [{ path: 'ncm' }] })
  })

  it('provedor de NCM fora do ar nao trava o cadastro', async () => {
    const c = cenario()
    const deps = {
      ...c.deps,
      ncmLookup: { consultar: async () => ({ status: 'indisponivel' as const }) },
    }

    const produto = await registerProduct(deps, contexto(), linha('Cafe', { ncm: '09011110' }))

    expect(produto.ncm).toBe('09011110')
  })

  it('estoque zero nao gera movimento de zero unidade', async () => {
    const c = cenario()

    await importProducts(c.deps, contexto(), { products: [linha('Cafe', { stock: 0 })] })

    /* Movimento que nao move nada e ruido na trilha, e o CHECK do schema o
       recusa de qualquer jeito. */
    expect(c.inventario.movimentos).toHaveLength(0)
  })

  it('o cadastro avulso tambem grava o saldo inicial, e nao o descarta', async () => {
    const c = cenario()

    /*
     * A tela pedia "Quantidade atual" e o produto nascia zerado: so a
     * importacao lancava o saldo. Tela, planilha e assistente passam agora pela
     * mesma funcao.
     */
    const produto = await registerProductWithStock(c.deps, contexto(), linha('Cafe', { stock: 12 }))

    const [movimento] = c.inventario.movimentos
    expect(movimento?.productId).toBe(produto.id)
    expect(movimento?.quantityDelta).toBe(12)
    expect(movimento?.reason).toBe('Saldo inicial do cadastro')
  })

  it('cadastro avulso sem estoque nao gera movimento', async () => {
    const c = cenario()

    await registerProductWithStock(c.deps, contexto(), linha('Cafe', { stock: 0 }))

    expect(c.inventario.movimentos).toHaveLength(0)
  })

  it('quem nao pode escrever recebe UMA negativa, e nao 500 linhas recusadas', async () => {
    const c = cenario()

    await expect(
      importProducts(c.deps, contexto({ role: 'accountant' as Role }), {
        products: [linha('Cafe'), linha('Sal')],
      }),
    ).rejects.toSatisfy(isAppError)
  })

  it('erro desconhecido SOBE em vez de virar linha do relatorio', async () => {
    const c = cenario()

    const explode: ProductRepository = {
      ...c.deps.products,
      create: async () => {
        throw new Error('banco fora do ar')
      },
    }

    /*
     * Se a queda do banco virasse "linha invalida", a tela diria "298
     * importados, 2 ignorados" para um lote que na verdade parou no meio.
     */
    await expect(
      importProducts({ ...c.deps, products: explode }, contexto(), {
        products: [linha('Cafe')],
      }),
    ).rejects.toThrow('banco fora do ar')
  })
})

describe('o cadastro da propria loja — RF-003', () => {
  /** Cadastra e devolve o contexto ja apontando para ela — como a sessao faz. */
  async function comEmpresa(extra: Record<string, unknown> = {}) {
    const companies = new InMemoryCompanyRepository()
    const accounts = new InMemoryChartOfAccounts()

    const empresa = await registerCompany({ companies, accounts, cepLookup }, contexto(), {
      ...empresaValida,
      ...extra,
    })

    return { companies, ctx: contexto({ companyId: empresa.id }), empresa }
  }

  it('devolve a empresa do contexto', async () => {
    const c = await comEmpresa()

    expect((await getCompany({ companies: c.companies, cepLookup }, c.ctx)).cnpj).toBe(
      empresaValida.cnpj,
    )
  })

  it('empresa sem os fiscais volta com eles NULOS, e nao com erro', async () => {
    const c = await comEmpresa()

    const lida = await getCompany({ companies: c.companies, cepLookup }, c.ctx)

    /* MEI nao tem inscricao estadual, e a RF-001 nao pede nenhum dos tres:
       exigi-los quebraria o cadastro de conta. */
    expect(lida.stateRegistration).toBeNull()
    expect(lida.businessSegment).toBeNull()
  })

  it('empresa que sumiu responde NOT_FOUND, e nao um cadastro em branco', async () => {
    const companies = new InMemoryCompanyRepository()

    const erro = await getCompany(
      { companies, cepLookup },
      contexto({ companyId: 'emp-fantasma' }),
    ).catch((e: unknown) => e)

    /* Um objeto vazio aqui seria salvo por cima pela tela, que abre com o que
       recebe e grava o que mostra. */
    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })

  it('atualiza o que veio', async () => {
    const c = await comEmpresa()

    const r = await updateCompany({ companies: c.companies, cepLookup }, c.ctx, {
      tradeName: 'Mercearia Sol',
      stateRegistration: 'ISENTO',
    })

    expect(r.tradeName).toBe('Mercearia Sol')
    expect(r.stateRegistration).toBe('ISENTO')
  })

  /* O defeito que a regra evita: salvar a aba de endereco limparia a inscricao
     estadual preenchida na aba fiscal. */
  it('campo ausente NAO apaga o que ja estava', async () => {
    const c = await comEmpresa()
    await updateCompany({ companies: c.companies, cepLookup }, c.ctx, {
      stateRegistration: '9076288293',
    })

    await updateCompany({ companies: c.companies, cepLookup }, c.ctx, {
      address: { city: 'Curitiba', state: 'PR' },
    })

    const lida = await getCompany({ companies: c.companies, cepLookup }, c.ctx)
    expect(lida.address.city).toBe('Curitiba')
    expect(lida.stateRegistration).toBe('9076288293')
  })

  /* Um PUT que responde 200 sem ter mudado nada e indistinguivel de um que
     funcionou, e quem depura um formulario que "nao salva" perde a tarde. */
  it('corpo vazio e recusado, em vez de virar uma escrita sem efeito', async () => {
    const c = await comEmpresa()

    const erro = await updateCompany({ companies: c.companies, cepLookup }, c.ctx, {}).catch(
      (e: unknown) => e,
    )

    expect(isAppError(erro) && erro.code).toBe('VALIDATION_FAILED')
  })

  it('accountant le, mas nao escreve', async () => {
    const c = await comEmpresa()
    const leitor = { ...c.ctx, role: 'accountant' as Role }

    /* Fechar o mes exige CNPJ e inscricoes; mudar o cadastro nao. */
    expect((await getCompany({ companies: c.companies, cepLookup }, leitor)).cnpj).toBe(
      empresaValida.cnpj,
    )

    await expect(
      updateCompany({ companies: c.companies, cepLookup }, leitor, { tradeName: 'Outro' }),
    ).rejects.toThrow(/somente de leitura/i)
  })
})
