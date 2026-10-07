import {
  cancelAppointmentInputSchema,
  createAppointmentInputSchema,
  listAppointmentRangeInputSchema,
  listDayAppointmentsInputSchema,
  updateAppointmentInputSchema,
} from '@na-regua/contracts'
import {
  type CancelAppointmentDeps,
  cancelAppointment,
  createAppointment,
  type CreateAppointmentDeps,
  listAppointmentRange,
  type ListAppointmentRangeDeps,
  listDayAppointments,
  updateAppointment,
  type UpdateAppointmentDeps,
} from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'

/**
 * Rotas da agenda — NR-036, RF-089 a RF-093.
 *
 * Como a rota de venda: le o contexto, valida a forma, chama o caso de uso e
 * traduz. Antecedencia do lembrete, alcada por papel e "cancelado nao some"
 * ficam em `core` — se morassem aqui, o canal WhatsApp marcaria compromisso
 * por outro caminho, com outras regras.
 */

export type AgendaDeps = CreateAppointmentDeps &
  CancelAppointmentDeps &
  UpdateAppointmentDeps &
  ListAppointmentRangeDeps

export function registerAgendaRoutes(app: FastifyInstance, deps: AgendaDeps): void {
  /** Marcar — RF-089, RF-090, RF-091. */
  app.post('/agenda', { config: { rateLimit: LIMITE_DE_ESCRITA } }, async (request, reply) => {
    const ctx = requireContext(request)
    const input = validate(createAppointmentInputSchema, request.body)

    const compromisso = await createAppointment(deps, ctx, input)

    return reply.code(201).send(compromisso)
  })

  /**
   * A agenda — RF-093.
   *
   * `GET` com o recorte na query, e nao no caminho: `?dia=2026-09-10` deixa
   * claro que e um filtro sobre a mesma colecao. `/agenda/2026-09-10`
   * pareceria um recurso, e o dia nao e um.
   *
   * Dois recortes, uma rota, e a resposta diz qual veio:
   *
   * - `?de=&ate=` — o intervalo que o calendario do mes desenha. Devolve so a
   *   lista: no calendario, mes sem nada marcado se desenha igual a mes cheio.
   * - `?dia=` — a agenda daquele dia, com `isEmpty`. Ali a distincao importa:
   *   "nao ha nada hoje" e "nao consegui carregar" sao coisas diferentes, e
   *   lista vazia sozinha nao diz qual das duas aconteceu.
   *
   * O intervalo e conferido ANTES do dia. Quem manda `de` e `ate` nao mandou
   * `dia`, e validar o dia primeiro recusaria o pedido por um campo que nao
   * era para estar la.
   */
  app.get('/agenda', async (request, reply) => {
    const ctx = requireContext(request)
    const { dia, de, ate } = request.query as { dia?: string; de?: string; ate?: string }

    if (de !== undefined || ate !== undefined) {
      const recorte = validate(listAppointmentRangeInputSchema, { from: de, to: ate })

      return reply.code(200).send(await listAppointmentRange(deps, ctx, recorte))
    }

    const input = validate(listDayAppointmentsInputSchema, { day: dia })

    const agenda = await listDayAppointments(deps, ctx, input)

    /*
     * `isEmpty` vai junto, e nao e redundante com `appointments.length === 0`:
     * o caso de uso responde "a agenda esta livre" explicitamente, e a tela que
     * mostra "nada marcado para hoje" nao deveria ter de deduzir isso de uma
     * lista vazia — que tambem e o que ela receberia se a consulta falhasse.
     */
    return reply.code(200).send(agenda)
  })

  /**
   * Cancelar — RF-092.
   *
   * `POST .../cancelar` e nao `DELETE`: nada e apagado (RNF-040). O
   * compromisso continua existindo, some da agenda do dia e continua
   * respondendo por id. `DELETE` prometeria o contrario.
   */
  /* Editar ou remarcar — NR-152. O lembrete e refeito para o horario novo. */
  app.patch('/agenda/:id', { config: { rateLimit: LIMITE_DE_ESCRITA } }, async (request, reply) => {
    const ctx = requireContext(request)
    const { id } = request.params as { id: string }
    const input = validate(updateAppointmentInputSchema, request.body)

    return reply.code(200).send(await updateAppointment(deps, ctx, id, input))
  })

  app.post(
    '/agenda/:id/cancelar',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }
      const corpo = (request.body ?? {}) as Record<string, unknown>

      const input = validate(cancelAppointmentInputSchema, { ...corpo, appointmentId: id })

      const compromisso = await cancelAppointment(deps, ctx, input)

      return reply.code(200).send(compromisso)
    },
  )
}
