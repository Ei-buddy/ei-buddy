import { z } from 'zod'
import { dateSchema, dateTimeSchema, idSchema } from '../common/primitives.js'

/** Compromisso da agenda — glossario `Appointment`. RF-089 a RF-093. */

export const createAppointmentInputSchema = z
  .object({
    title: z.string().trim().min(2, 'Titulo muito curto.').max(140, 'Titulo muito longo.'),
    /** Instante do compromisso, com fuso. Armazenado em UTC. */
    startsAt: dateTimeSchema,
    /**
     * Fim do compromisso. Ausente = pontual, sem duracao — RF-089.
     *
     * "Pagar aluguel as 10h" nao dura nada, e inventar meia hora ocuparia a
     * agenda com um bloco que ninguem pediu. Quando vem, a ordem e conferida
     * abaixo: um compromisso que termina antes de comecar quebra qualquer
     * calculo de sobreposicao.
     */
    endsAt: dateTimeSchema.optional(),
    /**
     * Onde e. Texto livre e nao endereco estruturado: "Loja", "Sala de
     * reuniao" e "Rua Xavier da Silva, 88" sao todos respostas legitimas, e
     * exigir CEP para marcar uma conferencia de estoque nao faria sentido.
     */
    location: z.string().trim().max(200, 'Local muito longo.').optional(),
    /** Vincula ao cliente para aparecer no cadastro dele — RF-090. */
    customerId: idSchema.optional(),
    notes: z.string().trim().max(500, 'Observacao muito longa.').optional(),
    /**
     * Antecedencia do lembrete, em minutos — RF-091.
     *
     * Ausente = sem lembrete. Zero seria "avise na hora", que nao lembra
     * ninguem de nada, entao o minimo e 1.
     */
    reminderMinutesBefore: z
      .number()
      .int('A antecedencia do lembrete deve ser em minutos inteiros.')
      .min(1, 'A antecedencia minima do lembrete e 1 minuto.')
      .max(10_080, 'A antecedencia maxima do lembrete e 7 dias.')
      .optional(),
  })
  .strict()
  /*
   * A ordem dos dois horarios so pode ser conferida DEPOIS de os dois
   * existirem — por isso um refinamento, e nao uma regra de campo.
   */
  .refine((v) => v.endsAt === undefined || Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    message: 'O horario de fim precisa ser depois do inicio.',
    path: ['endsAt'],
  })

export type CreateAppointmentInput = z.infer<typeof createAppointmentInputSchema>

/**
 * Editar ou remarcar — NR-152. O mesmo formulario do cadastro, inteiro: campo
 * opcional que nao veio fica vazio (tirar o local e mandar sem local).
 */
export const updateAppointmentInputSchema = createAppointmentInputSchema

export type UpdateAppointmentInput = CreateAppointmentInput

/** Nada e apagado: compromisso e cancelado — RNF-040. */
export const cancelAppointmentInputSchema = z
  .object({
    appointmentId: idSchema,
    reason: z.string().trim().max(280, 'Motivo muito longo.').optional(),
  })
  .strict()

export type CancelAppointmentInput = z.infer<typeof cancelAppointmentInputSchema>

/** Compromissos de um dia, em ordem de horario — RF-093. */
export const listDayAppointmentsInputSchema = z
  .object({
    /**
     * Dia no fuso de exibicao da empresa, nao em UTC.
     *
     * `dateSchema` e nao um regex proprio: a copia que existia aqui aceitava
     * `2026-13-40`, e a consulta respondia agenda vazia em vez de recusar.
     * Duas validacoes da mesma coisa divergem — foi o que aconteceu.
     */
    day: dateSchema,
  })
  .strict()

export type ListDayAppointmentsInput = z.infer<typeof listDayAppointmentsInputSchema>

/**
 * A agenda de um intervalo — o calendario do mes.
 *
 * Separado de `listDayAppointments` porque responde outra pergunta: a do dia
 * e "o que tenho agora", e vem com `isEmpty`; esta e "onde ha algo marcado",
 * e alimenta os pontinhos da grade. Buscar o mes por trinta e uma chamadas do
 * dia seria trinta e uma idas ao banco para desenhar uma tela.
 *
 * O intervalo tem TETO. Sem ele, `de=2020-01-01&ate=2030-12-31` varreria a
 * agenda inteira da loja numa resposta so — e o calendario nunca precisa de
 * mais que o mes visivel mais as bordas das semanas vizinhas.
 */
export const DIAS_MAXIMOS_DA_AGENDA = 62

export const listAppointmentRangeInputSchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
  })
  .strict()
  .refine((v) => v.to >= v.from, {
    message: 'A data final precisa ser igual ou depois da inicial.',
    path: ['to'],
  })
  .refine(
    (v) =>
      (Date.parse(`${v.to}T00:00:00.000Z`) - Date.parse(`${v.from}T00:00:00.000Z`)) / 86_400_000 <
      DIAS_MAXIMOS_DA_AGENDA,
    {
      message: `O intervalo da agenda vai ate ${DIAS_MAXIMOS_DA_AGENDA} dias.`,
      path: ['to'],
    },
  )

export type ListAppointmentRangeInput = z.infer<typeof listAppointmentRangeInputSchema>

export const appointmentStatusSchema = z.enum(['scheduled', 'cancelled'])
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>

export const appointmentOutputSchema = z.object({
  id: idSchema,
  title: z.string(),
  startsAt: z.string(),
  /** Nulo = compromisso pontual, sem duracao. NAO e "esqueceram de informar". */
  endsAt: z.string().nullable(),
  location: z.string().nullable(),
  customerId: idSchema.nullable(),
  notes: z.string().nullable(),
  reminderMinutesBefore: z.number().int().nullable(),
  status: appointmentStatusSchema,
  createdAt: z.string(),
})

export type AppointmentOutput = z.infer<typeof appointmentOutputSchema>
