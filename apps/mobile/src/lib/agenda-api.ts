import { chamarApi } from './api'

/**
 * Agenda — NR-078, RF-089, RF-092, RF-093. US-043 e US-045.
 *
 * Fala com as rotas da NR-036. O que existe no servidor e menos do que a tela
 * de demonstracao mostrava, e as diferencas estao ditas aqui em vez de
 * disfarcadas — ver `Compromisso` abaixo.
 */

export type CompromissoDaApi = {
  readonly id: string
  readonly title: string
  /** Instante em UTC. Quem exibe converte. */
  readonly startsAt: string
  readonly customerId: string | null
  readonly notes: string | null
  readonly reminderMinutesBefore: number | null
  readonly status: 'scheduled' | 'cancelled'
  readonly createdAt: string
}

export type AgendaDoDia = {
  readonly dia: string
  readonly compromissos: readonly CompromissoDaApi[]
  /**
   * Agenda livre dita explicitamente — US-045.
   *
   * Vem do servidor e nao e deduzido de `compromissos.length === 0`: lista
   * vazia e o que a tela receberia tambem se a consulta falhasse e alguem
   * engolisse o erro. "Esta livre" e uma afirmacao; lista vazia e uma ausencia.
   */
  readonly livre: boolean
}

export type ResultadoAgenda<T> =
  { readonly ok: true; readonly dados: T } | { readonly ok: false; readonly erro: string }

/** A agenda de um dia — RF-093. `dia` em `AAAA-MM-DD`. */
export async function agendaDoDia(dia: string): Promise<ResultadoAgenda<AgendaDoDia>> {
  const r = await chamarApi<{
    day: string
    appointments: CompromissoDaApi[]
    isEmpty: boolean
  }>(`/agenda?dia=${dia}`)

  if (!r.ok) return { ok: false, erro: r.message }

  return {
    ok: true,
    dados: { dia: r.dados.day, compromissos: r.dados.appointments, livre: r.dados.isEmpty },
  }
}

/**
 * Marca um compromisso — RF-089, RF-090, RF-091.
 *
 * `startsAt` vai em UTC com fuso explicito. A tela monta a partir de data e
 * hora locais; converter aqui, e nao la, evita que cada tela invente a sua
 * conversao — e uma delas marque o compromisso uma hora errado.
 */
export async function marcarCompromisso(entrada: {
  titulo: string
  quando: Date
  /** Fim vazio e legitimo: "pagar aluguel as 10h" nao dura nada. */
  ate?: Date
  local?: string
  clienteId?: string
  observacao?: string
  lembreteMinutosAntes?: number
}): Promise<ResultadoAgenda<CompromissoDaApi>> {
  const r = await chamarApi<CompromissoDaApi>('/agenda', {
    method: 'POST',
    body: {
      title: entrada.titulo,
      startsAt: entrada.quando.toISOString(),
      ...(entrada.ate === undefined ? {} : { endsAt: entrada.ate.toISOString() }),
      ...(entrada.local === undefined ? {} : { location: entrada.local }),
      ...(entrada.clienteId === undefined ? {} : { customerId: entrada.clienteId }),
      ...(entrada.observacao === undefined ? {} : { notes: entrada.observacao }),
      ...(entrada.lembreteMinutosAntes === undefined
        ? {}
        : { reminderMinutesBefore: entrada.lembreteMinutosAntes }),
    },
  })

  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

/**
 * Cancela — RF-092.
 *
 * Cancelar NAO e apagar (RNF-040): o compromisso some da agenda do dia e
 * continua respondendo por id. Por isso a rota e `POST .../cancelar` e nao
 * `DELETE` — e por isso a tela diz "cancelado", nao "removido".
 */
export async function cancelarCompromisso(
  id: string,
  motivo?: string,
): Promise<ResultadoAgenda<CompromissoDaApi>> {
  const r = await chamarApi<CompromissoDaApi>(`/agenda/${id}/cancelar`, {
    method: 'POST',
    body: motivo === undefined ? {} : { reason: motivo },
  })

  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

/**
 * O dia de hoje em `AAAA-MM-DD`, no fuso do aparelho.
 *
 * `toISOString().slice(0, 10)` daria o dia em UTC — as 21h de Brasilia isso ja
 * e amanha, e o lojista veria a agenda do dia seguinte ao abrir o app a noite.
 * Este e o mesmo erro que o `dateSchema` de contracts passou a recusar do outro
 * lado, e vale a pena nao comete-lo aqui.
 */
export function hojeLocal(agora = new Date()): string {
  const ano = agora.getFullYear()
  const mes = String(agora.getMonth() + 1).padStart(2, '0')
  const dia = String(agora.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

/** A hora do compromisso, no fuso do aparelho, para a lista. */
export function horaLocal(startsAtUtc: string): string {
  const d = new Date(startsAtUtc)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
