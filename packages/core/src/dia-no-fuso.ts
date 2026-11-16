/**
 * `AAAA-MM-DD` do instante, no fuso dado.
 *
 * `toISOString().slice(0, 10)` e o dia em UTC: as 22h em Brasilia ja e o dia
 * seguinte, e um orcamento valido ate hoje apareceria vencido a noite.
 */
export function diaNoFuso(instante: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante)
}
