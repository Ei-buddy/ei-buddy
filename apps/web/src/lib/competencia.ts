/**
 * Mes e ano para gerar as contas a pagar dos custos fixos — achado do QA:
 * "perguntar para qual mes e ano, trazer os campos preenchidos com os meses e
 * o ano a partir desse, como se fosse um seletor".
 *
 * O seletor comeca no mes atual e vai para a frente: gerar num mes ja fechado
 * joga lancamento no passado e desarruma o DRE daquele mes (NR-110).
 */

export const NOMES_DOS_MESES = [
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
] as const

/** Quantos anos o seletor oferece, contando o atual. */
export const ANOS_NO_SELETOR = 3

/** `2026-11-07` ou `2026-11` → `{ ano: 2026, mes: 11 }`. */
export function anoEMes(data: string): { ano: number; mes: number } {
  const [ano, mes] = data.split('-').map(Number) as [number, number]
  return { ano, mes }
}

/** Os anos do seletor: o atual e os seguintes. */
export function anosDoSeletor(hoje: string): number[] {
  const { ano } = anoEMes(hoje)
  return Array.from({ length: ANOS_NO_SELETOR }, (_, i) => ano + i)
}

/** O primeiro mes que pode ser escolhido naquele ano: o atual, ou janeiro. */
export function primeiroMesDoAno(hoje: string, ano: number): number {
  const atual = anoEMes(hoje)
  return ano === atual.ano ? atual.mes : 1
}

/** `{ 2026, 3 }` → `2026-03`, o formato que a api espera. */
export const competencia = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, '0')}`

/** `2026-03` → `março de 2026`. */
export function competenciaPorExtenso(c: string): string {
  const { ano, mes } = anoEMes(c)
  return `${NOMES_DOS_MESES[mes - 1]!.toLowerCase()} de ${ano}`
}

/**
 * O vencimento do custo fixo naquele mes — a MESMA regra do servidor: o dia
 * ajustado ao ultimo dia do mes, nunca migrando para o seguinte (dia 31 em
 * fevereiro vence dia 28 ou 29). Serve para a previa antes de gerar.
 */
export function vencimentoNoMes(dia: number, c: string): string {
  const { ano, mes } = anoEMes(c)
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  return `${competencia(ano, mes)}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`
}
