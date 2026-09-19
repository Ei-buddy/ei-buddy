import type { CouponApplication, CouponLookup, CouponRejectionCode } from '@na-regua/contracts'
import { Money } from '@na-regua/money'
import type { CouponRepository } from '../ports/coupon-repository.js'

export type PreviewCouponDeps = {
  readonly coupons: CouponRepository
  /** Preco do plano, em centavo. Vem de quem sabe o catalogo. */
  readonly precoDoPlanoCents: number
}

/**
 * Mostra o desconto ANTES de confirmar — RF-114, RF-115.
 *
 * ## Quem decide se o cupom vale e o SQL
 *
 * `coupon_lookup` (migrations 0014 e 0024) devolve `active` e `reason` ja
 * calculados. Refazer essa conta aqui daria duas respostas para "este cupom
 * vale?", e elas divergiriam na primeira mudanca de regra. O trabalho deste
 * caso de uso e traduzir o motivo em frase e calcular o valor final.
 *
 * ## Nao resgata nada
 *
 * Previa que consome cota e o lojista digitando o codigo para ver o preco e
 * perdendo o cupom sem assinar. O resgate (`coupon_redemption_record`) so
 * acontece quando a assinatura e criada.
 *
 * A consequencia honesta e uma corrida: entre ver o preco e confirmar, alguem
 * pode levar a ultima cota. Quem cria a assinatura confere de novo — prometer
 * reserva aqui seria travar cota de quem so estava espiando o preco.
 *
 * ## Sem `ExecutionContext`
 *
 * Pelo mesmo motivo de `startTrial`: isto roda no cadastro, quando quem
 * digitou o codigo ainda nao tem empresa.
 */
export async function previewCoupon(
  deps: PreviewCouponDeps,
  entrada: { readonly code: string },
): Promise<CouponApplication> {
  /* Normalizado aqui, e nao na tela, para que web, mobile e assistente nao
     tenham tres ideias de que "parceiro10 " e. (A funcao SQL ja compara sem
     caixa; o `trim` e o que ela nao faz.) */
  const codigo = entrada.code.trim().toUpperCase()

  const cupom = await deps.coupons.lookup(codigo)

  if (cupom === undefined) {
    return recusa('not_found', 'Não encontramos este cupom.')
  }

  if (!cupom.active) {
    const motivo: CouponRejectionCode = cupom.reason === 'ok' ? 'not_found' : cupom.reason
    return recusa(motivo, MENSAGENS[motivo])
  }

  const desconto = descontoEmCentavos(cupom, deps.precoDoPlanoCents)

  return {
    status: 'applied',
    couponId: cupom.couponId,
    code: codigo,
    discountCents: desconto,
    finalCents: deps.precoDoPlanoCents - desconto,
    /* Um ciclo, pela ADR-0013 — e explicito porque a tela precisa dizer qual
       e, ou o lojista assina esperando desconto para sempre. */
    cycles: 1,
  }
}

const recusa = (code: CouponRejectionCode, message: string): CouponApplication => ({
  status: 'rejected',
  rejection: { code, message },
})

/**
 * As frases, num lugar so.
 *
 * Cada uma leva a uma acao diferente de quem le — e e por isso que a RF-115
 * pede o motivo exato em vez de "cupom invalido". `inactive` nao diz "invalido"
 * de proposito: o cupom de parceiro aguardando aprovacao pode vir a valer, e
 * mandar a pessoa embora seria perder uma indicacao que o parceiro ja fez.
 */
const MENSAGENS: Record<CouponRejectionCode, string> = {
  not_found: 'Não encontramos este cupom.',
  revoked: 'Este cupom não está mais válido.',
  inactive: 'Este cupom ainda não está liberado. Tente de novo em alguns dias.',
  expired: 'Este cupom venceu.',
  exhausted: 'Este cupom já atingiu o limite de usos.',
}

/**
 * O desconto em centavo, nunca maior que o proprio preco.
 *
 * O teto existe porque `discount_percent` e dado de banco: um cupom gravado
 * com 120% zeraria a mensalidade e seguiria para um valor NEGATIVO, que viraria
 * uma recorrencia que ninguem sabe o que faz. Com o teto, o pior caso e um
 * ciclo gratuito.
 *
 * `Money.percentage`, e nao `preco * taxa / 100`: 30% de R$ 89,90 vira
 * R$ 26,969999999 em ponto flutuante.
 */
function descontoEmCentavos(cupom: CouponLookup, precoCents: number): number {
  const bruto = Number(Money.fromCents(precoCents).percentage(cupom.discountPercent).cents)
  return Math.min(bruto, precoCents)
}
