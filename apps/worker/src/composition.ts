import { createFakeInvoiceIssuer, criarEmissorFocusNfe } from '@na-regua/fiscal'
import {
  createConversationPurgeRepository,
  createSubscriptionRepository,
  createFiscalCredentials,
  createInvoiceStore,
  getClient,
  lerChaveDeSegredo,
  listCompanyIds,
} from '@na-regua/db'
import { createFakeMessageSender } from '@na-regua/whatsapp'
import type { Queue } from 'bullmq'
import type { ConsumerDeps, OverdueReader } from './consumers/types.js'
import { loadWorkerEnv } from '@na-regua/env'
import { log } from './logging.js'
import type { QueueName } from './queues.js'

/**
 * RAIZ DE COMPOSICAO do worker.
 *
 * Como no `api`, este e o unico arquivo autorizado a conhecer adapters. Os
 * consumidores recebem portas e nao sabem quem esta do outro lado — e o que
 * permite testa-los sem Redis, sem SEFAZ e sem WhatsApp.
 *
 * **Os adapters sao os FALSOS por enquanto** (NR-040, NR-043, NR-045
 * entregaram porta + adapter falso; os reais sao NR-042, NR-044, NR-046, todos
 * bloqueados por decisao de provedor). Isso e proposital e nao gambiarra: o
 * adapter falso existe para o resto do sistema poder ser construido e testado
 * antes de a decisao sair. Trocar por real e trocar esta linha.
 */

/**
 * Leitor de vencidos ainda sem implementacao.
 *
 * Precisa do banco, e `packages/db` nao expoe repositorio nenhum — so
 * `getClient`, `migrate`, `withTenant` e o guarda de RLS. Nenhuma tarefa do
 * ledger cria esses repositorios, e isso ja esta registrado no ledger como
 * pendencia de planejamento.
 *
 * Devolve lista vazia e **avisa em cada varredura**, em vez de fingir que
 * varreu. Uma varredura silenciosa que nunca cobra ninguem e pior que uma que
 * grita: a primeira parece funcionar.
 */
const leitorDeVencidosPendente: OverdueReader = {
  listOverdue: async (hoje) => {
    log('warn', 'varredura de cobranca sem leitor de vencidos: nada foi cobrado', {
      hoje,
      motivo: 'packages/db nao expoe repositorio — ver task-ledger.md',
    })
    return []
  },
}

/* Validado uma vez, aqui na raiz de composicao — NR-006. */
const env = loadWorkerEnv()

/**
 * Expurgo sem banco: devolve zero e avisa, em vez de fingir que rodou contra
 * dado de producao. Mesmo molde do leitor de vencidos pendente.
 */
const expurgoSemBanco: Pick<ConsumerDeps, 'conversations' | 'listTenantIds'> = {
  conversations: {
    deleteMessagesOlderThan: async () => 0,
    closeConversationsWithoutMessages: async () => 0,
  },
  listTenantIds: async () => {
    log('warn', 'expurgo de conversa sem banco: nada foi apagado', {
      motivo: 'DATABASE_URL ausente — repositorio de expurgo nao montado',
    })
    return []
  },
}

function montarExpurgo(): Pick<ConsumerDeps, 'conversations' | 'listTenantIds'> {
  if (env.DATABASE_URL === undefined) return expurgoSemBanco

  const sql = getClient(env.DATABASE_URL)
  return {
    conversations: createConversationPurgeRepository(sql),
    /* companies e a raiz do tenant; sem deleted_at no catalogo. Nao usa
       BYPASSRLS nem SELECT cru — list_company_ids (SECURITY DEFINER, so id). */
    listTenantIds: () => listCompanyIds(sql),
  }
}

/**
 * O emissor de nota — DEC-004, NR-042.
 *
 * `fake` nao emite nada. `focusnfe` fala com o provedor de verdade, e para
 * isso precisa do banco (credenciais cifradas por lojista) e da chave que as
 * decifra.
 *
 * A falta de qualquer um dos dois LANCA, e nao cai no falso em silencio: um
 * worker que acha estar emitindo e nao esta e a pior falha possivel aqui — o
 * lojista vende, ve "nota emitida" e descobre meses depois, com o contador, que
 * nunca saiu documento nenhum.
 */
function montarEmissor(): ConsumerDeps['invoices'] {
  if (env.FISCAL_PROVIDER === 'fake') return createFakeInvoiceIssuer()

  if (env.DATABASE_URL === undefined || env.SECRETS_KEY === undefined) {
    throw new Error(
      'FISCAL_PROVIDER=focusnfe exige DATABASE_URL e SECRETS_KEY. ' +
        'Sem elas nao ha como ler o token do lojista, e emitir em nome dele seria impossivel.',
    )
  }

  const sql = getClient(env.DATABASE_URL)
  /* `lerChaveDeSegredo` recusa chave curta ou placeholder — ver secret-box.ts. */
  const chave = lerChaveDeSegredo(env.SECRETS_KEY)

  return criarEmissorFocusNfe({
    ambiente: env.FISCAL_AMBIENTE,
    credenciais: createFiscalCredentials(sql, chave),
    store: createInvoiceStore(sql),
  })
}

/**
 * A varredura de assinatura — RF-111, RF-117, NR-063.
 *
 * `undefined` quando falta o banco OU quando os prazos nao estao no ambiente.
 * Os prazos sao a QST-002: varrer sem politica exigiria inventar quantos dias
 * dura o teste, e o job estaria bloqueando lojas por um numero que ninguem
 * escolheu. O consumidor devolve `skipped` e diz por que.
 *
 * Os quatro andam juntos pelo mesmo motivo da api: meia politica seria um
 * teste que comeca e nunca avisa que vai acabar.
 */
function montarVarreduraDeAssinatura(): ConsumerDeps['assinatura'] {
  const { BILLING_TRIAL_DAYS, BILLING_TRIAL_WARNING_DAYS, BILLING_GRACE_DAYS } = env

  if (
    env.DATABASE_URL === undefined ||
    BILLING_TRIAL_DAYS === undefined ||
    BILLING_TRIAL_WARNING_DAYS === undefined ||
    BILLING_GRACE_DAYS === undefined
  ) {
    return undefined
  }

  return {
    subscriptions: createSubscriptionRepository(getClient(env.DATABASE_URL)),
    politica: {
      diasDeTeste: BILLING_TRIAL_DAYS,
      diasDeAvisoDoFimDoTeste: BILLING_TRIAL_WARNING_DAYS,
      diasDeTolerancia: BILLING_GRACE_DAYS,
    },
  }
}

export function montarDeps(queues: Map<QueueName, Queue>): ConsumerDeps {
  const expurgo = montarExpurgo()
  return {
    invoices: montarEmissor(),
    messages: createFakeMessageSender(),
    overdue: leitorDeVencidosPendente,
    enqueue: {
      add: async (queue, payload) => {
        const fila = queues.get(queue as QueueName)
        if (fila === undefined) {
          /* Fila desconhecida e defeito de programacao, nao condicao de
             execucao: melhor estourar aqui do que enfileirar no vazio. */
          throw new Error(`Fila desconhecida: ${queue}`)
        }
        await fila.add(queue, payload)
      },
    },
    now: () => new Date(),
    conversations: expurgo.conversations,
    listTenantIds: expurgo.listTenantIds,
    assinatura: montarVarreduraDeAssinatura(),
  }
}
