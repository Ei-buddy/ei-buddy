import {
  catalogInputSchema,
  createCompanyInputSchema,
  customerListInputSchema,
  createCustomerInputSchema,
  createProductInputSchema,
  importCustomersInputSchema,
  importProductsInputSchema,
  updateCompanyInputSchema,
  createCustomerContactInputSchema,
  recordWhatsappConsentInputSchema,
} from '@na-regua/contracts'
import {
  AppError,
  addCustomerContact,
  catalogSummary,
  getWhatsappConsent,
  type CustomerContactDeps,
  deleteCustomer,
  getCompany,
  getCustomer,
  getProduct,
  importCustomers,
  importProducts,
  type ImportProductsDeps,
  listCatalog,
  listCustomerContacts,
  listCustomers,
  type ManageCompanyDeps,
  productSuggestions,
  recordWhatsappConsent,
  registerCompany,
  type RegisterCompanyDeps,
  restoreCustomer,
  updateCompany,
  registerCustomer,
  type RegisterCustomerDeps,
  registerProductWithStock,
  type RegisterProductDeps,
  type WhatsappConsentDeps,
  searchProducts,
} from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'

/**
 * Rotas de cadastro — NR-026, RF-001 a RF-019.
 *
 * Como as outras: le o contexto, valida a forma, chama o caso de uso, traduz.
 * Deteccao de duplicado, geracao de codigo interno e a recusa de CNPJ repetido
 * ficam em `core` — se morassem aqui, o canal WhatsApp cadastraria por outro
 * caminho, com outras regras.
 */

export type CadastroDeps = CustomerContactDeps &
  WhatsappConsentDeps &
  ImportProductsDeps &
  ManageCompanyDeps &
  RegisterCompanyDeps &
  RegisterCustomerDeps &
  RegisterProductDeps

export function registerCadastroRoutes(app: FastifyInstance, deps: CadastroDeps): void {
  /**
   * Cadastrar empresa — RF-001, RF-002.
   *
   * A unica rota de cadastro que NAO exige sessao com empresa: e ela que cria a
   * empresa. Ainda exige sessao (o `userId` vem do contexto), mas o
   * `companyId` do principal nao e usado — a empresa nasce sob o proprio
   * tenant, e quem orquestra isso e `db`.
   */
  app.post('/empresas', { config: { rateLimit: LIMITE_DE_ESCRITA } }, async (request, reply) => {
    const ctx = requireContext(request)
    const input = validate(createCompanyInputSchema, request.body)

    const empresa = await registerCompany(deps, ctx, input)

    return reply.code(201).send(empresa)
  })

  /**
   * O cadastro da propria loja — RF-003.
   *
   * `/empresa` no singular, e nao `/empresas/:id`. A empresa e a do contexto,
   * e sempre sera: um id no caminho seria um parametro que so pode ter um
   * valor, e um convite a tentar outro.
   */
  app.get('/empresa', async (request, reply) => {
    const ctx = requireContext(request)

    return reply.code(200).send(await getCompany(deps, ctx))
  })

  /**
   * Atualizar o cadastro — RF-003.
   *
   * `PUT` com corpo PARCIAL, e nao `PATCH`. A tela manda o formulario inteiro,
   * que e a leitura natural de PUT; e o contrato e parcial porque o formulario
   * de endereco e o de dados fiscais sao abas diferentes da mesma tela, e cada
   * uma manda o que conhece. Campo ausente fica como esta — tratar ausente como
   * "apague" faria salvar o endereco limpar a inscricao estadual.
   *
   * O CNPJ nao esta no contrato de entrada: trocar CNPJ e outra empresa.
   */
  app.put('/empresa', { config: { rateLimit: LIMITE_DE_ESCRITA } }, async (request, reply) => {
    const ctx = requireContext(request)
    const input = validate(updateCompanyInputSchema, request.body)

    return reply.code(200).send(await updateCompany(deps, ctx, input))
  })

  /**
   * Cadastrar cliente — RF-009, RF-010.
   *
   * **Duplicado nao e erro, e resposta.** O caso de uso devolve os candidatos
   * em vez de recusar, porque a decisao de reusar o existente e de quem esta no
   * balcao, com o cliente na frente — recusar automaticamente travaria o
   * cadastro de dois irmaos com o telefone de casa, que acontece.
   *
   * Por isso 409 com os candidatos no corpo, e nao 400: o pedido esta correto,
   * o estado do servidor e que exige uma escolha. Quem decidiu reenvia com
   * `?duplicado=permitir`.
   */
  app.post('/clientes', { config: { rateLimit: LIMITE_DE_ESCRITA } }, async (request, reply) => {
    const ctx = requireContext(request)
    const input = validate(createCustomerInputSchema, request.body)
    const { duplicado } = request.query as { duplicado?: string }

    const r = await registerCustomer(deps, ctx, input, {
      allowDuplicate: duplicado === 'permitir',
    })

    if (r.status === 'duplicate_found') {
      return reply.code(409).send({
        error: {
          code: 'CONFLICT',
          message:
            'Ja existe cliente com este telefone ou documento. ' +
            'Reenvie com ?duplicado=permitir para cadastrar mesmo assim.',
        },
        /* Os candidatos vao FORA do envelope de erro: eles nao sao detalhe do
           erro, sao a informacao que permite decidir. A tela mostra a lista. */
        candidates: r.candidates,
      })
    }

    return reply.code(201).send(r.customer)
  })

  /** Cadastrar produto — RF-017, RF-018, RF-019. */
  /**
   * Importacao de clientes em lote — NR-072, US-008.
   *
   * Mesma forma da importacao de produtos, e pelo mesmo motivo: as duas telas
   * usam o mesmo dialogo, e formas diferentes fariam o relatorio significar uma
   * coisa numa e outra na outra.
   */
  app.post(
    '/clientes/importacao',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)

      const input = validate(importCustomersInputSchema, request.body)
      const resultado = await importCustomers(deps, ctx, input)

      return reply.code(200).send(resultado)
    },
  )

  /**
   * A lista de clientes — RF-011, US-036.
   *
   * Traz o historico de compra junto: a tela mostra "ultima compra" em toda
   * linha, e busca-lo por cliente daria vinte e cinco idas ao banco para uma
   * pagina.
   */
  app.get('/clientes', async (request, reply) => {
    const ctx = requireContext(request)

    const input = validate(customerListInputSchema, request.query ?? {})
    const pagina = await listCustomers(deps, ctx, input)

    return reply.code(200).send(pagina)
  })

  /**
   * A ficha de um cliente — RF-011.
   *
   * Rota propria e nao `GET /clientes?id=`: e acesso a recurso, e a diferenca
   * aparece na resposta — 404 quando nao existe, contra a lista vazia que a
   * busca devolve legitimamente.
   *
   * Cliente de outra empresa cai no mesmo 404, de proposito: um 403 confirmaria
   * que aquele id existe em alguma loja.
   */
  app.get('/clientes/:id', async (request, reply) => {
    const ctx = requireContext(request)
    const { id } = request.params as { id: string }

    const cliente = await getCustomer(deps, ctx, id)

    return reply.code(200).send(cliente)
  })

  /**
   * Consentimento de WhatsApp — RF-016.
   *
   * O bloqueio ja existia em `sendCustomerCharge`; faltava alguem ESCREVER as
   * duas datas. Ate aqui a composicao devolvia um aceite fixo de 2026-01-01
   * para todo cliente identificado, e cobrar por WhatsApp quem nunca autorizou
   * passava.
   *
   * Sob `/clientes/:id` porque consentimento sem cliente nao existe.
   */
  app.get('/clientes/:id/consentimento-whatsapp', async (request, reply) => {
    const ctx = requireContext(request)
    const { id } = request.params as { id: string }

    const c = await getWhatsappConsent(deps, ctx, id)

    return reply.code(200).send({
      optedInAt: c.optedInAt?.toISOString() ?? null,
      optedOutAt: c.optedOutAt?.toISOString() ?? null,
    })
  })

  app.put(
    '/clientes/:id/consentimento-whatsapp',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }
      const input = validate(recordWhatsappConsentInputSchema, request.body)

      const c = await recordWhatsappConsent(deps, ctx, id, input.decision)

      return reply.code(200).send({
        optedInAt: c.optedInAt?.toISOString() ?? null,
        optedOutAt: c.optedOutAt?.toISOString() ?? null,
      })
    },
  )

  /**
   * O historico de contatos da ficha — RF-011, NR-072.
   *
   * Sob `/clientes/:id` e nao numa colecao propria (`/contatos?cliente=`):
   * contato sem cliente nao existe, e a rota aninhada diz isso na URL.
   *
   * Nao exige que o cliente esteja na lista: da para ler o historico de quem
   * ja foi excluido — e e justamente ali que ele explica o porque.
   */
  app.get('/clientes/:id/contatos', async (request, reply) => {
    const ctx = requireContext(request)
    const { id } = request.params as { id: string }

    return reply.code(200).send({ contacts: await listCustomerContacts(deps, ctx, id) })
  })

  app.post(
    '/clientes/:id/contatos',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }
      const input = validate(createCustomerContactInputSchema, request.body)

      return reply.code(201).send(await addCustomerContact(deps, ctx, id, input))
    },
  )

  /**
   * Excluir o cliente da lista — RF-009.
   *
   * DELETE, e nao PATCH com um campo: o que a tela pede e "tire este cliente
   * daqui", e o verbo diz isso. Que por baixo seja um UPDATE numa coluna e
   * detalhe de como o historico de vendas e preservado — nao contrato.
   *
   * 204 e nao 200 com corpo: nao ha estado novo para a tela desenhar, ela ja
   * sabe que vai voltar para a lista.
   */
  app.delete(
    '/clientes/:id',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }

      await deleteCustomer(deps, ctx, id)

      return reply.code(204).send()
    },
  )

  /**
   * Trazer de volta — RF-009.
   *
   * `POST /clientes/:id/reativar` e nao `DELETE` invertido: e uma acao com
   * nome, e a tela mostra um botao com esse nome. A ficha do cliente excluido
   * continua abrindo justamente para caber ele.
   */
  app.post(
    '/clientes/:id/reativar',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }

      await restoreCustomer(deps, ctx, id)

      return reply.code(204).send()
    },
  )

  app.post('/produtos', { config: { rateLimit: LIMITE_DE_ESCRITA } }, async (request, reply) => {
    const ctx = requireContext(request)
    const input = validate(createProductInputSchema, request.body)

    const produto = await registerProductWithStock(deps, ctx, input)

    return reply.code(201).send(produto)
  })

  /**
   * Localizar produto pelo codigo de barras lido — RF-018.
   *
   * `GET /produtos/codigo-de-barras/:codigo` e nao `/produtos?barcode=`: o
   * leitor de balcao busca UM produto por um identificador exato, e isso e
   * acesso a recurso, nao filtro sobre colecao. A distincao aparece na
   * resposta — 404 quando nao existe, e nao lista vazia.
   */
  /**
   * O catalogo do balcao — RF-019.
   *
   * `GET /produtos?q=` e busca sobre colecao, ao contrario do codigo de barras,
   * que e acesso a recurso. A diferenca aparece na resposta: aqui lista vazia e
   * uma resposta legitima ("nada com esse nome"), la e 404.
   */
  app.get('/produtos', async (request, reply) => {
    const ctx = requireContext(request)
    const { q, limite } = (request.query ?? {}) as { q?: string; limite?: string }

    const produtos = await searchProducts(deps, ctx, {
      ...(q === undefined ? {} : { termo: q }),
      ...(limite === undefined ? {} : { limite: Number(limite) }),
    })

    return reply.code(200).send({ products: produtos })
  })

  /**
   * O catalogo do backoffice — NR-072, US-008.
   *
   * Rota SEPARADA de `GET /produtos`, que continua sendo a busca do balcao com
   * teto de `TETO_DO_CATALOGO`. Dar paginacao aquela mudaria o contrato do PDV,
   * que ja depende do teto; e ler o catalogo por ela mostraria 50 produtos ao
   * lojista que tem 300, sem nenhum aviso de que faltam 250.
   */
  app.get('/produtos/catalogo', async (request, reply) => {
    const ctx = requireContext(request)

    const input = validate(catalogInputSchema, request.query ?? {})
    const pagina = await listCatalog(deps, ctx, input)

    return reply.code(200).send(pagina)
  })

  /**
   * Importacao de catalogo em lote — NR-072, US-008.
   *
   * PARCIAL de proposito: cada linha entra ou e recusada por conta propria, e a
   * resposta diz quantas entraram e o motivo de cada recusa. Tudo-ou-nada faria
   * uma planilha de 300 produtos com um preco errado nao importar nenhum.
   *
   * Por isso o status e 200 e nao 201: o lote pode ter entrado inteiro, pela
   * metade ou nada, e um 201 diria "criei" para um pedido em que talvez nada
   * tenha sido criado. Quem le a resposta decide o que dizer ao lojista.
   */
  app.post(
    '/produtos/importacao',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)

      const input = validate(importProductsInputSchema, request.body)
      const resultado = await importProducts(deps, ctx, input)

      return reply.code(200).send(resultado)
    },
  )

  /** Os numeros do topo da tela, sobre o catalogo inteiro — NR-072. */
  app.get('/produtos/resumo', async (request, reply) => {
    const ctx = requireContext(request)

    const resumo = await catalogSummary(deps, ctx)

    return reply.code(200).send(resumo)
  })

  /**
   * Sugestoes do formulario — categoria e fornecedor ja usados.
   *
   * Ate aqui o formulario oferecia uma lista de exemplo fixa, sempre a mesma
   * para toda loja — a sugestao nunca refletia o que o proprio lojista ja
   * tinha digitado.
   */
  app.get('/produtos/sugestoes', async (request, reply) => {
    const ctx = requireContext(request)

    const sugestoes = await productSuggestions(deps, ctx)

    return reply.code(200).send(sugestoes)
  })

  app.get('/produtos/codigo-de-barras/:codigo', async (request, reply) => {
    const ctx = requireContext(request)
    const { codigo } = request.params as { codigo: string }

    const produto = await deps.products.findByBarcode(ctx.companyId, codigo)

    if (produto === undefined) {
      /* O balcao precisa distinguir "nao existe" de "existe e esta zerado" —
         a segunda e cadastro feito, a primeira e cadastro a fazer. */
      throw AppError.notFound('Produto nao encontrado para este codigo de barras.')
    }

    return reply.code(200).send(produto)
  })

  /**
   * A ficha de um produto — RF-017.
   *
   * Pelo ID, e nao pelo codigo de barras: nem todo produto tem um. Granel,
   * produto sem embalagem e etiqueta amassada usam o codigo interno, e a ficha
   * precisa abrir para eles tambem.
   *
   * Declarada DEPOIS das rotas estaticas de `/produtos/*` de proposito. O
   * roteador do Fastify casa segmento estatico antes de parametrico, entao a
   * ordem nao muda o resultado — mas ler o arquivo de cima para baixo e ver o
   * curinga por ultimo evita a duvida. Ha teste para isso.
   */
  app.get('/produtos/:id', async (request, reply) => {
    const ctx = requireContext(request)
    const { id } = request.params as { id: string }

    const produto = await getProduct(deps, ctx, id)

    return reply.code(200).send(produto)
  })
}
