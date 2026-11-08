/**
 * Aritmetica de periodo — NR-077, US-041.
 *
 * Arquivo proprio, sem nenhum import: e o que permite testa-lo. Os modulos de
 * `lib` que falam com a api carregam `react-native` na cadeia, e o vitest nao
 * analisa a sintaxe Flow que vem junto — uma conta de data escondida la dentro
 * seria uma conta sem teste.
 *
 * E ela precisa de teste. Recuar um mes a partir do dia 31 cai no mes errado, e
 * converter para ISO em fuso negativo recua um dia; as duas coisas ja custaram
 * correcao neste projeto.
 */

/**
 * Os ultimos `meses` meses, terminando no fim do mes de `agora`, em AAAA-MM-DD.
 *
 * Campos LOCAIS, nunca `toISOString`: no fuso do Brasil o dia 1 as 00h ainda e
 * o dia 30 em UTC, e o periodo comecaria no mes anterior.
 *
 * Recua a partir do dia 1, e nao do dia de hoje: em 31 de marco, `setMonth` com
 * o dia 31 daria 3 de marco, porque fevereiro nao tem 31. O dia 1 existe em
 * todo mes.
 */
export function ultimosMeses(meses: number, agora: Date = new Date()): { de: string; ate: string } {
  const dois = (n: number) => String(n).padStart(2, '0')

  const ano = agora.getFullYear()
  const mes = agora.getMonth()

  const inicio = new Date(ano, mes, 1)
  inicio.setMonth(inicio.getMonth() - (meses - 1))

  /* Dia 0 do mes seguinte e o ultimo deste — inclusive em fevereiro bissexto. */
  const ultimo = new Date(ano, mes + 1, 0).getDate()

  return {
    de: `${inicio.getFullYear()}-${dois(inicio.getMonth() + 1)}-01`,
    ate: `${ano}-${dois(mes + 1)}-${dois(ultimo)}`,
  }
}

/**
 * O dia de hoje em AAAA-MM-DD, pelos campos LOCAIS.
 *
 * Nunca `toISOString()`: no fuso do Brasil, o dia 1 as 00h ainda e o dia 30 em
 * UTC, e "vendido hoje" mostraria o movimento de ontem ate as 21h.
 */
export function hojeLocal(agora: Date = new Date()): string {
  const dois = (n: number) => String(n).padStart(2, '0')
  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}`
}

const DIAS = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
] as const

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const

/**
 * "Bom dia" so quando for de manha.
 *
 * A tela dizia "Bom dia" as onze da noite. E um detalhe pequeno e e exatamente
 * o tipo de coisa que faz o app parecer um molde: quem abre o caixa as 20h
 * percebe na hora que ninguem pensou nele.
 */
export function saudacaoDaHora(agora: Date = new Date()): string {
  const h = agora.getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

/** "Segunda-feira, 24 de agosto" — do relogio, e nao do codigo. */
export function dataPorExtenso(agora: Date = new Date()): string {
  return `${DIAS[agora.getDay()]}, ${agora.getDate()} de ${MESES[agora.getMonth()]}`
}

/**
 * So o primeiro nome no cabecalho.
 *
 * "Bom dia, Maria" cabe e soa como alguem falando; "Bom dia, Maria Aparecida da
 * Silva Santos" quebra em duas linhas e soa como cadastro.
 */
export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome
}

/**
 * O primeiro dia dos ultimos `dias` dias, contando hoje — NR-210. `1` e so
 * hoje; `7` e hoje e os seis anteriores. Campos LOCAIS, pelo mesmo motivo.
 */
export function inicioDosUltimosDias(dias: number, agora: Date = new Date()): string {
  return hojeLocal(new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - (dias - 1)))
}
