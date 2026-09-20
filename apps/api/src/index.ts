import Fastify from 'fastify'
import {
  motivoDoAgenteIndisponivel,
  assertAuthUsavelEmProducao,
  buildAgendaDeps,
  buildAgentDeps,
  buildAuthDeps,
  buildCadastroDeps,
  buildConciliacaoDeps,
  buildConnectionsDeps,
  buildContabilidadeDeps,
  buildCustosFixosDeps,
  buildWaitlistDeps,
  buildWebhookDeps,
  buildEmissaoDeps,
  buildFiscalDeps,
  buildContasDeps,
  buildCrmDeps,
  buildBaixasDeps,
  buildEstoqueDeps,
  buildPrivacidadeDeps,
  buildSuporteDeps,
  buildAuditoriaDeps,
  buildRelatoriosDeps,
  getRedis,
  buildSaleDeps,
  checkDatabase,
  checkIsolation,
  checkRedis,
  env,
  shutdown,
} from './composition.js'
import { registerErrorHandler } from './plugins/error-handler.js'
import { buildLoggerOptions, generateRequestId, registerLogging } from './plugins/logging.js'
import { registerRateLimit } from './plugins/rate-limit.js'
import { registerSession } from './plugins/session.js'
import { registerAdminRoutes } from './routes/admin.js'
import { registerPartnersRoutes } from './routes/partners.js'
import { registerLegalRoutes } from './routes/legal.js'
import { registerAgendaRoutes } from './routes/agenda.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerCadastroRoutes } from './routes/cadastro.js'
import { registerConciliacaoRoutes } from './routes/conciliacao.js'
import { registerConnectionsRoutes } from './routes/connections.js'
import { registerContabilidadeRoutes } from './routes/contabilidade.js'
import { registerCustosFixosRoutes } from './routes/custos-fixos.js'
import { registerWaitlistRoutes } from './routes/waitlist.js'
import { registerWebhookRoutes } from './routes/webhooks.js'
import { registerBaixasRoutes } from './routes/baixas.js'
import { registerContasRoutes } from './routes/contas.js'
import { registerCrmRoutes } from './routes/crm.js'
import { registerEmissaoRoutes, registerFiscalRoutes } from './routes/fiscal.js'
import { registerEstoqueRoutes } from './routes/estoque.js'
import { registerRelatoriosRoutes } from './routes/relatorios.js'
import { registerAuditoriaRoutes } from './routes/auditoria.js'
import { registerPrivacidadeRoutes } from './routes/privacidade.js'
import { registerSuporteRoutes } from './routes/suporte.js'
import { registerSaleRoutes } from './routes/sales.js'
import { registerAgentRoutes } from './routes/agent.js'
import { montarStudio } from './studio.js'

// RNF-058: log estruturado (JSON) com requestId, companyId e userId.
const app = Fastify({
  logger: buildLoggerOptions(env.LOG_LEVEL),
  /* Reaproveita o x-request-id de quem chamou, para a operacao ser seguivel
     entre servicos. Ver plugins/logging.ts sobre por que ele e sanitizado. */
  genReqId: generateRequestId,
})

registerLogging(app)

/* Antes de qualquer rota: erro de rota nao registrada tambem passa por aqui. */
registerErrorHandler(app)

/**
 * Saude da aplicacao e das dependencias.
 * Responde 200 so quando TODAS estao saudaveis — health check que sempre
 * responde 200 nao serve para nada.
 */
app.get('/health', async (_request, reply) => {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()])
  const ok = database.ok && redis.ok

  return reply.code(ok ? 200 : 503).send({
    status: ok ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    checks: { database, redis },
  })
})

/** Liveness: o processo esta de pe? Nao toca em dependencia externa. */
app.get('/health/live', async () => ({ status: 'ok' }))

/**
 * Rotas, numa funcao assincrona porque o limitador e um plugin do Fastify e
 * plugin se registra com `await`.
 *
 * A ORDEM importa e nao e estetica:
 *
 * 1. o limitador precisa existir antes de qualquer rota que o declare
 *    (`config.rateLimit` numa rota sem o plugin registrado nao limita nada, e
 *    falha em silencio — que e o pior jeito de um controle de seguranca falhar);
 * 2. a sessao e um hook `onRequest`, e popula `request.principal` para todas.
 */
async function registrarRotas(): Promise<void> {
  /* `getRedis()` para o limite valer para a frota, e nao por processo — com
     duas instancias e contador em memoria, o teto real dobra sem ninguem ver. */
  await registerRateLimit(app, getRedis())

  const authDeps = buildAuthDeps()
  registerSession(app, authDeps.sessions)
  registerAuthRoutes(app, authDeps)
  registerAdminRoutes(app, authDeps)
  registerPartnersRoutes(app, authDeps)
  /* Reaceite dos documentos legais (RF-03). `authDeps` ja tem `legalConsents`. */
  registerLegalRoutes(app, authDeps)

  /* `buildSaleDeps()` abre a conexao, entao e chamada aqui e nao no topo do
     modulo — ver o comentario em composition.ts. */
  registerSaleRoutes(app, buildSaleDeps())
  registerAgendaRoutes(app, buildAgendaDeps())
  registerCadastroRoutes(app, buildCadastroDeps())
  registerConnectionsRoutes(app, buildConnectionsDeps())
  registerContasRoutes(app, buildContasDeps())
  registerBaixasRoutes(app, buildBaixasDeps())
  registerConciliacaoRoutes(app, buildConciliacaoDeps())
  registerContabilidadeRoutes(app, buildContabilidadeDeps())
  registerCustosFixosRoutes(app, buildCustosFixosDeps())
  registerWaitlistRoutes(app, buildWaitlistDeps())
  /* Sem sessao e sem limitador: quem chama e o provedor, e um 429 aqui faria
     ele pausar a fila de avisos — e fila pausada e loja que nao destrava. */
  registerWebhookRoutes(app, buildWebhookDeps())
  registerRelatoriosRoutes(app, buildRelatoriosDeps())
  registerAuditoriaRoutes(app, buildAuditoriaDeps())
  registerEstoqueRoutes(app, buildEstoqueDeps())
  registerSuporteRoutes(app, buildSuporteDeps())
  registerCrmRoutes(app, buildCrmDeps())
  registerPrivacidadeRoutes(app, buildPrivacidadeDeps())
  registerEmissaoRoutes(app, buildEmissaoDeps())

  /*
   * Assistente sem runtime utilizavel desliga a ROTA, e nao a api — mesmo
   * criterio da emissao fiscal logo abaixo. O aviso no log e o que faz alguem
   * notar antes do lojista.
   */
  const motivoDoAgente = motivoDoAgenteIndisponivel()
  if (motivoDoAgente !== undefined) {
    app.log.warn({ motivo: motivoDoAgente }, 'assistente desligado — ver AGENT_PROVIDER')
  }
  const agentDeps = await buildAgentDeps()
  registerAgentRoutes(app, agentDeps, motivoDoAgente)
  await montarStudio(app, {
    motivo: motivoDoAgente,
    runtime: agentDeps?.runtime ?? null,
    directory: agentDeps?.studioDirectory ?? null,
  })

  /*
   * A falta da chave de cifragem NAO impede a api de subir: ela desliga uma
   * tela, e derrubar o processo inteiro por isso seria trocar um recurso
   * ausente por indisponibilidade total. O aviso no log e o que faz alguem
   * notar antes do lojista.
   */
  try {
    registerFiscalRoutes(app, buildFiscalDeps())
  } catch (erro) {
    app.log.warn(
      { motivo: (erro as Error).message },
      'configuracao de emissao fiscal desligada — ver SECRETS_KEY',
    )
    registerFiscalRoutes(app, null)
  }
}

async function main(): Promise<void> {
  /*
   * Antes de abrir a porta: a conexao desta api esta MESMO sujeita a RLS?
   *
   * Um papel superusuario ou com BYPASSRLS ignora a politica e faz toda
   * consulta devolver as linhas de todas as lojas, sem erro nenhum. Aconteceu
   * num ambiente real e so a CI notou. Subir assim e pior que nao subir.
   */
  /* Antes de tudo: autenticacao de desenvolvimento nao sobe em producao.
     Sincrono e sem I/O, entao vem antes ate da checagem de isolamento. */
  assertAuthUsavelEmProducao()

  await registrarRotas()

  const isolamento = await checkIsolation()

  if (isolamento.status === 'bypassed') {
    app.log.fatal(isolamento.reason)
    await shutdown()
    process.exit(1)
  }

  if (isolamento.status === 'unknown') {
    /* Banco fora do ar e indisponibilidade, nao falha de seguranca: `/health`
       ja responde 503 e o orquestrador ja sabe. Recusar subir aqui deixaria
       nem o `/health/live` de pe. */
    app.log.warn(
      { motivo: isolamento.reason },
      'nao foi possivel verificar o isolamento entre empresas na subida',
    )
  } else {
    app.log.info({ papel: isolamento.role }, 'isolamento entre empresas em vigor')
  }

  try {
    await app.listen({ port: env.API_PORT, host: '0.0.0.0' })
    app.log.info(`api ouvindo em http://localhost:${env.API_PORT} — saude em /health`)
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      app.log.info(`${signal} recebido, encerrando`)
      await app.close()
      await shutdown()
      process.exit(0)
    })()
  })
}

/**
 * `main()` com `catch`, e nao `void main()`.
 *
 * Sem ele, qualquer falha na subida virava uma rejeicao nao tratada: o Node
 * imprimia a excecao crua e encerrava, sem passar pelo logger e sem dizer o que
 * o processo estava tentando fazer. Quem instalava via um `AggregateError
 * ECONNREFUSED` de dez linhas e nenhuma pista de que faltava subir a infra.
 *
 * O log estruturado aqui e o que transforma "morreu" em "morreu por isto".
 */
main().catch((erro: unknown) => {
  app.log.fatal(
    { motivo: erro instanceof Error ? erro.message : String(erro) },
    'a api nao conseguiu subir',
  )
  process.exit(1)
})
