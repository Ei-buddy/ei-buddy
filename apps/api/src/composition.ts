/**
 * RAIZ DE COMPOSICAO.
 *
 * Este e o UNICO arquivo de apps/api autorizado a importar `@na-regua/db` e os
 * adapters. Ele monta o grafo de dependencias e injeta tudo em core.
 * Ver docs/arquitetura/principios.md#matriz-de-imports-permitidos
 *
 * Se um import de `db` ou de adapter aparecer fora daqui, a verificacao de
 * fronteiras na CI barra o PR — e com razao.
 */
import { randomUUID } from 'node:crypto'
import {
  buildDre,
  buildRevenueByMonth,
  checkCustomerWalletByQuery,
  checkStock,
  checkStockByQuery,
  createDefaultSaleSettings,
  listPayables,
  listReceivables,
  listSales,
  registerCustomer,
  registerSale,
  searchProducts,
  sendCustomerCharge,
} from '@na-regua/core'
import { createFakeMessageSender } from '@na-regua/whatsapp'
import {
  createAgentRuntime,
  createToolCatalog,
  FakeLlm,
  FixturePeerDirectory,
  InMemoryAiUsageCounter,
  loadStudioPresets,
  type AgentRuntime,
  type AgentUseCases,
  type LlmPort,
  type ToolDescriptor,
} from '@na-regua/agent'
import type { AgendaDeps } from './routes/agenda.js'
import type { IdentityProvider, IdentityRegistrar } from '@na-regua/core'
import type { AuthRouteDeps } from './routes/auth.js'
import type { PrivacidadeDeps } from './routes/privacidade.js'
import { ExportacaoEmArquivo } from './exportacao-em-arquivo.js'
import { IdentidadeBetterAuth } from './identidade-better-auth.js'
import { IdentidadeEmArquivo } from './identidade-em-arquivo.js'
import { createReminderScheduler } from './reminder-scheduler.js'
import {
  assertRlsEnforced,
  checkConnection,
  closeConnection,
  createAppointmentRepository,
  createBankTransactionWriter,
  createChartOfAccountsRepository,
  createFixedCostPayableGenerator,
  createFixedCostRepository,
  createConnectionRequests,
  createCrmRepository,
  createInventoryHistory,
  createInventoryQueries,
  createInventoryUnitOfWork,
  createReportRepository,
  createAuditQueries,
  createAuditTrail,
  createDataSubjectRepository,
  createExportSource,
  createLoginThrottle,
  createPlatformAdminAccess,
  createSessionIssuer,
  createSettlementQueries,
  createSettlementUnitOfWork,
  createSupportRepository,
  createTeamRepository,
  createCompanyRepository,
  createConfirmationStore,
  createConversationStore,
  createCustomerRepository,
  createPartnerApplicationRepository,
  createLegalConsentRepository,
  createFiscalCredentials,
  createInvoiceStore,
  createSaleFiscalReader,
  createPayableQueries,
  createManualReceivableUnitOfWork,
  createReceivableRepository,
  createPayableUnitOfWork,
  createProductRepository,
  createReconciliationQueries,
  createReconciliationUnitOfWork,
  createSaleHistoryRepository,
  createSaleUnitOfWork,
  createSupplierDirectory,
  createUserDirectory,
  createWaitlistRepository,
  getClient,
  lerChaveDeSegredo,
  type DatabaseHealth,
} from '@na-regua/db'
import { createFileStatementReader } from '@na-regua/banking'
import { createFakeInvoiceIssuer, criarEmissorFocusNfe } from '@na-regua/fiscal'
import type { InvoiceIssuer } from '@na-regua/core'
import type { CadastroDeps } from './routes/cadastro.js'
import type { ConnectionsRouteDeps } from './routes/connections.js'
import type { ConciliacaoDeps } from './routes/conciliacao.js'
import type { SaleRouteDeps } from './routes/sales.js'
import type { ContabilidadeDeps } from './routes/contabilidade.js'
import type { CustosFixosDeps } from './routes/custos-fixos.js'
import type { WaitlistRouteDeps } from './routes/waitlist.js'
import type { BaixasDeps } from './routes/baixas.js'
import type { EstoqueDeps } from './routes/estoque.js'
import type { SuporteDeps } from './routes/suporte.js'
import type { RelatoriosDeps } from './routes/relatorios.js'
import type { AuditoriaDeps } from './routes/auditoria.js'
import type { ContasDeps } from './routes/contas.js'
import type { CrmRouteDeps } from './routes/crm.js'
import { createInvoiceQueue } from './invoice-queue.js'
import { createConnectionNotifier } from './connection-notifier.js'
import { createBrasilApiCepLookup } from './cep-lookup.js'
import type { CredenciaisFiscaisDeps, EmissaoDeps } from './routes/fiscal.js'
import { loadApiEnv } from '@na-regua/env'
import { Redis } from 'ioredis'

/**
 * Validado aqui, na raiz de composicao, antes de qualquer I/O — NR-006. Se
 * faltar variavel obrigatoria o processo lanca e nao sobe; ver
 * packages/env/README.md.
 */
export const env = loadApiEnv()

export type RedisHealth = {
  ok: boolean
  latencyMs: number
  error?: string
}

let redis: Redis | undefined

export function getRedis(url = env.REDIS_URL): Redis {
  if (redis !== undefined) return redis

  const cliente = new Redis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    retryStrategy: () => null,
  })

  /*
   * Um ouvinte de `error`, e a api para de morrer quando o Redis nao esta de pe.
   *
   * `EventEmitter` do Node LANCA quando emite `error` sem ninguem ouvindo — e
   * ioredis emite `error` a cada falha de conexao. Sem esta linha, subir a api
   * com o Redis fora derrubava o processo com um `AggregateError ECONNREFUSED`
   * cru, sem passar por nenhum `try` do nosso codigo.
   *
   * Isso contradizia duas decisoes ja tomadas e escritas: o limitador declara
   * `skipOnError: true` ("limite degradado e melhor que api fora do ar por
   * causa do limitador"), e a checagem de isolamento deixa a api subir com o
   * BANCO fora, porque indisponibilidade de infra nao e falha de seguranca.
   * `skipOnError` cobre erro de COMANDO; o evento de conexao passava por baixo
   * dele.
   *
   * O sintoma para quem instalava era desproporcional a causa: a api nao subia,
   * o web nao criava conta nem entrava, e o erro falava de uma porta 6379 que
   * nada tem a ver com login.
   *
   * `warn` e nao `error`: `/health` ja responde 503 com o detalhe, e um erro
   * por tentativa de reconexao encheria o log sem acrescentar nada.
   */
  cliente.on('error', (erro: Error) => {
    console.warn(
      JSON.stringify({
        level: 40,
        msg: 'redis indisponivel — limite de requisicao cai para memoria; ver /health',
        motivo: erro.message,
      }),
    )
  })

  redis = cliente
  return redis
}

export async function checkRedis(): Promise<RedisHealth> {
  const startedAt = performance.now()
  try {
    const client = getRedis()
    if (client.status !== 'ready') await client.connect()
    await client.ping()
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt) }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function checkDatabase(): Promise<DatabaseHealth> {
  return checkConnection(env.DATABASE_URL)
}

export type IsolationCheck =
  | { readonly status: 'enforced'; readonly role: string }
  /** Nao deu para verificar: banco fora do ar na subida. */
  | { readonly status: 'unknown'; readonly reason: string }
  | { readonly status: 'bypassed'; readonly reason: string }

/**
 * Verifica, na subida, que a conexao da aplicacao esta sujeita a RLS.
 *
 * A CI encontrou isto do jeito caro: em um ambiente real o isolamento entre
 * empresas nao estava em vigor, porque a aplicacao conectava com um papel
 * superusuario — e superusuario ignora politica de RLS inteiramente, `FORCE
 * ROW LEVEL SECURITY` incluido. Nada dava erro; toda consulta simplesmente
 * devolvia as linhas de todas as lojas.
 *
 * A distincao entre os tres desfechos e o ponto:
 *
 * - **`bypassed`** e configuracao errada e vaza dado entre lojas. Derruba o
 *   processo. Melhor nao subir que subir sem isolamento.
 * - **`unknown`** e banco fora do ar na subida, que e indisponibilidade e nao
 *   falha de seguranca. A api sobe: `/health` ja responde 503, o orquestrador
 *   ja sabe, e recusar subir aqui deixaria nem o `/health/live` de pe.
 * - **`enforced`** e o caso normal.
 */
export async function checkIsolation(): Promise<IsolationCheck> {
  try {
    const status = await assertRlsEnforced(getClient(env.DATABASE_URL))
    return { status: 'enforced', role: status.role }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)

    /* A mensagem do `assertRlsEnforced` e a unica que significa "configurado
       errado". Qualquer outra falha e do caminho ate o banco. */
    return reason.includes('IGNORA as politicas de RLS')
      ? { status: 'bypassed', reason }
      : { status: 'unknown', reason }
  }
}

export async function shutdown(): Promise<void> {
  await Promise.allSettled([closeConnection(), redis?.quit()])
  redis = undefined
}

/**
 * Dependencias do fechamento de venda — NR-027.
 *
 * `unitOfWork` e de `db` e abre a transacao com o tenant definido; `settings`
 * ainda e o padrao de `core`, porque aliquota, tabela de tarifas e teto de
 * desconto **nao tem tabela** (ver `CompanySettingsRepository`). Quando
 * tiverem, so esta funcao muda.
 *
 * Funcao e nao constante: `getClient()` abre conexao, e abrir conexao no topo
 * do modulo faria importar a composicao — inclusive num teste — conectar no
 * banco.
 */
export function buildSaleDeps(): SaleRouteDeps {
  const sql = getClient(env.DATABASE_URL)
  return {
    unitOfWork: createSaleUnitOfWork(sql),
    settings: createDefaultSaleSettings(),
    /* O fuso vem da `TZ` pelo mesmo motivo dos relatorios: "vendas de 15 de
       marco" e uma pergunta com fuso embutido, e a venda das 21h30 em Sao
       Paulo e 16 de marco em UTC. */
    history: createSaleHistoryRepository(sql, env.TZ),
  }
}

/**
 * Dependencias de sessao — NR-014, ADR-0002.
 *
 * A sessao e a desaceleracao vivem no Postgres desde a NR-083. O provedor de
 * identidade e escolhido por `AUTH_PROVIDER` — ver `criarIdentidade`.
 */
export function buildAuthDeps(): AuthRouteDeps {
  const sql = getClient(env.DATABASE_URL)

  /*
   * A MESMA instancia serve de `provider` e de `registrar`.
   *
   * Duas instancias seriam dois armazenamentos: o cadastro escreveria num e o
   * login leria do outro — e a pessoa cadastrava e nao entrava. E exatamente o
   * defeito que este trecho existe para nao repetir.
   */
  const identidade = criarIdentidade()

  return {
    provider: identidade,
    registrar: identidade,
    companies: createCompanyRepository(sql),
    accounts: createChartOfAccountsRepository(sql),
    users: createUserDirectory(sql),
    /*
     * Sessao e desaceleracao no POSTGRES — NR-083.
     *
     * Eram `Map` na instancia, e as tres consequencias estao na migration 0022:
     * reiniciar deslogava todo mundo, duas instancias nao compartilhavam nada,
     * e sessao nao dava para revogar — que era o que impedia a RF-006 e fazia
     * "Sair" nao encerrar nada.
     */
    sessions: createSessionIssuer(sql),
    throttle: createLoginThrottle(sql),
    /*
     * A trilha do login ainda nao persiste: `packages/db` nao expoe repositorio
     * de auditoria. Registrar em memoria e melhor que nao registrar — o caso de
     * uso continua exercitando o caminho, e o dia em que o repositorio existir
     * so muda esta linha. Mas nao e trilha de verdade, e por isso entra na
     * mesma guarda de producao.
     */
    audit: createAuditTrail(sql),
    /* Super Admin — ADR-0007. Mesma conexao das outras portas de identidade. */
    platformAdmin: createPlatformAdminAccess(sql),
    /*
     * Candidatura de Parceiro — NR-115, ADR-0013.
     *
     * Mesmo objeto serve `signup()` (so chamada se `account.type === 'parceiro'`)
     * E `registerPartnersRoutes` (`/admin/parceiros*`, `/parceiros/*`) — `authDeps`
     * ja tem `partners`+`platformAdmin`, mesmo raciocinio de `registerAdminRoutes(app, authDeps)`
     * logo abaixo: nao abre uma segunda conexao so para repetir os mesmos dois campos.
     */
    partners: createPartnerApplicationRepository(sql),

    /*
     * Prova de aceite dos documentos legais — RF-02/RF-03, migration 0015.
     *
     * Vem no mesmo objeto pelo mesmo motivo de `partners`: serve `signup()`
     * (que grava o aceite do cadastro) e `registerLegalRoutes` (`/legal/*`,
     * que cuida do reaceite quando sai versao nova).
     */
    legalConsents: createLegalConsentRepository(sql),
  }
}

/**
 * Minimo de senha, o mesmo que `signupInputSchema` promete na tela.
 *
 * Repetido aqui porque quem recusa e o provedor, e um numero diferente daria a
 * pior das recusas: o formulario aceita, a chamada sai, e o erro volta do outro
 * lado com o texto dele.
 */
const MINIMO_DE_SENHA = 8

/**
 * Quem prova a identidade — ADR-0002.
 *
 * A ADR separou a decisao em duas perguntas, e esta funcao e o resultado da
 * segunda. As duas implementacoes satisfazem as MESMAS portas
 * (`IdentityProvider` e `IdentityRegistrar`), entao trocar de provedor e trocar
 * este `if` — e nao migrar modelo de acesso, que continua sendo nosso. Era essa
 * a aposta da ADR quando ela deixou a escolha entre a opcao C e a D em aberto,
 * e ela se pagou: o Better Auth entrou sem tocar em `core`, em `db`, nem em
 * nenhuma tela.
 *
 * `fake` segue sendo o modo local, e `assertAuthUsavelEmProducao` recusa subir
 * com ele em producao.
 */
export function criarIdentidade(): IdentityProvider & IdentityRegistrar {
  if (env.AUTH_PROVIDER === 'better-auth') {
    if (env.BETTER_AUTH_SECRET === undefined) {
      /*
       * Falha no BOOT, e nao no primeiro login.
       *
       * Sem o segredo a biblioteca gera um por processo: duas instancias
       * assinariam diferente, e cada reinicio invalidaria o que a anterior
       * emitiu. E o mesmo defeito que a NR-083 acabou de tirar da nossa sessao,
       * e ele voltaria pela porta do provedor.
       */
      throw new Error(
        'AUTH_PROVIDER=better-auth exige BETTER_AUTH_SECRET (ADR-0002, opcao D). ' +
          'Gere 32+ caracteres aleatorios e defina em .env.',
      )
    }

    return new IdentidadeBetterAuth({
      databaseUrl: env.DATABASE_URL,
      secret: env.BETTER_AUTH_SECRET,
      minimoDeSenha: MINIMO_DE_SENHA,
    })
  }

  /*
   * O falso persiste em DISCO, e nao em memoria. `pnpm dev` roda com `tsx
   * watch`: com o mapa em memoria, CADA ARQUIVO SALVO apagava todas as contas,
   * e a pessoa ficava presa — o login recusava porque a credencial evaporou, e
   * cadastrar de novo recusava porque a empresa continuava no Postgres.
   */
  return new IdentidadeEmArquivo()
}

/**
 * Recusa subir em producao com a autenticacao de desenvolvimento.
 *
 * Mesmo mecanismo do `checkIsolation`: ambiente mal configurado tem de derrubar
 * o processo, nao aceitar login em silencio. `AUTH_PROVIDER=fake` aceita
 * qualquer credencial — subir assim seria publicar um sistema sem porta.
 *
 * A mensagem ENCURTOU nesta tarefa, e o encurtamento e a noticia: ela dizia que
 * "a sessao e a desaceleracao tambem sao de memoria", e as duas passaram a
 * viver no Postgres (NR-083). Sobrou uma coisa a resolver, e e a escolha entre
 * a Opcao C e a D da ADR-0002 — provedor gerenciado ou biblioteca
 * auto-hospedada.
 */
export function assertAuthUsavelEmProducao(): void {
  if (env.NODE_ENV === 'production' && env.AUTH_PROVIDER === 'fake') {
    throw new Error(
      'AUTH_PROVIDER=fake aceita qualquer credencial e nao pode rodar em producao. ' +
        'A sessao e a desaceleracao ja sao persistentes; falta o provedor de ' +
        'identidade (ADR-0002, opcao C ou D). Defina um provedor real antes de subir.',
    )
  }
}

/**
 * Dependencias de cadastro — NR-026.
 *
 * Os tres repositorios sao reais. `companies` e o unico que precisa de
 * tratamento especial na escrita — a politica raiz exige que a empresa nasca
 * sob o proprio tenant, e o repositorio cuida disso.
 */
export function buildCadastroDeps(): CadastroDeps {
  const sql = getClient(env.DATABASE_URL)
  return {
    companies: createCompanyRepository(sql),
    customers: createCustomerRepository(sql),
    products: createProductRepository(sql),
    /* O onboarding semeia o plano de contas padrao — RF-081, NR-077. */
    accounts: createChartOfAccountsRepository(sql),
    /*
     * A importacao de planilha grava o saldo inicial, e saldo so muda por
     * MOVIMENTO (RF-124). Por isso o cadastro precisa do estoque: sem ele, o
     * lojista informaria 40 unidades na planilha e o produto nasceria zerado —
     * que era exatamente o que acontecia antes.
     */
    uow: createInventoryUnitOfWork(sql),
    audit: createAuditTrail(sql),
    /* Geocodifica o endereco ao salvar — ADR-0008. Fecha o TODO de
       `GET /enderecos/cep/:cep` que so existia como mock no front. */
    cepLookup: createBrasilApiCepLookup(),
  }
}

/**
 * Conexao entre lojistas por proximidade — NR-107, ADR-0008.
 *
 * `notifier` usa a MESMA conexao Redis da fila de emissao — ver o comentario
 * em `buildEmissaoDeps`.
 */
export function buildConnectionsDeps(): ConnectionsRouteDeps {
  const sql = getClient(env.DATABASE_URL)
  return {
    suppliers: createSupplierDirectory(sql),
    connections: createConnectionRequests(sql),
    notifier: createConnectionNotifier(getRedis()),
    companies: createCompanyRepository(sql),
  }
}

/**
 * Dependencias da agenda — NR-036.
 *
 * O repositorio e real (Postgres, com o tenant definido pela transacao) e o
 * agendador de lembrete e uma fila BullMQ com atraso.
 *
 * **O lembrete e agendado, mas ainda nao e ENTREGUE.** Nenhum consumidor le a
 * fila `appointment-remind` — o registro de consumidores do worker (NR-041)
 * cobre emissao, mensagem e cobranca, e nao esta. Entao o job fica la, pronto
 * na hora certa, esperando quem o processe. Isso esta dito no PR: agendar sem
 * consumir e melhor que nao agendar (o dado existe quando o consumidor chegar),
 * mas nao e RF-091 fechada.
 */
export function buildAgendaDeps(): AgendaDeps {
  return {
    appointments: createAppointmentRepository(getClient(env.DATABASE_URL)),
    reminders: createReminderScheduler(getRedis()),
  }
}

/**
 * Dependencias de contas a pagar — NR-074.
 *
 * `ids` e `uow` sao o mesmo objeto porque a implementacao em `db` nao gera id
 * de recorrencia — ela usa o do `randomUUID` do Node, injetado aqui. Manter o
 * gerador como porta e o que deixa o teste saber o que vai sair.
 */
/**
 * Extrato e conciliacao — NR-076.
 *
 * Uma instancia de leitura sob dois nomes: `queries` e a porta que o caso de
 * uso de sugestao declara, `listQueries` a que o da fila declara, e as duas sao
 * leitura do mesmo repositorio. Criar duas seria abrir duas vezes o que a
 * conexao ja compartilha.
 *
 * A trilha e a MESMA nos dois ramos de proposito: importar e conciliar contam
 * a historia de um extrato so, e duas trilhas separadas obrigariam quem audita
 * a juntar as pontas.
 */
export function buildConciliacaoDeps(): ConciliacaoDeps {
  const sql = getClient(env.DATABASE_URL)
  const queries = createReconciliationQueries(sql)
  /*
   * A trilha no POSTGRES — NR-087.
   *
   * Era `InMemoryAuditTrail` aqui e em seis outros builders: toda venda, baixa,
   * convite, anonimizacao e exportacao era registrada num `Map` que morria com
   * o processo. "Quem baixou a base inteira, e quando" — a pergunta de depois
   * de um vazamento — nao tinha resposta.
   *
   * Esta e a trilha de FORA da transacao. A conciliacao em si audita por
   * dentro, com `tx.record`, e por isso `ConciliacaoDeps` deixou de pedir uma:
   * quem sobrou aqui e a IMPORTACAO de extrato, que registra um arquivo ja
   * lido.
   */
  const audit = createAuditTrail(sql)

  return {
    uow: createReconciliationUnitOfWork(sql),
    queries,
    listQueries: queries,
    import: {
      parser: createFileStatementReader(),
      transactions: createBankTransactionWriter(sql),
      audit,
    },
  }
}

/**
 * Faturamento e rankings — NR-077, US-041.
 *
 * O fuso vem da `TZ` do ambiente e nao de uma constante no repositorio: e ele
 * que decide em qual MES cai a venda das 21h30 do dia 31, e essa decisao tem
 * de ter uma fonte so no sistema inteiro.
 */
export function buildRelatoriosDeps(): RelatoriosDeps {
  const sql = getClient(env.DATABASE_URL)
  return { reports: createReportRepository(sql, env.TZ) }
}

/** Leitura da trilha de auditoria — US-061. Sob RLS, pela conexao comum. */
export function buildAuditoriaDeps(): AuditoriaDeps {
  const sql = getClient(env.DATABASE_URL)
  return { auditQueries: createAuditQueries(sql) }
}

/**
 * Saldo, ajuste e trilha de estoque — NR-023.
 *
 * A trilha e obrigatoria e nao opcional: a RF-123 pede autoria do ajuste, e uma
 * dependencia opcional aqui seria justamente a que some quando quem monta o
 * grafo esquece dela. Enquanto `db` nao expuser repositorio de auditoria, ela e
 * de memoria — mesma pendencia das outras, e a mesma guarda de producao.
 */
export function buildEstoqueDeps(): EstoqueDeps {
  const sql = getClient(env.DATABASE_URL)
  return {
    products: createInventoryQueries(sql).products,
    uow: createInventoryUnitOfWork(sql),
    historico: createInventoryHistory(sql),
  }
}

/**
 * Chamados de suporte — NR-080.
 *
 * `quemEscreve` le o nome de quem esta logado para a conversa dizer quem falou.
 * O nome e COPIADO na mensagem, e nao referenciado: quem escreveu pode sair da
 * empresa, e a conversa tem de continuar legivel.
 */
export function buildSuporteDeps(): SuporteDeps {
  const sql = getClient(env.DATABASE_URL)
  const users = createUserDirectory(sql)

  return {
    support: createSupportRepository(sql),
    quemEscreve: async (ctx) => (await users.findById(ctx.userId))?.name ?? 'Lojista',
  }
}

/**
 * Baixa e estorno de titulo — NR-029.
 *
 * A trilha e obrigatoria: quem deu a baixa e de quanto e exatamente o que se
 * pergunta quando o caixa nao fecha (US-061). Enquanto `db` nao expuser
 * repositorio de auditoria, ela e de memoria — mesma pendencia das outras.
 */
export function buildBaixasDeps(): BaixasDeps {
  const sql = getClient(env.DATABASE_URL)
  return {
    uow: createSettlementUnitOfWork(sql),
    settlements: createSettlementQueries(sql),
  }
}

/**
 * Direitos do titular — NR-086, RF-125, RF-127.
 *
 * `criarDestino` e fabrica e nao instancia: cada exportacao escreve num pacote
 * proprio, nomeado pela empresa e pelo instante. Um destino compartilhado entre
 * requisicoes faria duas exportacoes simultaneas escreverem no mesmo lugar — e
 * o resultado nao seria erro, seria um pacote com dados de duas lojas dentro.
 *
 * O destino e o DISCO por enquanto. Producao pede armazenamento de objetos, e
 * isso depende da DEC-009; a porta existe para essa troca ser uma linha aqui.
 */
export function buildPrivacidadeDeps(): PrivacidadeDeps {
  const sql = getClient(env.DATABASE_URL)
  return {
    source: createExportSource(sql),
    subjects: createDataSubjectRepository(sql),
    criarDestino: (companyId, carimbo) => new ExportacaoEmArquivo(companyId, carimbo),
    /*
     * A exportacao E auditada, e a trilha ainda nao persiste — `packages/db`
     * nao expoe repositorio de auditoria. Aqui isso pesa mais que nas outras
     * deps: "quem baixou a base inteira, quando" e a pergunta que se faz depois
     * de um vazamento, e hoje a resposta morre com o processo.
     *
     * E a lacuna mais grave que sobrou no sistema, e ela tem tarefa propria.
     */
    audit: createAuditTrail(sql),
  }
}

/** Plano de contas, classificacao e DRE — NR-077. */
export function buildContabilidadeDeps(): ContabilidadeDeps {
  const sql = getClient(env.DATABASE_URL)
  return {
    accounts: createChartOfAccountsRepository(sql),
    /* Mesma pendencia das outras: `db` nao expoe repositorio de auditoria. */
    audit: createAuditTrail(sql),
  }
}

/** Custos fixos — NR-110. */
export function buildCustosFixosDeps(): CustosFixosDeps {
  const sql = getClient(env.DATABASE_URL)
  return {
    fixedCosts: createFixedCostRepository(sql),
    generator: createFixedCostPayableGenerator(sql),
    /* Mesma pendencia das outras: `db` nao expoe repositorio de auditoria. */
    audit: createAuditTrail(sql),
  }
}

/** Lista de espera do pre-lancamento — NR-111. */
export function buildWaitlistDeps(): WaitlistRouteDeps {
  const sql = getClient(env.DATABASE_URL)
  return {
    waitlist: createWaitlistRepository(sql),
    platformAdmin: createPlatformAdminAccess(sql),
    waitlistAdminKey: env.WAITLIST_ADMIN_KEY,
  }
}

/**
 * O quadro de CRM e a equipe — NR-109.
 *
 * `team` le `company_users` direto — nao ha nada de CRM na porta, so o
 * seletor de responsavel do card e o unico consumidor por enquanto.
 */
export function buildCrmDeps(): CrmRouteDeps {
  const sql = getClient(env.DATABASE_URL)
  return {
    crm: createCrmRepository(sql),
    team: createTeamRepository(sql),
  }
}

/**
 * Configuracao da emissao fiscal — NR-042, RF-004.
 *
 * LANCA sem `SECRETS_KEY`, e nao guarda em texto puro. Um caminho alternativo
 * "sem cifragem para desenvolvimento" seria o jeito mais provavel de um token
 * de producao acabar legivel no banco: ninguem lembra de trocar de volta.
 */
export function buildFiscalDeps(): CredenciaisFiscaisDeps {
  if (env.SECRETS_KEY === undefined) {
    throw new Error(
      'SECRETS_KEY nao definida: sem ela nao ha como cifrar o token e o certificado do ' +
        'lojista. Gere com `openssl rand -base64 32` e defina no ambiente.',
    )
  }

  const sql = getClient(env.DATABASE_URL)
  return { fiscalCredentials: createFiscalCredentials(sql, lerChaveDeSegredo(env.SECRETS_KEY)) }
}

/**
 * Emissao da nota — NR-042, RNF-004.
 *
 * A fila usa o MESMO Redis do limitador (`getRedis()`), e nao uma conexao
 * propria: sao o mesmo servidor, e duas conexoes por processo custam duas
 * reconexoes toda vez que ele oscila.
 */
export function buildEmissaoDeps(): EmissaoDeps {
  const sql = getClient(env.DATABASE_URL)
  const store = createInvoiceStore(sql)

  return {
    sales: createSaleFiscalReader(sql),
    queue: createInvoiceQueue(getRedis()),
    store,
    /*
     * A reconciliacao usa o emissor REAL quando ha chave e credenciais, e o
     * falso quando nao ha — o mesmo criterio do worker. Consultar com o falso
     * nao inventa nota: ele devolve o que a guarda tem.
     */
    invoices: montarEmissorDaApi(sql, store),
  }
}

/**
 * O emissor que a api usa para CONSULTAR — NR-042, RF-053.
 *
 * A api nao emite: quem emite e o worker, pela fila. Mas reconciliar
 * contingencia e uma leitura, e ela acontece quando a tela pergunta.
 *
 * Sem `SECRETS_KEY` cai no falso, e nao lanca: aqui a consequencia de nao ter
 * chave e "a reconciliacao nao encontra nada", que e o mesmo que ela encontra
 * quando nao ha contingencia. No worker e diferente — la a falta de chave
 * significaria emitir sem poder, e por isso la ela LANCA.
 */
function montarEmissorDaApi(
  sql: ReturnType<typeof getClient>,
  store: ReturnType<typeof createInvoiceStore>,
): InvoiceIssuer {
  if (env.SECRETS_KEY === undefined) return createFakeInvoiceIssuer()

  return criarEmissorFocusNfe({
    ambiente: 'homologacao',
    credenciais: createFiscalCredentials(sql, lerChaveDeSegredo(env.SECRETS_KEY)),
    store,
  })
}

export function buildContasDeps(): ContasDeps {
  const sql = getClient(env.DATABASE_URL)
  return {
    uow: createPayableUnitOfWork(sql),
    queries: createPayableQueries(sql),
    receivables: createReceivableRepository(sql),
    receivablesUow: createManualReceivableUnitOfWork(sql),
    accounts: createChartOfAccountsRepository(sql),
    ids: { next: () => randomUUID() },
    /* Mesma pendencia da autenticacao: `db` nao expoe repositorio de
       auditoria, entao a trilha do lancamento fica em memoria. */
  }
}

/**
 * Por que o assistente nao pode ser servido — ADR-0010, FR-001b, NR-060.
 *
 * Devolve o motivo, ou `undefined` quando da para servir. Repare no que ela
 * NAO faz: derrubar o processo. Quem chama desliga so a rota do assistente.
 *
 * O canal desta fatia e harness de engenharia: sessao da fixture, nao produto
 * do lojista. Serve em nao-producao, ou em producao so com `AGENT_HARNESS=1`
 * (staging). `AGENT_PROVIDER=fake` nunca e servido em producao — nem com a
 * flag: publicar o reconhecedor de tres frases seria mentir no canal de
 * produto.
 *
 * Recusa de boot fica para falha de SEGURANCA, onde servir seria ativamente
 * nocivo: RLS furada (vaza linha de outra loja) e `AUTH_PROVIDER=fake`
 * (qualquer um entra como qualquer um). Assistente ausente nao vaza nada de
 * ninguem — derrubava venda, financeiro e estoque junto por tabela.
 */
export function motivoDoAgenteIndisponivel(): string | undefined {
  if (env.NODE_ENV === 'production' && env.AGENT_PROVIDER === 'fake') {
    return (
      'AGENT_PROVIDER=fake nao chama modelo nenhum e nao serve em producao. ' +
      'Defina AGENT_PROVIDER=mastra e OPENAI_API_KEY (ADR-0010).'
    )
  }

  if (env.NODE_ENV === 'production' && !env.AGENT_HARNESS) {
    return (
      'Harness do assistente desligado em producao (FR-001b). ' +
      'Defina AGENT_HARNESS=1 so para staging de engenharia, ' +
      'ou aguarde o canal real (NR-113 / NR-121).'
    )
  }

  if (env.AGENT_PROVIDER === 'mastra' && env.OPENAI_API_KEY === undefined) {
    return (
      'AGENT_PROVIDER=mastra exige OPENAI_API_KEY (ADR-0010). ' +
      'Para desenvolver sem chave, use AGENT_PROVIDER=fake.'
    )
  }

  return undefined
}

async function criarLlmDoAgente(tools: readonly ToolDescriptor[]): Promise<LlmPort> {
  if (env.AGENT_PROVIDER !== 'mastra') return new FakeLlm()

  if (env.OPENAI_API_KEY === undefined) {
    /* Inalcancavel: `motivoDoAgenteIndisponivel` ja barrou antes de construir
       nada. Fica pelo estreitamento de tipo, e como rede se alguem chamar
       daqui a dois anos por outro caminho. */
    throw new Error('AGENT_PROVIDER=mastra exige OPENAI_API_KEY (ADR-0010).')
  }

  const { createMastraLlm } = await import('@na-regua/agent/mastra')
  return createMastraLlm({
    model: env.AGENT_MODEL,
    apiKey: env.OPENAI_API_KEY,
    tools,
  })
}

/**
 * Runtime do assistente — NR-060, ADR-0010, FR-001b.
 *
 * Canal de engenharia: `POST /agent/messages` com sessao autenticada da
 * fixture (owner de teste criado pelo desenvolvedor). `companyId` vem do
 * contexto da sessao, nunca do body. Producao sem `AGENT_HARNESS=1` nao
 * monta runtime. Confirmacoes vao para `createConfirmationStore` (Postgres);
 * historico para `createConversationStore` (NR-062). `InMemoryConfirmations`
 * e `InMemoryConversationStore` ficam so no teste unitario do agente.
 */
/** Runtime HTTP + diretorio de fixture do Studio, se o arquivo carregou. */
export type AgentComposition = {
  readonly runtime: AgentRuntime
  readonly studioDirectory?: FixturePeerDirectory
}

/**
 * Presets ausentes/invalidos nao derrubam o HTTP: o Studio e que deixa de
 * montar. O aviso no log e o que faz alguem notar.
 */
function tentarDiretorioStudio(): FixturePeerDirectory | undefined {
  try {
    const arquivo = loadStudioPresets(env.AGENT_STUDIO_PRESETS)
    return new FixturePeerDirectory(arquivo.presets)
  } catch (erro) {
    console.warn(
      JSON.stringify({
        level: 40,
        msg: 'studio presets nao carregados — adapter nao monta; HTTP do assistente segue',
        motivo: erro instanceof Error ? erro.message : String(erro),
      }),
    )
    return undefined
  }
}

/** `null` = sem runtime utilizavel; a rota do assistente responde 503. */
export function buildAgentUseCases(): AgentUseCases {
  const sales = buildSaleDeps()
  const cadastro = buildCadastroDeps()
  const contas = buildContasDeps()
  const estoque = buildEstoqueDeps()
  const relatorios = buildRelatoriosDeps()
  const contabilidade = buildContabilidadeDeps()
  const messages = createFakeMessageSender()

  return {
    listSales: (ctx, input) => listSales(sales, ctx, input),
    listReceivables: (ctx) => listReceivables(contas, ctx),
    checkStock: (ctx, input) => checkStock(estoque, ctx, input),
    checkStockByQuery: (ctx, input) =>
      checkStockByQuery({ products: cadastro.products, inventory: estoque }, ctx, input),
    checkCustomerWalletByQuery: (ctx, input) =>
      checkCustomerWalletByQuery({ customers: cadastro.customers }, ctx, input),
    listPayables: (ctx) => listPayables(contas.queries, ctx),
    registerCustomer: (ctx, input) => registerCustomer(cadastro, ctx, input),
    registerSale: (ctx, input) =>
      registerSale(
        sales,
        {
          ...ctx,
          idempotencyKey: ctx.idempotencyKey ?? `agent:${ctx.requestId}`,
        },
        input,
      ),
    searchProducts: (ctx, input) =>
      searchProducts(cadastro, ctx, {
        ...(input.q === undefined || input.q.trim() === '' ? {} : { termo: input.q }),
        limite: input.pageSize,
      }),
    revenueByMonth: (ctx, input) => buildRevenueByMonth(relatorios, ctx, input),
    buildDre: (ctx, input) => buildDre(contabilidade, ctx, input),
    sendCustomerCharge: (ctx, input) =>
      sendCustomerCharge(
        {
          receivables: contas.receivables,
          customers: cadastro.customers,
          messages,
          consents: {
            /* Harness: o aceite real (coluna whatsapp_consent_at) entra com
               NR-046. Sem isso no CustomerOutput, o canal de teste trata o
               cliente identificado como opt-in. O caso de uso ainda recusa
               quando o leitor devolve nulo — coberto no teste de core. */
            async of() {
              return { optedInAt: new Date('2026-01-01T00:00:00.000Z'), optedOutAt: null }
            },
          },
        },
        ctx,
        input,
      ),
  }
}

/** `null` = sem runtime utilizavel; a rota do assistente responde 503. */
export async function buildAgentDeps(): Promise<AgentComposition | null> {
  if (motivoDoAgenteIndisponivel() !== undefined) return null

  const useCases = buildAgentUseCases()
  const tools = createToolCatalog(useCases)
  const llm = await criarLlmDoAgente(tools)
  const studioDirectory = tentarDiretorioStudio()
  const sql = getClient(env.DATABASE_URL)

  return {
    runtime: createAgentRuntime({
      useCases,
      llm,
      timeZone: env.TZ,
      confirmations: createConfirmationStore(sql),
      aiUsage: new InMemoryAiUsageCounter({
        ...(env.AGENT_MONTHLY_BUDGET_CENTS === undefined
          ? {}
          : { budgetCents: env.AGENT_MONTHLY_BUDGET_CENTS }),
        timeZone: env.TZ,
      }),
      ...(studioDirectory === undefined ? {} : { peers: studioDirectory }),
      /* HTTP app e Studio wa seguem identidades distintas (`app:` vs `wa:`). */
      conversations: createConversationStore(sql),
    }),
    ...(studioDirectory === undefined ? {} : { studioDirectory }),
  }
}
