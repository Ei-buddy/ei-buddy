import { DomainError } from './domain-error.js'

/**
 * Vencimento e recorrencia — RF-056, RF-057, RF-061.
 *
 * Tudo aqui opera sobre **data de calendario** no formato `AAAA-MM-DD`, texto,
 * e nunca sobre `Date`. Nao e preciosismo: `due_date` e `date` no banco, e
 * conta a pagar vence num DIA, nao num instante. Passar por `Date` traria o
 * fuso junto — e `new Date('2026-03-31')` e meia-noite UTC, que no horario de
 * Brasilia e dia 30 as 21h. A conta venceria um dia antes para o lojista.
 */

export type Frequencia = 'weekly' | 'monthly'

/** Vencidas, hoje, esta semana, este mes, depois — RF-061. */
export type FaixaDeVencimento = 'overdue' | 'today' | 'week' | 'month' | 'later'

const FORMATO = /^\d{4}-\d{2}-\d{2}$/

type Civil = { readonly ano: number; readonly mes: number; readonly dia: number }

function decompor(data: string): Civil {
  if (!FORMATO.test(data)) {
    throw new DomainError('INVALID_DATE', `Data invalida: "${data}". Use AAAA-MM-DD.`)
  }
  const [ano, mes, dia] = data.split('-').map(Number) as [number, number, number]
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasNoMes(ano, mes)) {
    throw new DomainError('INVALID_DATE', `Data invalida: "${data}".`)
  }
  return { ano, mes, dia }
}

const compor = ({ ano, mes, dia }: Civil): string =>
  `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`

/** Fevereiro de ano bissexto incluido — a regra dos 400 anos vale ate 2400. */
export function diasNoMes(ano: number, mes: number): number {
  if (mes === 2) {
    const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0
    return bissexto ? 29 : 28
  }
  return [4, 6, 9, 11].includes(mes) ? 30 : 31
}

/** Dias entre duas datas de calendario. Negativo quando `ate` ja passou. */
export function diasEntre(de: string, ate: string): number {
  const a = decompor(de)
  const b = decompor(ate)
  const MS = 86_400_000
  const ua = Date.UTC(a.ano, a.mes - 1, a.dia)
  const ub = Date.UTC(b.ano, b.mes - 1, b.dia)
  return Math.round((ub - ua) / MS)
}

/**
 * Onde a conta cai em relacao a hoje — RF-056, RF-061, RF-062.
 *
 * `overdue` e estritamente ANTES de hoje: conta que vence hoje ainda nao esta
 * vencida, e marca-la como vencida faria o lojista abrir o sistema de manha
 * vendo em vermelho algo que ele tem o dia inteiro para pagar.
 *
 * As faixas nao se sobrepoem, e a ordem da checagem e a definicao: `today` sai
 * antes de `week`, e `week` antes de `month`.
 */
export function faixaDeVencimento(vencimento: string, hoje: string): FaixaDeVencimento {
  const dias = diasEntre(hoje, vencimento)
  if (dias < 0) return 'overdue'
  if (dias === 0) return 'today'
  /* Sete dias corridos a partir de amanha, e nao "ate domingo": a pergunta do
     lojista e "o que vence nos proximos dias", nao "o que cai nesta semana do
     calendario" — e na sexta-feira a segunda resposta esconderia a segunda. */
  if (dias <= 7) return 'week'
  if (dias <= 30) return 'month'
  return 'later'
}

/** Conta vencida — RF-056. Acucar sobre `faixaDeVencimento`, para ler melhor. */
export const estaVencida = (vencimento: string, hoje: string): boolean =>
  faixaDeVencimento(vencimento, hoje) === 'overdue'

/**
 * As proximas ocorrencias de uma conta recorrente — RF-057.
 *
 * **O dia do vencimento e preservado, e e aqui que a implementacao ingenua
 * erra.** Uma conta que vence dia 31 nao existe em fevereiro. Duas saidas:
 *
 * 1. Encaixar no ultimo dia do mes (31/jan → 28/fev) e seguir A PARTIR DALI —
 *    e a que quase toda implementacao faz, somando um mes a cada passo. O
 *    resultado e 31/jan, 28/fev, 28/mar, 28/abr: a conta **migra** para o dia
 *    28 e nunca mais volta.
 * 2. Encaixar so na ocorrencia que precisa, derivando SEMPRE do dia original —
 *    31/jan, 28/fev, 31/mar, 30/abr.
 *
 * A segunda e o que "mantendo o dia de vencimento" quer dizer, e por isso o
 * calculo parte de `diaOriginal` a cada passo em vez de encadear.
 */
export function ocorrenciasDaRecorrencia(
  primeiroVencimento: string,
  frequencia: Frequencia,
  quantidade: number,
): readonly string[] {
  if (!Number.isInteger(quantidade) || quantidade < 1) {
    throw new DomainError('INVALID_RECURRENCE', 'A recorrencia precisa de ao menos uma ocorrencia.')
  }
  if (quantidade > 120) {
    /* Dez anos de conta mensal. Acima disso quase sempre e engano de digitacao,
       e gerar mil linhas por engano e mais caro de desfazer que de recusar. */
    throw new DomainError('INVALID_RECURRENCE', 'A recorrencia nao pode passar de 120 ocorrencias.')
  }

  const inicio = decompor(primeiroVencimento)
  const ocorrencias: string[] = [primeiroVencimento]

  for (let i = 1; i < quantidade; i += 1) {
    ocorrencias.push(
      frequencia === 'weekly'
        ? somarDias(primeiroVencimento, i * 7)
        : mesmoDiaEmMesesAdiante(inicio, i),
    )
  }

  return ocorrencias
}

/**
 * Dias somados a uma data de calendario, sem passar por fuso.
 *
 * Exportada porque a assinatura tambem conta prazo em dia corrido — fim do
 * teste e fim da tolerancia (NR-063). Reimplementar isso la reintroduziria o
 * `new Date('2026-03-31')` que este modulo inteiro existe para evitar.
 */
export function somarDias(data: string, dias: number): string {
  const { ano, mes, dia } = decompor(data)
  const d = new Date(Date.UTC(ano, mes - 1, dia + dias))
  return compor({ ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() })
}

/** Sempre a partir do dia ORIGINAL — e o que impede a migracao de dia. */
function mesmoDiaEmMesesAdiante(inicio: Civil, meses: number): string {
  const total = inicio.mes - 1 + meses
  const ano = inicio.ano + Math.floor(total / 12)
  const mes = (total % 12) + 1
  return compor({ ano, mes, dia: Math.min(inicio.dia, diasNoMes(ano, mes)) })
}
