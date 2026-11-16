import type {
  BrandFeeOverride,
  PaymentFeeSettingsInput,
  PaymentFeeSettingsOutput,
} from '@na-regua/contracts'
import { chamarApi } from './api'
import type { FormaPagamento } from './types'

/**
 * Taxas de recebimento da loja — DEC-027 (NR-224), as mesmas regras do web.
 *
 * Antes o PDV tinha a SUA tabela fixa (Pix 0,99%, debito 1,99%, credito
 * 3,49%), diferente da do servidor: o operador via um liquido na tela e
 * ficava gravado outro. Agora a tela le a mesma tabela que o servidor usa —
 * a que a loja configurou, ou a padrao.
 *
 * O app so importa TIPOS de `contracts`; por isso a tabela padrao e as regras
 * do formulario moram aqui, e o teste confere as duas contra o contrato.
 */

export type TabelaDeTaxas = PaymentFeeSettingsOutput
export type TaxasParaGravar = PaymentFeeSettingsInput
export type ExcecaoDeBandeira = BrandFeeOverride

/** Quantas parcelas a tabela pode ter — a mesma do contrato. */
export const PARCELAS_DA_TABELA = 12

/**
 * A tabela de quem nunca configurou — copia da `TAXAS_PADRAO` de `core`.
 * Credito: 3% a vista, 5% em 2x e +1,5 ponto por parcela a partir da 3x.
 */
export const TAXAS_PADRAO: TabelaDeTaxas = {
  pixFeePercent: 0,
  debitFeePercent: 3,
  creditFeePercents: [3, 5, ...Array.from({ length: 10 }, (_, i) => 6 + i * 1.5)],
  brandOverrides: [],
  debitSettlementDays: 30,
  creditSettlementDays: 30,
  anticipation: { enabled: false, monthlyRatePercent: null },
  isDefault: true,
  updatedAt: null,
}

export const BANDEIRAS: { valor: ExcecaoDeBandeira['brand']; rotulo: string }[] = [
  { valor: 'visa', rotulo: 'Visa' },
  { valor: 'mastercard', rotulo: 'Mastercard' },
  { valor: 'elo', rotulo: 'Elo' },
  { valor: 'amex', rotulo: 'Amex' },
  { valor: 'hipercard', rotulo: 'Hipercard' },
]

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string }

export async function lerTaxasDeRecebimento(): Promise<Resultado<TabelaDeTaxas>> {
  const r = await chamarApi<TabelaDeTaxas>('/taxas-de-recebimento')
  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

export async function salvarTaxasDeRecebimento(
  taxas: TaxasParaGravar,
): Promise<Resultado<TabelaDeTaxas>> {
  const r = await chamarApi<TabelaDeTaxas>('/taxas-de-recebimento', { method: 'PUT', body: taxas })
  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

/** Quem altera e o responsavel — a mesma regra do servidor (403 para os outros). */
export async function souResponsavel(): Promise<boolean> {
  const r = await chamarApi<{ role: string | null }>('/auth/perfil')
  return r.ok && r.dados.role === 'owner'
}

/**
 * A taxa geral (sem bandeira) de uma forma, em %.
 *
 * O PDV nao pergunta a bandeira: o servidor tambem usa a geral quando ela nao
 * vem. `null` = parcela que a loja nao configurou — o PDV nem a oferece, e o
 * servidor recusaria.
 */
export function taxaDaForma(
  tabela: TabelaDeTaxas,
  forma: FormaPagamento,
  parcelas = 1,
): number | null {
  switch (forma) {
    case 'pix':
      return tabela.pixFeePercent
    case 'debito':
      return tabela.debitFeePercent
    case 'credito':
      return tabela.creditFeePercents[Math.max(1, parcelas) - 1] ?? null
    default:
      return 0
  }
}

/** Ate quantas vezes o PDV parcela: as parcelas que a loja configurou. */
export const parcelasOferecidas = (tabela: TabelaDeTaxas): number =>
  Math.max(1, tabela.creditFeePercents.length)

/** "2,99%" — e "sem taxa" para zero. */
export function rotuloDaTaxa(percentual: number | null): string {
  if (percentual === null) return 'sem taxa configurada'
  if (percentual === 0) return 'sem taxa'
  return `taxa ${percentual.toFixed(2).replace('.', ',')}%`
}

/* -------------------------------------------------------------------------- */
/* Formulario                                                                 */
/* -------------------------------------------------------------------------- */

/** O formulario em texto, como a pessoa digita ("2,99"). */
export type FormularioDeTaxas = {
  pix: string
  debito: string
  /** Posicao 0 = a vista. Vazias no fim sao parcelas que a loja nao oferece. */
  credito: string[]
  diasDebito: string
  diasCredito: string
  excecoes: {
    bandeira: ExcecaoDeBandeira['brand']
    forma: 'debit' | 'credit'
    parcelas: number
    taxa: string
  }[]
  antecipacao: boolean
  taxaAntecipacao: string
}

const texto = (n: number) => String(n).replace('.', ',')

export function formularioDe(t: TabelaDeTaxas): FormularioDeTaxas {
  return {
    pix: texto(t.pixFeePercent),
    debito: texto(t.debitFeePercent),
    credito: Array.from({ length: PARCELAS_DA_TABELA }, (_, i) => {
      const v = t.creditFeePercents[i]
      return v === undefined ? '' : texto(v)
    }),
    diasDebito: String(t.debitSettlementDays),
    diasCredito: String(t.creditSettlementDays),
    excecoes: t.brandOverrides
      .filter((o): o is ExcecaoDeBandeira => o.brand !== 'unknown')
      .map((o) => ({
        bandeira: o.brand,
        forma: o.method,
        parcelas: o.installments,
        taxa: texto(o.feePercent),
      })),
    antecipacao: t.anticipation.enabled,
    taxaAntecipacao:
      t.anticipation.monthlyRatePercent === null ? '' : texto(t.anticipation.monthlyRatePercent),
  }
}

/** "2,99" → 2.99. `null` se nao for uma taxa valida (0 a 30%, ate 2 casas). */
export function percentualDoTexto(valor: string): number | null {
  const limpo = valor.trim().replace('%', '').replace(/\s/g, '').replace(',', '.')
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(limpo)) return null
  const n = Number(limpo)
  return n >= 0 && n <= 30 ? n : null
}

function diasDoTexto(valor: string): number | null {
  const limpo = valor.trim()
  if (!/^\d{1,2}$/.test(limpo)) return null
  const n = Number(limpo)
  return n <= 60 ? n : null
}

const rotuloDaParcela = (n: number) => (n === 1 ? 'crédito à vista' : `crédito em ${n}x`)

/**
 * Valida o formulario com as MESMAS regras do contrato e monta o que vai
 * para a api. A mensagem diz qual campo — "taxa invalida" sem dizer onde,
 * numa tela com 20 campos, nao ajuda ninguem.
 */
export function taxasDoFormulario(
  f: FormularioDeTaxas,
): { ok: true; dados: TaxasParaGravar } | { ok: false; erro: string } {
  const pix = percentualDoTexto(f.pix)
  if (pix === null) return { ok: false, erro: 'Taxa do Pix: de 0 a 30%, com até duas casas.' }
  const debito = percentualDoTexto(f.debito)
  if (debito === null) return { ok: false, erro: 'Taxa do débito: de 0 a 30%, com até duas casas.' }

  /* Corta as vazias do fim: a loja que so parcela em ate 6x deixa o resto em
     branco. Vazia NO MEIO e erro — 3x sem taxa e 4x com taxa nao existe. */
  let ultima = f.credito.length
  while (ultima > 0 && f.credito[ultima - 1]!.trim() === '') ultima--
  if (ultima === 0) return { ok: false, erro: 'Informe pelo menos a taxa do crédito à vista.' }
  const credito: number[] = []
  for (let i = 0; i < ultima; i++) {
    const v = percentualDoTexto(f.credito[i]!)
    if (v === null) {
      return {
        ok: false,
        erro:
          f.credito[i]!.trim() === ''
            ? `Preencha a taxa do ${rotuloDaParcela(i + 1)} ou apague as parcelas depois dela.`
            : `Taxa do ${rotuloDaParcela(i + 1)}: de 0 a 30%, com até duas casas.`,
      }
    }
    credito.push(v)
  }

  const diasDebito = diasDoTexto(f.diasDebito)
  const diasCredito = diasDoTexto(f.diasCredito)
  if (diasDebito === null || diasCredito === null) {
    return { ok: false, erro: 'Prazo de repasse: dias inteiros, de 0 a 60.' }
  }

  const vistas = new Set<string>()
  const excecoes: ExcecaoDeBandeira[] = []
  for (const e of f.excecoes) {
    const parcelas = e.forma === 'debit' ? 1 : e.parcelas
    const nome = BANDEIRAS.find((b) => b.valor === e.bandeira)?.rotulo ?? e.bandeira
    const onde =
      e.forma === 'debit' ? `${nome} no débito` : `${nome} no ${rotuloDaParcela(parcelas)}`
    const taxa = percentualDoTexto(e.taxa)
    if (taxa === null)
      return { ok: false, erro: `Taxa de ${onde}: de 0 a 30%, com até duas casas.` }
    const chave = `${e.bandeira}:${e.forma}:${parcelas}`
    if (vistas.has(chave)) return { ok: false, erro: `${onde} aparece duas vezes.` }
    vistas.add(chave)
    excecoes.push({ brand: e.bandeira, method: e.forma, installments: parcelas, feePercent: taxa })
  }

  let taxaAntecipacao: number | null = null
  if (f.taxaAntecipacao.trim() !== '') {
    taxaAntecipacao = percentualDoTexto(f.taxaAntecipacao)
    if (taxaAntecipacao === null) {
      return { ok: false, erro: 'Taxa da antecipação: de 0 a 30% ao mês, com até duas casas.' }
    }
  }

  return {
    ok: true,
    dados: {
      pixFeePercent: pix,
      debitFeePercent: debito,
      creditFeePercents: credito,
      brandOverrides: excecoes,
      debitSettlementDays: diasDebito,
      creditSettlementDays: diasCredito,
      anticipation: { enabled: f.antecipacao, monthlyRatePercent: taxaAntecipacao },
    },
  }
}
