/**
 * A agenda — NR-036, RF-089 a RF-093.
 *
 * Era toda de exemplo: seis compromissos fixos de agosto de 2026, iguais para
 * qualquer loja, e `criarEvento`/`excluirEvento` eram `delay()` seguidos de
 * `{ ok: true }`. O lojista marcava, via "Compromisso criado", trocava de mes e
 * voltava — e a agenda estava como antes.
 *
 * Agora fala com `/api/agenda`, que repassa para as rotas de verdade.
 */

import { pedir, type Resultado } from './http'

/* -------------------------------------------------------------------------- */
/* Fuso: o banco guarda instante, a tela mostra dia e hora                     */
/* -------------------------------------------------------------------------- */

/*
 * `hoje` e `diaLocal` MORAM em `format.ts` agora.
 *
 * Nasceram aqui, ao consertar a agenda congelada em 24/08/2026, e depois se
 * descobriu que o resto do app tinha a mesma data fixa em outros seis lugares
 * — inclusive em `daysUntil`, que decide se um titulo esta vencido. Uma
 * resposta para "que dia e hoje" serve o app inteiro; duas divergem.
 *
 * Reexportadas para os consumidores e o teste desta agenda continuarem
 * apontando para ca.
 */
export { diaLocal, hoje } from './format'
import { diaLocal, hoje } from './format'

/** `HH:MM` no fuso local. */
export function horaLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * Dia e hora locais viram um INSTANTE.
 *
 * `new Date('2026-09-10T09:00')` — sem `Z` — e interpretado no fuso do
 * navegador, que e exatamente o que o lojista quis dizer ao digitar 09:00.
 * Montar a string com `Z` marcaria nove da manha em Londres.
 */
export function instante(dia: string, hora: string): string {
  return new Date(`${dia}T${hora}:00`).toISOString()
}

/* -------------------------------------------------------------------------- */
/* Compromissos                                                               */
/* -------------------------------------------------------------------------- */

export type Evento = {
  id: string
  titulo: string
  descricao: string
  /** AAAA-MM-DD no fuso de quem olha. */
  data: string
  horaInicio: string
  /** Nulo = compromisso pontual. NAO e "esqueceram de preencher". */
  horaFim: string | null
  local: string
  /** Minutos antes do compromisso para avisar no WhatsApp. */
  lembreteMinutos: number | null
}

type CompromissoDaApi = {
  id: string
  title: string
  startsAt: string
  endsAt: string | null
  location: string | null
  notes: string | null
  reminderMinutesBefore: number | null
}

const paraEvento = (a: CompromissoDaApi): Evento => {
  const inicio = new Date(a.startsAt)
  const fim = a.endsAt === null ? null : new Date(a.endsAt)

  return {
    id: a.id,
    titulo: a.title,
    /* A observacao do contrato e a descricao da tela: sao o mesmo campo com
       dois nomes, e nao dois campos. */
    descricao: a.notes ?? '',
    data: diaLocal(inicio),
    horaInicio: horaLocal(inicio),
    horaFim: fim === null ? null : horaLocal(fim),
    local: a.location ?? '',
    lembreteMinutos: a.reminderMinutesBefore,
  }
}

/**
 * Os compromissos de um intervalo — o mes que o calendario desenha.
 *
 * Uma chamada para o mes inteiro, e nao uma por dia: a grade tem quarenta e
 * duas celulas, e busca-las uma a uma seriam quarenta e duas idas ao servidor
 * para desenhar uma tela.
 */
export async function listarEventos(de: string, ate: string): Promise<Resultado<Evento[]>> {
  const r = await pedir<{ appointments: CompromissoDaApi[] }>(
    `/api/agenda?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`,
  )

  return r.ok ? { ok: true, dados: r.dados.appointments.map(paraEvento) } : r
}

export type DadosEvento = {
  titulo: string
  descricao: string
  data: string
  horaInicio: string
  horaFim: string
  local: string
  lembreteMinutos: number | null
}

/**
 * Marca o compromisso — RF-089, RF-090, RF-091.
 *
 * Campo vazio nao viaja. O contrato e `.strict()` com minimos de tamanho, e
 * mandar `location: ''` seria recusado como local invalido por quem
 * simplesmente nao quis preencher.
 */
function corpoDoEvento(dados: DadosEvento) {
  const descricao = dados.descricao.trim()
  const local = dados.local.trim()
  return {
    title: dados.titulo.trim(),
    startsAt: instante(dados.data, dados.horaInicio),
    /* Fim vazio e legitimo: "pagar aluguel as 10h" nao dura nada. */
    ...(dados.horaFim === '' ? {} : { endsAt: instante(dados.data, dados.horaFim) }),
    ...(local === '' ? {} : { location: local }),
    ...(descricao === '' ? {} : { notes: descricao }),
    ...(dados.lembreteMinutos === null ? {} : { reminderMinutesBefore: dados.lembreteMinutos }),
  }
}

/**
 * Editar ou remarcar — NR-152. O mesmo corpo do cadastro: campo vazio nao
 * viaja, e a api entende "nao veio" como "ficou vazio".
 */
export async function editarEvento(id: string, dados: DadosEvento): Promise<Resultado<Evento>> {
  const r = await pedir<CompromissoDaApi>(`/api/agenda/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(corpoDoEvento(dados)),
  })

  return r.ok ? { ok: true, dados: paraEvento(r.dados) } : r
}

export async function criarEvento(dados: DadosEvento): Promise<Resultado<Evento>> {
  const r = await pedir<CompromissoDaApi>('/api/agenda', {
    method: 'POST',
    body: JSON.stringify(corpoDoEvento(dados)),
  })

  return r.ok ? { ok: true, dados: paraEvento(r.dados) } : r
}

/**
 * CANCELA o compromisso — RF-092. Nao apaga.
 *
 * Chamava-se `excluirEvento`, e o nome mentia sobre o que o sistema faz: nada
 * e apagado (RNF-040). O compromisso sai da agenda e continua respondendo por
 * id, que e o que permite reconstruir depois o que foi desmarcado.
 */
export async function cancelarEvento(id: string, motivo?: string): Promise<Resultado<Evento>> {
  const r = await pedir<CompromissoDaApi>(`/api/agenda/${encodeURIComponent(id)}/cancelar`, {
    method: 'POST',
    body: JSON.stringify(motivo === undefined || motivo.trim() === '' ? {} : { reason: motivo }),
  })

  return r.ok ? { ok: true, dados: paraEvento(r.dados) } : r
}

/** Opcoes de lembrete, em minutos antes do compromisso. */
export const LEMBRETES = [
  { valor: null, rotulo: 'Sem lembrete' },
  { valor: 15, rotulo: '15 minutos antes' },
  { valor: 30, rotulo: '30 minutos antes' },
  { valor: 60, rotulo: '1 hora antes' },
  { valor: 1440, rotulo: '1 dia antes' },
]

/* -------------------------------------------------------------------------- */
/* Calendario                                                                 */
/* -------------------------------------------------------------------------- */

export const NOMES_MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

export const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export type DiaCalendario = {
  /** AAAA-MM-DD */
  data: string
  dia: number
  doMes: boolean
  hoje: boolean
}

/**
 * Monta a grade do mes, completando com os dias vizinhos para as semanas
 * ficarem cheias.
 *
 * As datas sao construidas em UTC e viram texto AAAA-MM-DD. Aqui isso e
 * seguro, e nao contradiz `diaLocal`: `Date.UTC(2026, 8, 10)` e um rotulo de
 * calendario, nao um instante — nao ha hora para o fuso deslocar. O que nao
 * pode passar por UTC e a conversao de um INSTANTE em dia, que e onde as 21h
 * de Sao Paulo virariam o dia seguinte.
 */
export function montarMes(ano: number, mes: number, referencia = hoje()): DiaCalendario[] {
  const primeiro = new Date(Date.UTC(ano, mes, 1))
  const inicioSemana = primeiro.getUTCDay()

  const dias: DiaCalendario[] = []
  const totalCelulas = 42 /* 6 semanas cobrem qualquer mes */

  for (let i = 0; i < totalCelulas; i++) {
    const d = new Date(Date.UTC(ano, mes, 1 - inicioSemana + i))
    const iso = d.toISOString().slice(0, 10)

    dias.push({
      data: iso,
      dia: d.getUTCDate(),
      doMes: d.getUTCMonth() === mes,
      hoje: iso === referencia,
    })
  }

  /* Corta a ultima semana se ela for toda do mes seguinte. */
  const ultimaSemana = dias.slice(35)
  return ultimaSemana.every((d) => !d.doMes) ? dias.slice(0, 35) : dias
}

/**
 * As pontas do que o calendario pede ao servidor.
 *
 * A grade mostra as bordas das semanas vizinhas, entao o intervalo NAO e o mes
 * civil: pedir so de 1 a 31 deixaria os dias de fora sem pontinho, e o lojista
 * veria o dia 30 do mes passado vazio com um compromisso marcado nele.
 */
export function pontasDaGrade(grade: readonly DiaCalendario[]): { de: string; ate: string } {
  return { de: grade[0]!.data, ate: grade[grade.length - 1]!.data }
}
