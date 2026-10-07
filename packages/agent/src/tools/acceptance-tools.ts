import { createTool } from '@mastra/core/tools'
import type { ConfirmationStore } from '@na-regua/core'
import { z } from 'zod'
import { ehConcordanciaPura } from '../acceptance-guard.js'
import type { AgentUseCases } from '../catalog.js'
import { definicoesDeProposta, type ArgsGuardados } from './proposal-tools.js'
import { emErroHumano, semNulos, turnoDe } from './shared.js'

const semArgumentos = z.preprocess(semNulos, z.object({}).passthrough())

/**
 * Aceite e cancelamento da proposta pendente — FR-013 a FR-018.
 *
 * Só ficam disponíveis ao modelo quando há proposta pendente. A trava roda
 * antes de qualquer gravação; a gravação usa os `args` guardados na proposta
 * e a chave de idempotência derivada dela (`confirmation:{id}`).
 */
export function ferramentasDeAceite(casos: AgentUseCases, confirmations: ConfirmationStore) {
  const definicoes = new Map(definicoesDeProposta().map((d) => [d.id, d]))

  return {
    accept_proposal: createTool({
      id: 'accept_proposal',
      description:
        'Grava a proposta pendente. Chame só quando a dona concordar sem corrigir nada. ' +
        'Se ela corrigir algum dado, chame de novo a ferramenta da proposta com o dado corrigido.',
      inputSchema: semArgumentos,
      execute: async (_input, context) => {
        const turno = turnoDe(context)
        const pendente = turno.pendente
        if (pendente === undefined) return { status: 'sem_proposta' }
        if (turno.coletor.decidiuPendente) return { status: 'ja_decidida' }

        const ctx = turno.execucao
        if (pendente.expiresAt.getTime() <= ctx.now.getTime()) {
          await confirmations.resolve(ctx.companyId, pendente.id, 'expired')
          turno.coletor.decidiuPendente = true
          return { status: 'expirada' }
        }

        if (!ehConcordanciaPura(turno.textoDaDona, turno.resumo)) {
          return {
            status: 'nao_e_aceite',
            orientacao:
              'A resposta trouxe um dado novo ou uma ressalva. Não grave: refaça a proposta com o dado corrigido, ou pergunte.',
          }
        }

        const definicao = definicoes.get(pendente.toolId)
        if (definicao === undefined) return { status: 'sem_proposta' }

        await confirmations.resolve(ctx.companyId, pendente.id, 'accepted')
        turno.coletor.decidiuPendente = true

        return emErroHumano(async () => {
          const resultado = await definicao.executar(
            casos,
            { ...ctx, idempotencyKey: `confirmation:${pendente.id}` },
            pendente.args as ArgsGuardados,
          )
          turno.coletor.registrar(...(resultado.entidades ?? []))

          /* Cadastro feito no meio de outro pedido: o pedido continua vivo e o
             modelo é orientado a retomá-lo neste mesmo turno (FR-030). */
          const intencao = turno.resumo.intencao
          if (
            resultado.status === 'gravado' &&
            intencao?.aguardando.startsWith('cadastro_') === true
          ) {
            turno.coletor.intencao = { ...intencao, aguardando: 'dados' }
            return {
              ...resultado,
              retomar:
                `Retome agora: ${intencao.descricao}. Já dito: ${JSON.stringify(intencao.jaDito)}. ` +
                `Chame agora ${intencao.acao} com esses dados (use o ref do que acabou de ser cadastrado); ` +
                'a própria ferramenta diz o que falta. Não responda antes de chamar.',
            }
          }
          return resultado
        })
      },
    }),

    cancel_proposal: createTool({
      id: 'cancel_proposal',
      description: 'Cancela a proposta pendente sem gravar. Use quando a dona recusar.',
      inputSchema: semArgumentos,
      execute: async (_input, context) => {
        const turno = turnoDe(context)
        const pendente = turno.pendente
        if (pendente === undefined) return { status: 'sem_proposta' }
        if (turno.coletor.decidiuPendente) return { status: 'ja_decidida' }
        await confirmations.resolve(turno.execucao.companyId, pendente.id, 'rejected')
        turno.coletor.decidiuPendente = true
        return { status: 'cancelada' }
      },
    }),
  }
}

export const TOOLS_DE_ACEITE = ['accept_proposal', 'cancel_proposal'] as const
