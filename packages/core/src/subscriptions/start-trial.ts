import type { Subscription } from '@na-regua/contracts'
import type { SubscriptionRepository } from '../ports/subscription-repository.js'
import { fimDoTeste, type PoliticaDeAssinatura } from './estado.js'

export type StartTrialDeps = {
  readonly subscriptions: SubscriptionRepository
  readonly politica: PoliticaDeAssinatura
  /** O plano em que o teste roda. Texto, como `subscriptions.plan_code`. */
  readonly planoDoTeste: string
}

/**
 * Comeca o periodo de teste ao concluir o cadastro da empresa — RF-110.
 *
 * ## Sem `ExecutionContext`
 *
 * Como `submitWaitlistEntry`, e pelo mesmo motivo: no instante em que isto
 * roda, a empresa acabou de nascer e quem a criou ainda nao tem papel NELA.
 * Exigir um contexto de tenant aqui obrigaria a fabricar um — e contexto
 * fabricado e pior que contexto ausente, porque parece autorizacao.
 *
 * `criadaEm` entra como parametro pela mesma disciplina de `ctx.now`: o prazo
 * do teste tem de ser testavel sem esperar catorze dias.
 *
 * ## Falhar aqui nao desfaz o cadastro
 *
 * Quem chama e `registerCompany`, depois de a empresa existir — mesmo desenho
 * da semeadura do plano de contas, e pela mesma razao. Se isto falhar, a
 * empresa existe sem assinatura: visivel, recuperavel, e reexecutavel porque
 * `startTrial` e idempotente. Perder o cadastro por causa do teste seria pior
 * que comecar o teste um minuto depois.
 */
export async function startTrial(
  deps: StartTrialDeps,
  entrada: { readonly companyId: string; readonly criadaEm: Date },
): Promise<Subscription> {
  /* Data de calendario para a conta do prazo, instante para gravar. O prazo do
     teste e contado em DIA (o lojista le "ate 03/10"); a coluna e
     `timestamptz`. A conversao acontece aqui, uma vez. */
  const fim = fimDoTeste(entrada.criadaEm.toISOString().slice(0, 10), deps.politica)

  return deps.subscriptions.startTrial({
    companyId: entrada.companyId,
    planCode: deps.planoDoTeste,
    /*
     * Fim do DIA, e nao meia-noite.
     *
     * `2026-10-03` como instante seria `03/10 00:00` — o teste acabaria antes
     * de o dia 03 comecar, e quem leu "seu teste vai ate 03/10" perderia o
     * acesso na manha do dia que ainda era dele.
     */
    trialEndsAt: new Date(`${fim}T23:59:59.999Z`),
    createdAt: entrada.criadaEm,
  })
}
