import { z } from 'zod'

/**
 * Tipos comuns a varios schemas.
 *
 * Toda mensagem em PT-BR e dizendo o que fazer, nao so o que houve — ela vai
 * direto para a tela ([RNF-054]).
 */

/**
 * Dinheiro em centavos, sempre inteiro ([RNF-044]).
 *
 * Nao aceita decimal de proposito: `19.90` em ponto flutuante ja chega errado,
 * e arredondar depois so espalha o erro. A tela converte antes de enviar.
 */
export const moneyCentsSchema = z
  .number({ error: 'Informe um valor em centavos, sem virgula.' })
  .int('Valor monetario precisa ser inteiro em centavos.')
  .nonnegative('Valor nao pode ser negativo.')

/** Aceita negativo — desconto e estorno existem. */
export const signedMoneyCentsSchema = z
  .number({ error: 'Informe um valor em centavos, sem virgula.' })
  .int('Valor monetario precisa ser inteiro em centavos.')

/** Identificador opaco. Formato e problema do `db`, nao do contrato. */
export const idSchema = z.string().min(1, 'Identificador obrigatorio.')

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Nome muito curto.')
  .max(120, 'Nome muito longo.')

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('E-mail invalido. Confira o endereco.')

/**
 * Telefone brasileiro: DDD + 8 ou 9 digitos.
 *
 * Guarda so digitos. Fixo tem 8, celular tem 9 — os dois existem no balcao.
 */
export const phoneSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((d) => d.length === 10 || d.length === 11, {
    message: 'Telefone invalido. Use DDD e numero.',
  })

/**
 * Codigo de barras EAN/GTIN — 8, 12, 13 ou 14 digitos.
 *
 * Leitor de balcao devolve codigo interno de loja que nao segue GTIN, e
 * recusa-lo travaria o cadastro de quem etiqueta a granel. Esses codigos usam
 * os prefixos que a GS1 reserva para circulacao restrita — e so neles o
 * digito verificador fica sem conferencia. Fora deles, digito errado e
 * digitacao errada, e a SEFAZ recusaria o GTIN na nota (achado do QA).
 */
export const barcodeSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((d) => [8, 12, 13, 14].includes(d.length), {
    message: 'Codigo de barras invalido. Deve ter 8, 12, 13 ou 14 digitos.',
  })
  .refine((d) => circulacaoRestrita(d) || digitoGtinConfere(d), {
    message: 'Codigo de barras invalido: o ultimo digito nao confere. Confira a digitacao.',
  })

/** Prefixos GS1 de uso interno da loja (balanca, etiqueta propria). */
function circulacaoRestrita(d: string): boolean {
  if (d.length === 13) return d.startsWith('2')
  if (d.length === 12) return d.startsWith('2') || d.startsWith('4')
  if (d.length === 8) return d.startsWith('0') || d.startsWith('2')
  return false
}

/** Modulo 10 da GS1: pesos 3 e 1 alternados, da direita para a esquerda. */
function digitoGtinConfere(d: string): boolean {
  const corpo = d.slice(0, -1)
  let soma = 0
  for (let i = 0; i < corpo.length; i++) {
    const peso = (corpo.length - i) % 2 === 1 ? 3 : 1
    soma += Number(corpo[i]) * peso
  }
  return (10 - (soma % 10)) % 10 === Number(d[d.length - 1])
}

/** Unidade de medida — glossario `UnitOfMeasure`. */
export const unitOfMeasureSchema = z.enum(['un', 'kg', 'g', 'l', 'ml', 'm', 'cm', 'cx', 'pct'], {
  error: 'Unidade de medida invalida.',
})
export type UnitOfMeasure = z.infer<typeof unitOfMeasureSchema>

/** Papel de acesso — glossario `Role`. */
export const roleSchema = z.enum(['owner', 'staff', 'accountant', 'platform_admin'], {
  error: 'Papel de acesso invalido.',
})
export type Role = z.infer<typeof roleSchema>

/**
 * Aliquota em pontos percentuais (18 = 18%).
 *
 * Percentual e nao fracao porque e assim que o lojista fala e digita; a
 * conversao para fracao e do `domain`.
 */
export const rateSchema = z
  .number()
  .min(0, 'Aliquota nao pode ser negativa.')
  .max(100, 'Aliquota nao pode passar de 100%.')

const diasNoMes = (ano: number, mes: number): number => {
  if (mes === 2) {
    const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0
    return bissexto ? 29 : 28
  }
  return [4, 6, 9, 11].includes(mes) ? 30 : 31
}

/**
 * Data de calendario em ISO, so a parte de data.
 *
 * **O formato nao basta**, e um teste custou a descoberta: `2026-13-40` casa com
 * a expressao regular e nao existe. `new Date` sobre ela devolve `Invalid Date`,
 * e QUALQUER comparacao com `Invalid Date` e falsa — entao a agenda do dia
 * respondia 200 com lista vazia para uma data inexistente. Resposta errada com
 * cara de resposta certa, que e a pior forma de errar.
 *
 * A checagem de calendario vale para todo mundo que usa este schema: vencimento
 * de conta a pagar, data de lancamento no extrato, periodo do DRE.
 */
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data invalida. Use o formato AAAA-MM-DD.')
  .refine(
    (d) => {
      const [ano, mes, dia] = d.split('-').map(Number) as [number, number, number]
      return mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasNoMes(ano, mes)
    },
    { message: 'Data invalida. Esse dia nao existe no calendario.' },
  )

/**
 * Instante em ISO 8601 com fuso, sempre UTC no armazenamento.
 *
 * Exige o fuso explicito porque "2026-09-02T14:00" sem ele significa coisas
 * diferentes para cada cliente — e compromisso marcado uma hora errado e
 * exatamente o problema que a agenda deveria resolver. Ver ambientes.md: TZ e
 * de exibicao, armazenamento e sempre UTC.
 */
export const dateTimeSchema = z
  .string()
  .datetime({ offset: true, message: 'Data e hora invalidas. Use ISO 8601 com fuso.' })
