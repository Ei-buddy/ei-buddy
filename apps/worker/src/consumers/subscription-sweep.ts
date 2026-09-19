import { sweepSubscription, type SweepSubscriptionDeps } from '@na-regua/core'
import type { ConsumerDeps, ResultadoDoJob } from './types.js'

/**
 * Varredura das assinaturas — RF-111, RF-117, NR-063.
 *
 * Mesmo molde do expurgo de conversa (NR-062): percorre os tenants com
 * `list_company_ids()` e chama o caso de uso uma vez por empresa, cada uma sob
 * o proprio `withTenant`. A leitura ampla fica na funcao `SECURITY DEFINER`,
 * que so devolve uuids; toda ESCRITA continua sob RLS.
 *
 * ## Sem assinatura configurada, a varredura nao roda
 *
 * `deps.assinatura` e `undefined` quando os prazos nao estao no ambiente — sao
 * a QST-002. Varrer sem politica exigiria inventar quantos dias dura o teste,
 * e o job estaria bloqueando lojas por um numero que ninguem escolheu. Melhor
 * nao varrer e dizer que nao varreu.
 *
 * ## O aviso do fim do teste ainda nao sai daqui
 *
 * O caso de uso ja responde QUEM precisa ser avisado (RF-111), e a contagem
 * vai no resultado. Mandar a mensagem depende de saber o contato do dono e de
 * um texto aprovado — trabalho da fatia de notificacao, nao desta. Contar sem
 * enviar e honesto; enviar um texto inventado, nao.
 */
export async function consumirVarreduraDeAssinatura(deps: ConsumerDeps): Promise<ResultadoDoJob> {
  if (deps.assinatura === undefined) {
    return { outcome: 'skipped', detalhes: { motivo: 'prazos de assinatura nao configurados' } }
  }

  const politica: SweepSubscriptionDeps = deps.assinatura
  const tenants = await deps.listTenantIds()

  let restringidas = 0
  let aAvisar = 0

  for (const tenantId of tenants) {
    const r = await sweepSubscription(politica, {
      companyId: tenantId,
      userId: 'job',
      role: 'owner',
      channel: 'job',
      requestId: 'subscription-sweep',
      now: deps.now(),
    })

    if (r.mudou && r.status === 'restricted') restringidas += 1
    if (r.avisarDoFimDoTeste) aAvisar += 1
  }

  return {
    outcome: 'swept',
    detalhes: { empresas: tenants.length, restringidas, aAvisar },
  }
}
