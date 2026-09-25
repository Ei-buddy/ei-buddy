import { randomUUID } from 'node:crypto'
import {
  cnpjSchema,
  createCompanyInputSchema,
  createProductInputSchema,
  createSaleInputSchema,
} from '@na-regua/contracts'
import { PLANO_DE_CONTAS_PADRAO } from '@na-regua/core'
import { getClient, migrate, withTenant } from '@na-regua/db'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { registerSession } from '../plugins/session.js'
import { registerAuthRoutes } from '../routes/auth.js'
import { registerCadastroRoutes } from '../routes/cadastro.js'
import { registerSaleRoutes } from '../routes/sales.js'

/**
 * O caminho critico, ponta a ponta — NR-049.
 *
 * ## Por que pela API e nao pelo navegador
 *
 * `docs/engenharia/testes.md` descreve tres fluxos E2E "no navegador". Hoje
 * nenhum deles atravessa o navegador de ponta a ponta, e o motivo nao e o
 * teste:
 *
 * - o web NAO tem rota de BFF para `/empresas` nem para `/sales`, entao o
 *   onboarding e a venda nao existem pela tela;
 * - o fluxo 3 (cobranca no WhatsApp -> link de pagamento -> baixa por webhook)
 *   nao tem NENHUMA rota na api.
 *
 * Um Playwright contra as telas de hoje exercitaria mock. Suite verde que prova
 * nada e pior que suite nenhuma, porque cria confianca sem lastro — e o proprio
 * documento diz que "tres testes E2E confiaveis valem mais que trinta que
 * falham aleatoriamente".
 *
 * Entao este teste sobe a api DE VERDADE — rotas reais, composicao real,
 * repositorios reais, Postgres real — e atravessa HTTP -> rota -> `core` ->
 * `db`. E a camada onde os defeitos desta base tem aparecido: dependencia nao
 * declarada, fiacao errada na composicao, SQL que nunca rodou.
 *
 * ## A sessao agora e de verdade
 *
 * Ate a NR-014 fechar, este arquivo injetava o `principal` num `onRequest` de
 * teste — a unica coisa falsa que restava. Ela saiu. O fluxo comeca em
 * `POST /auth/signup`, guarda o token que a resposta traz e o manda em
 * `Authorization` em toda chamada seguinte, atravessando o MESMO plugin de
 * sessao que a api registra.
 *
 * A diferenca nao e cosmetica. Com o principal injetado, um plugin de sessao
 * quebrado — token nao lido, `companyId` nulo virando principal, claims sem
 * papel — passava despercebido, porque nada neste teste dependia dele. Agora
 * uma falha ali derruba o primeiro degrau, e o resto cai atras.
 *
 * Um caso NEGATIVO acompanha: a mesma chamada sem cabecalho responde 401. Sem
 * ele, uma sessao que aceitasse qualquer coisa (ou nenhuma) continuaria verde.
 *
 * ## O que ele ainda NAO cobre, e por que
 *
 * O fluxo 3 do `docs/engenharia/testes.md` — cobranca no WhatsApp, link de
 * pagamento, baixa por webhook — nao tem NENHUMA rota na api (NR-046,
 * NR-044). E o navegador continua de fora: as listas de produto e de cliente
 * do web ainda leem `lib/mock-data`, entao um Playwright sobre elas
 * exercitaria mock. Suite verde que prova nada e pior que suite nenhuma.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

/**
 * `composition.js` entra por import DINAMICO, dentro do `beforeAll`.
 *
 * Ele valida o ambiente no topo do modulo (NR-006) e LANCA se faltar variavel.
 * Importado estaticamente, o arquivo nem chega a ser coletado numa maquina sem
 * `.env` completo — e derruba a suite inteira de `apps/api`, inclusive os
 * testes de rota que nao precisam de banco nenhum. O `skipIf` protege o que
 * roda, nao o que o modulo faz ao ser carregado.
 */
type Composicao = typeof import('../composition.js')

const EAN = `789${Date.now()}`.slice(0, 13)

/*
 * CNPJ com digito verificador de verdade, e unico por execucao.
 *
 * Os testes de `db` inserem direto na tabela e por isso se contentam com
 * catorze digitos quaisquer. Este entra pelo CONTRATO, e `cnpjSchema` confere
 * os dois digitos finais — numero aleatorio volta 400, e como o cadastro da
 * empresa e o primeiro degrau, TODO o resto do fluxo cai atras dele. Foi o que
 * aconteceu na segunda rodada da CI.
 *
 * A base sai do relogio para nao esbarrar em "CNPJ ja cadastrado" numa
 * reexecucao contra o mesmo banco, e o resultado continua reconhecivelmente
 * falso, como manda docs/engenharia/testes.md.
 */
function cnpjValido(base12: string): string {
  const digito = (nums: number[], pesos: number[]): number => {
    const resto = nums.reduce((acc, n, i) => acc + n * pesos[i]!, 0) % 11
    return resto < 2 ? 0 : 11 - resto
  }

  const base = base12.split('').map(Number)
  const d1 = digito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digito([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])

  return `${base12}${d1}${d2}`
}

const CNPJ = cnpjValido(String(Date.now()).slice(-12))

/* A segunda loja do mesmo dono. Base deslocada em um para nao colidir com a
   primeira nem com a execucao vizinha. */
const CNPJ_SEGUNDA_LOJA = cnpjValido(String(Date.now() + 1).slice(-12))

/*
 * Os corpos enviados, num lugar so — e conferidos contra os contratos por um
 * teste que roda SEM banco (ver o fim do arquivo).
 *
 * Nasceram inline e me custaram duas rodadas de CI: `stockQuantity` em vez de
 * `stock`, e CNPJ sem digito verificador. Os dois sao 400, e como o fluxo e
 * encadeado, um 400 no primeiro degrau reprova os oito casos seguintes com
 * mensagens que nao apontam para a causa.
 */
const EMPRESA = {
  legalName: 'Mercearia do Caminho Critico LTDA',
  cnpj: CNPJ,
  email: `contato@${CNPJ}.local`,
  phone: '41999990000',
}

/*
 * O cadastro de conta — o primeiro degrau do caminho critico.
 *
 * O segredo tem oito caracteres porque o contrato exige oito, e e obviamente
 * falso como manda docs/engenharia/testes.md. Ele nao vai para o nosso banco:
 * quem o guarda e o provedor de identidade (aqui o falso, por instancia).
 */
const SENHA = 'senha-de-teste'

const CADASTRO = {
  name: 'Operadora do Caminho Critico',
  email: `dona@${CNPJ}.local`,
  secret: SENHA,
  legalName: EMPRESA.legalName,
  cnpj: CNPJ,
  acceptedLegalTerms: true as const,
}

const PRODUTO = {
  description: 'Cafe torrado 500g',
  unitOfMeasure: 'un' as const,
  salePriceCents: 1990,
  costPriceCents: 1200,
  barcode: EAN,
  stock: 10,
  /* Fiscais — NR-042, RF-046. Sem eles a nota nao sai. */
  ncm: '09011110',
  cfop: '5102',
  taxSituationCode: '102',
}

const vendaDinheiro = (productId: string) => ({
  items: [{ productId, quantity: 1, unitPriceCents: 1990 }],
  payments: [{ method: 'cash' as const, amountCents: 1990 }],
})

/*
 * TRES parcelas, e nao duas.
 *
 * A tabela de tarifas padrao tem linha para 1x (3%) e para 3x (6%), e nada
 * para 2x. Com duas, a tarifa dependeria de como a busca resolve o vao — e a
 * assercao "o liquido vem abaixo do bruto" passaria ou falharia por um detalhe
 * que este teste nao quer medir. Tres casa exatamente com a tabela.
 */
const vendaCredito = (productId: string) => ({
  items: [{ productId, quantity: 2, unitPriceCents: 1990 }],
  payments: [{ method: 'credit' as const, amountCents: 3980, installments: 3 }],
})

const vendaPix = (productId: string) => ({
  items: [{ productId, quantity: 1, unitPriceCents: 1990 }],
  payments: [{ method: 'pix' as const, amountCents: 1990 }],
})

describe.skipIf(!DATABASE_URL)('caminho critico — NR-049', () => {
  let app: FastifyInstance

  /*
   * O MESMO cliente que a api usa, e nao uma conexao propria.
   *
   * `postgres` nem e dependencia declarada de `apps/api` — abrir uma conexao
   * paralela aqui pediria uma. E ler pelo caminho da aplicacao, sujeito a RLS
   * como ela, e mais honesto: uma assercao que so passa por fora da politica
   * nao prova nada sobre o que o lojista veria.
   */
  let composicao: Composicao

  const sql = () => getClient(DATABASE_URL!)

  /*
   * Toda consulta deste arquivo filtra por `company_id` NA MAO.
   *
   * O `withTenant` define o tenant, mas quem o faz valer e a RLS — e a conexao
   * daqui e a da propria api, dona do banco no runner. Superusuario ignora a
   * politica, entao apoiar-se nela aqui e apoiar-se em nada: a assercao de
   * numeracao voltou [1, 1, 2, 2] justamente por isso, enxergando as vendas da
   * execucao anterior alem das suas.
   *
   * Filtro explicito acerta com politica e sem ela. E o codigo de PRODUCAO
   * continua sem filtro de proposito (ADR-0001) — la o papel e comum, e o
   * `checkIsolation` da subida recusa abrir a porta se nao for.
   */

  /**
   * O token e a empresa nascem no primeiro degrau e valem para todos os outros.
   *
   * Mutaveis de proposito: antes do cadastro nao existe nem sessao nem loja, e
   * a partir dele toda chamada corre sob as duas. E o que torna este arquivo um
   * FLUXO, e nao chamadas soltas com dados montados a mao.
   */
  let token: string
  let empresaId: string

  /**
   * Toda chamada autenticada passa por aqui — um lugar so para o cabecalho.
   *
   * Os cabecalhos do chamador vem DEPOIS do `authorization`, e nao antes: a
   * venda manda `idempotency-key` junto, e um espalhamento na ordem inversa
   * apagaria um dos dois em silencio.
   */
  const comSessao = (opcoes: {
    method: 'GET' | 'POST'
    url: string
    payload?: object
    headers?: Record<string, string>
  }) => {
    const base = {
      method: opcoes.method,
      url: opcoes.url,
      headers: { authorization: `Bearer ${token}`, ...(opcoes.headers ?? {}) },
    }

    /*
     * Dois caminhos, e nao um espalhamento condicional.
     *
     * Com `exactOptionalPropertyTypes`, um `payload` que pode ser `undefined`
     * nao casa com a sobrecarga de `inject`, e o retorno degrada para `void` —
     * o que faz TODA assercao seguinte falhar com "statusCode nao existe", bem
     * longe da causa.
     */
    return opcoes.payload === undefined
      ? app.inject(base)
      : app.inject({ ...base, payload: opcoes.payload })
  }

  beforeAll(async () => {
    /*
     * O job Verificar da CI fornece DATABASE_URL, DATABASE_MIGRATION_URL e
     * REDIS_URL, e mais nada. `loadApiEnv` exige tambem API_URL e JWT_SECRET,
     * e lanca sem eles — foi assim que este arquivo reprovou na primeira
     * rodada. REDIS_URL entrou na lista depois, pelo motivo inverso: a CI da, e
     * a maquina de desenvolvimento nem sempre.
     *
     * Preenchidos aqui, e nao no workflow: sao exigencia do VALIDADOR, nao
     * deste teste. O `JWT_SECRET` de mentira continua honesto mesmo agora que
     * ha sessao de verdade — quem emite o token e o `InMemorySessionIssuer`
     * da ADR-0002, que guarda claims num mapa e nao assina nada. Por o segredo
     * de producao no workflow seria pedir uma variavel de CI para um caminho
     * que ninguem exercita. O `??` deixa o ambiente real vencer, se algum dia
     * houver um.
     */
    vi.stubEnv('API_URL', process.env.API_URL ?? 'http://localhost:3333')
    vi.stubEnv('JWT_SECRET', process.env.JWT_SECRET ?? 'segredo-que-o-e2e-nao-usa')
    /* REDIS_URL entrou depois: a CI fornece, entao a falta so aparecia na
       maquina de quem nao sobe a infra local. O limitador aqui e registrado sem
       cliente e conta em memoria — a variavel existe so para o validador. */
    vi.stubEnv('REDIS_URL', process.env.REDIS_URL ?? 'redis://localhost:6379')

    composicao = await import('../composition.js')

    await migrate(MIGRATION_URL!)

    app = Fastify({ logger: false })
    registerErrorHandler(app)
    await registerRateLimit(app)

    /*
     * UMA instancia de `buildAuthDeps`, e nao duas.
     *
     * O provedor de identidade falso guarda as credenciais num mapa proprio.
     * Duas instancias seriam dois mapas: o cadastro escreveria num, o login
     * leria do outro, e a pessoa cadastrava sem conseguir entrar. O proprio
     * `composition.ts` traz esse aviso, e chamar o construtor duas vezes aqui
     * reproduziria o defeito dentro do teste que existe para pega-lo.
     */
    const authDeps = composicao.buildAuthDeps()

    /* O plugin de sessao DE VERDADE. Nao ha mais `onRequest` de mentira: o
       `principal` desta suite passa a sair do token, como em producao. */
    registerSession(app, authDeps.sessions)
    registerAuthRoutes(app, authDeps)

    /* Os MESMOS construtores que o `index.ts` usa. E o que faz este teste pegar
       fiacao errada na composicao — o defeito que os testes de rota, com
       dependencia falsa, nao conseguem ver. */
    registerCadastroRoutes(app, composicao.buildCadastroDeps())
    registerSaleRoutes(app, composicao.buildSaleDeps())

    await app.ready()
  }, 90_000)

  afterAll(async () => {
    await app?.close()

    /*
     * Guarda para o caso de o `beforeAll` ter falhado.
     *
     * Sem ela, a limpeza estoura em `empresaId` indefinido e o relatorio
     * mostra ESSE erro no lugar do que realmente quebrou — foi o que aconteceu
     * aqui: a causa era variavel de ambiente faltando, e a CI acusou "Cannot
     * read properties of undefined".
     */
    if (composicao === undefined) {
      vi.unstubAllEnvs()
      return
    }

    /*
     * Sem limpeza, e a razao e do SCHEMA e nao do teste.
     *
     * `inventory_movements` recusa DELETE por gatilho — "corrija com um
     * movimento novo, nao alterando o antigo" (RF-124). Como `products` e
     * referenciada por ela, e `companies` por tudo, a limpeza para no primeiro
     * degrau e nao ha ordem que a salve. Livro-razao que so cresce e assim de
     * proposito.
     *
     * O custo e uma empresa a mais por execucao no banco de desenvolvimento. O
     * CNPJ sai do relogio, entao nada colide; na CI o banco morre com o job.
     */

    /* Fecha o cliente compartilhado: e o mesmo que a api usa, e deixa-lo aberto
       segura o processo do vitest. */
    await composicao.shutdown()
    vi.unstubAllEnvs()
  })

  /*
   * Um `it` por etapa, na ordem, e nao um teste gigante.
   *
   * O fluxo tem estado — a empresa nasce no primeiro e e usada nos seguintes —
   * entao a ordem E o contrato aqui, ao contrario dos testes de unidade. A
   * vantagem sobre um `it` unico e o diagnostico: quando quebra, o nome do caso
   * ja diz em que degrau do caminho critico o sistema parou.
   */

  let produtoId: string
  let vendaNumero: number

  describe('fluxo 1 — onboarding ate a primeira venda', () => {
    it('recusa a operacao sem sessao, antes de qualquer cadastro', async () => {
      /*
       * O caso negativo vem PRIMEIRO, e de proposito.
       *
       * Ele e o que da sentido a todos os seguintes: sem ele, um plugin de
       * sessao que aceitasse qualquer requisicao — ou o `onRequest` de mentira
       * que este arquivo tinha ate agora — deixaria a suite inteira verde
       * provando nada. Depois do cadastro o token existe, e a mesma chamada
       * passa; aqui ele ainda nao existe, e ela tem de falhar.
       */
      const r = await app.inject({ method: 'GET', url: '/produtos' })

      expect(r.statusCode).toBe(401)
    })

    it('recusa token que nao emitiu', async () => {
      /*
       * Sem este caso, o anterior sozinho passaria com um plugin que apenas
       * exigisse a PRESENCA do cabecalho, sem ler o que vem nele. Os dois
       * juntos separam "olha o cabecalho" de "valida a sessao".
       */
      const r = await app.inject({
        method: 'GET',
        url: '/produtos',
        headers: { authorization: 'Bearer nao-foi-esta-api-que-emitiu' },
      })

      expect(r.statusCode).toBe(401)
    })

    it('cadastra a conta e a loja ja nasce com plano de contas', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: CADASTRO,
      })

      expect(r.statusCode).toBe(201)

      /*
       * Daqui para a frente, tudo corre sob a sessao que acabou de nascer.
       *
       * O cadastro devolve a sessao ABERTA, com a empresa ja escolhida: quem
       * acabou de se cadastrar quer usar o sistema, e nao digitar tudo de novo.
       * E o que permite este teste seguir sem passar por `/auth/select-company`.
       */
      token = r.json().token
      empresaId = r.json().memberships[0].companyId

      expect(token).toBeTruthy()
      expect(empresaId).toBeTruthy()

      /* RF-081: o plano padrao e semeado no onboarding. Sem isto o lojista abre
         a tela de classificacao vazia e a resposta pratica dele e nao
         classificar nada — o que reduz o DRE a uma linha so. */
      const contas = await withTenant(
        sql(),
        empresaId,
        (tx) => tx<{ total: string }[]>`
          SELECT count(*) AS total FROM ledger_accounts WHERE company_id = ${empresaId}
        `,
      )

      /* Exato, e nao "maior que zero": o plano tem tamanho conhecido, e um
         numero qualquer passaria mesmo se a consulta enxergasse outras lojas —
         que foi o defeito que este arquivo teve. */
      expect(Number(contas[0]!.total)).toBe(PLANO_DE_CONTAS_PADRAO.length)
    })

    it('entra de novo com as credenciais que acabou de criar', async () => {
      /*
       * O degrau que o `composition.ts` avisa ser o mais facil de quebrar.
       *
       * O provedor de identidade falso guarda as credenciais num mapa da
       * INSTANCIA. Se o cadastro e o login recebessem instancias diferentes, o
       * cadastro escreveria num mapa e o login leria do outro: a pessoa se
       * cadastraria e nao conseguiria entrar. E um defeito de FIACAO, invisivel
       * para os testes de rota — que injetam a dependencia ja pronta — e que ja
       * apareceu neste projeto, com a tela de cadastro no ar e o login
       * recusando toda senha.
       *
       * O token daqui substitui o do cadastro para o resto do fluxo: e o que a
       * pessoa realmente carrega no dia seguinte.
       */
      const r = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { identifier: CADASTRO.email, secret: SENHA },
      })

      expect(r.statusCode).toBe(200)
      expect(r.json().token).toBeTruthy()

      token = r.json().token
    })

    it('abre uma segunda loja, que nasce com o proprio plano de contas', async () => {
      /*
       * `POST /empresas` perdeu o lugar de primeiro degrau quando o cadastro
       * de conta assumiu a criacao da loja, mas a rota continua existindo e o
       * lojista com duas lojas continua usando-a (RF-119). Deixa-la sem
       * exercicio E2E trocaria uma cobertura por outra em vez de somar.
       *
       * A operacao segue na PRIMEIRA loja: abrir a segunda nao troca a sessao,
       * e trocar exigiria `/auth/select-company`. Aqui basta provar que ela
       * nasce inteira.
       */
      const r = await comSessao({
        method: 'POST',
        url: '/empresas',
        payload: { ...EMPRESA, cnpj: CNPJ_SEGUNDA_LOJA, email: `filial@${CNPJ}.local` },
      })

      expect(r.statusCode).toBe(201)
      expect(r.json().id).not.toBe(empresaId)

      const contas = await withTenant(
        sql(),
        r.json().id,
        (tx) => tx<{ total: string }[]>`
          SELECT count(*) AS total FROM ledger_accounts WHERE company_id = ${r.json().id}
        `,
      )

      expect(Number(contas[0]!.total)).toBe(PLANO_DE_CONTAS_PADRAO.length)
    })

    it('cadastra o produto que sera vendido', async () => {
      const r = await comSessao({
        method: 'POST',
        url: '/produtos',
        payload: PRODUTO,
      })

      expect(r.statusCode).toBe(201)
      produtoId = r.json().id

      /*
       * Os campos fiscais atravessam ate o banco — NR-042.
       *
       * Eles eram o que faltava para a emissao existir: o contrato exige NCM,
       * CFOP e CST/CSOSN por item, e o cadastro nao tinha nenhum dos tres. O
       * NCM chegou a ser digitado na tela do web e descartado em silencio.
       */
      expect(r.json()).toMatchObject({ ncm: '09011110', cfop: '5102', taxSituationCode: '102' })

      /* O saldo inicial tambem chega — era aceito pelo contrato e descartado
         pelo cadastro avulso: o produto nascia zerado. */
      expect(r.json().stock).toBe(PRODUTO.stock)
    })

    it('registra a primeira venda', async () => {
      const r = await comSessao({
        method: 'POST',
        url: '/sales',
        headers: { 'idempotency-key': randomUUID() },
        payload: vendaDinheiro(produtoId),
      })

      expect(r.statusCode).toBe(201)

      /* Atribuido ANTES das assercoes: uma assercao que falha aqui deixaria
         `vendaNumero` indefinido e o teste de numeracao reprovaria com
         "undefined", escondendo qual foi o erro de verdade. */
      vendaNumero = Number(r.json().sale.number)

      /*
       * O BRUTO e o que foi cobrado; o LIQUIDO ja vem depois do imposto
       * (RF-040). Eu esperava 1990 nos dois e a CI devolveu 1871 — a diferenca
       * e o tributo que `domain` calcula na venda, e confundir os dois e
       * exatamente o engano que separar os dois campos existe para evitar.
       */
      expect(r.json().sale.grossAmountCents).toBe(1990)
      expect(r.json().sale.netAmountCents).toBeLessThan(1990)
    })
  })

  describe('fluxo 2 — leitura do codigo de barras ate o recebivel', () => {
    it('acha o produto pelo codigo lido no balcao', async () => {
      const r = await comSessao({ method: 'GET', url: `/produtos/codigo-de-barras/${EAN}` })

      expect(r.statusCode).toBe(200)
      expect(r.json().id).toBe(produtoId)
    })

    it('codigo que nao existe volta 404, e nao lista vazia', async () => {
      const r = await comSessao({
        method: 'GET',
        url: '/produtos/codigo-de-barras/0000000000000',
      })

      /* O balcao precisa distinguir "cadastro a fazer" de "cadastro feito e
         zerado". Lista vazia confundiria os dois. */
      expect(r.statusCode).toBe(404)
    })

    it('venda no credito parcelado gera os recebiveis', async () => {
      const r = await comSessao({
        method: 'POST',
        url: '/sales',
        headers: { 'idempotency-key': randomUUID() },
        payload: vendaCredito(produtoId),
      })

      expect(r.statusCode).toBe(201)

      const linhas = await withTenant(
        sql(),
        empresaId,
        (tx) => tx<{ amount_cents: string; net_amount_cents: string }[]>`
          SELECT amount_cents, net_amount_cents FROM receivables
          WHERE company_id = ${empresaId} AND sale_id = ${r.json().sale.id}
          ORDER BY due_date
        `,
      )

      const bruto = linhas.reduce((acc, l) => acc + Number(l.amount_cents), 0)
      const liquido = linhas.reduce((acc, l) => acc + Number(l.net_amount_cents), 0)

      /*
       * Tres parcelas, tres recebiveis, e o bruto fecha com a venda — o resto
       * da divisao nao pode evaporar (`allocate`, RF-038).
       *
       * O liquido vem MENOR: a diferenca e a tarifa da adquirente, que o
       * sistema ja calculou na venda (RF-036). E por isso que a conciliacao
       * compara o extrato com o liquido e nao com o bruto — sem esta linha,
       * nenhuma venda no cartao conciliaria.
       */
      expect(linhas).toHaveLength(3)
      expect(bruto).toBe(3980)
      expect(liquido).toBeLessThan(bruto)
    })

    it('a venda numerou em sequencia, sem repetir', async () => {
      const linhas = await withTenant(
        sql(),
        empresaId,
        (tx) => tx<{ number: string }[]>`
          SELECT number FROM sales WHERE company_id = ${empresaId} ORDER BY number
        `,
      )

      /* `Number`: a coluna e bigint e o postgres.js devolve STRING para nao
         perder precisao — a comparacao crua daria ['1','2'] contra [1, 2]. */
      expect(linhas.map((l) => Number(l.number))).toEqual([vendaNumero, vendaNumero + 1])
    })
  })

  describe('o reenvio do PDV com internet ruim — RNF-043', () => {
    it('a mesma chave devolve a MESMA venda, com 200 em vez de 201', async () => {
      const chave = randomUUID()
      const corpo = vendaPix(produtoId)

      const primeira = await comSessao({
        method: 'POST',
        url: '/sales',
        headers: { 'idempotency-key': chave },
        payload: corpo,
      })
      const segunda = await comSessao({
        method: 'POST',
        url: '/sales',
        headers: { 'idempotency-key': chave },
        payload: corpo,
      })

      /*
       * O caso que a RNF-043 existe para evitar: sem a chave reaproveitada, o
       * reenvio vira uma SEGUNDA venda, com segundo estoque baixado e segundo
       * recebivel. O 200 e o que diz a quem integra "isto ja existia" — 201
       * sempre faria um integrador contar duas onde houve uma.
       */
      expect(primeira.statusCode).toBe(201)
      expect(segunda.statusCode).toBe(200)
      expect(segunda.json().replayed).toBe(true)
      expect(segunda.json().sale.id).toBe(primeira.json().sale.id)
    })

    it('sem o cabecalho, a venda e recusada em vez de arriscada', async () => {
      const r = await comSessao({
        method: 'POST',
        url: '/sales',
        payload: vendaDinheiro(produtoId),
      })

      /* 400 e nao 422: quem chamou corrige sozinho reenviando com o cabecalho. */
      expect(r.statusCode).toBe(400)
    })
  })

  describe('cancelar a venda — RF-043', () => {
    it('venda em dinheiro cancela, e o estoque volta', async () => {
      /*
       * Dinheiro nasce com o recebivel JA liquidado. O cancelamento marcava o
       * recebivel `cancelled` sem limpar `settled_at`, a constraint
       * `receivables_liquidado_completo` recusava e toda venda em dinheiro
       * virava 500 ao cancelar — os falsos em memoria nao tem a constraint.
       */
      const estoque = async () =>
        (await comSessao({ method: 'GET', url: `/produtos/codigo-de-barras/${EAN}` })).json().stock

      const venda = await comSessao({
        method: 'POST',
        url: '/sales',
        headers: { 'idempotency-key': randomUUID() },
        payload: vendaDinheiro(produtoId),
      })
      const antes = await estoque()

      const r = await comSessao({
        method: 'POST',
        url: `/sales/${venda.json().sale.id}/cancelar`,
        payload: { reason: 'Cliente desistiu' },
      })

      expect(r.statusCode).toBe(204)
      expect(await estoque()).toBe(antes + 1)
    })
  })

  describe('devolver parte da venda — RF-044', () => {
    it('devolve 1 de 2 em dinheiro: o estoque volta e metade sai do caixa', async () => {
      const estoque = async () =>
        (await comSessao({ method: 'GET', url: `/produtos/codigo-de-barras/${EAN}` })).json().stock

      const venda = await comSessao({
        method: 'POST',
        url: '/sales',
        headers: { 'idempotency-key': randomUUID() },
        payload: {
          items: [{ productId: produtoId, quantity: 2, unitPriceCents: 1990 }],
          payments: [{ method: 'cash', amountCents: 3980 }],
        },
      })
      const saleId = venda.json().sale.id
      const antes = await estoque()

      const devolucao = (quantity: number) =>
        comSessao({
          method: 'POST',
          url: `/sales/${saleId}/devolucao`,
          payload: { reason: 'Um veio com defeito', items: [{ productId: produtoId, quantity }] },
        })

      const r = await devolucao(1)
      expect(r.statusCode).toBe(200)
      expect(r.json()).toEqual({
        refundCents: 1990,
        paidBackCents: 1990,
        uncollectedCents: 0,
        status: 'settled',
      })
      expect(await estoque()).toBe(antes + 1)

      /* Devolver mais do que resta e recusado; o que resta, fecha a venda. */
      expect((await devolucao(2)).statusCode).toBe(400)
      expect((await devolucao(1)).json().status).toBe('returned')
    })
  })

  /*
   * NAO ha teste de isolamento aqui, e a ausencia e deliberada.
   *
   * A primeira versao trocava o `companyId` do principal e esperava 404. Veio
   * 200 na CI, e o culpado nao era vazamento: este E2E usa a conexao da propria
   * api, que no runner e DONA do banco. Superusuario ignora RLS, entao a
   * consulta enxergava tudo — e `findByBarcode` nem filtra por `company_id`,
   * confia na politica (ADR-0001).
   *
   * Os testes de `packages/db` provam o isolamento porque criam um papel COMUM
   * de proposito (`conectarComoAplicacao`). Repetir a assercao daqui, com esta
   * conexao, seria um teste que passa ou falha por um motivo que nao e o que
   * ele diz medir — e em producao quem garante o papel certo e o
   * `checkIsolation` da subida, que recusa abrir a porta se o papel escapar.
   */
})

/**
 * Os corpos batem com os contratos — e este roda SEM banco.
 *
 * O E2E de cima e pulado em toda maquina sem Postgres, entao um payload errado
 * so aparecia na CI. E aparecia mal: o fluxo e encadeado, e um 400 no primeiro
 * degrau reprova os oito casos seguintes com mensagens que apontam para os
 * sintomas, nunca para a causa. Foram duas rodadas assim — `stockQuantity` no
 * lugar de `stock`, e CNPJ sem digito verificador.
 *
 * Aqui a forma e conferida contra o MESMO schema que a rota usa, no `pnpm test`
 * de qualquer um. Nao substitui o E2E: nao prova que a venda acontece, prova
 * que o pedido chega valido — que e a metade que estava custando caro.
 */
describe('os corpos que o E2E envia — sem banco', () => {
  const UUID = '3d1f0c4e-6a2b-4c8d-9e1f-0a2b3c4d5e6f'

  const casos = [
    ['empresa', createCompanyInputSchema, EMPRESA],
    ['produto', createProductInputSchema, PRODUTO],
    ['venda em dinheiro', createSaleInputSchema, vendaDinheiro(UUID)],
    ['venda no credito', createSaleInputSchema, vendaCredito(UUID)],
    ['venda no pix', createSaleInputSchema, vendaPix(UUID)],
  ] as const

  for (const [nome, schema, corpo] of casos) {
    it(`${nome} passa no schema da rota`, () => {
      const r = schema.safeParse(corpo)

      /* A mensagem do erro entra na assercao de proposito: `expected false to
         be true` nao diz qual campo esta errado, e era exatamente essa a
         dificuldade de ler a falha na CI. */
      expect(
        r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      ).toEqual([])
    })
  }

  it('o CNPJ gerado tem digito verificador valido', () => {
    /* O gerador e codigo meu, e codigo meu erra. Se ele quebrar, o E2E volta a
       reprovar no primeiro degrau — e agora a causa aparece aqui. */
    expect(cnpjSchema.safeParse(CNPJ).success).toBe(true)
  })
})
