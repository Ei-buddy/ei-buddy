import type { Coupon, CouponApplication } from '@na-regua/contracts'
import { Money } from '@na-regua/money'

/**
 * Avaliacao de cupom — RF-114, RF-115.
 *
 * Pura, como `estado.ts`: entra cupom e preco, sai o resultado. O acesso ao
 * banco fica no caso de uso; aqui nao ha como a regra depender de ordem de
 * consulta.
 *
 * ## A ordem das recusas importa
 *
 * Um cupom pode estar revogado E vencido E esgotado ao mesmo tempo, e a
 * mensagem tem de escolher uma. A ordem e da mais definitiva para a mais
 * circunstancial:
 *
 * 1. **revogado** — alguem matou o codigo de proposito; nenhuma outra
 *    informacao muda isso, e mandar a pessoa "tentar mais cedo" seria mentira;
 * 2. **vencido** — passou do prazo de calendario;
 * 3. **esgotado** — existia, valia, e alguem chegou antes.
 *
 * Invertida, um cupom revogado no mes passado diria "esgotado", e o lojista
 * ligaria para o parceiro perguntando por mais cotas de um codigo morto.
 */
export function avaliarCupom(cupom: Coupon, precoCents: number, agora: Date): CouponApplication {
  if (cupom.revokedAt !== null) {
    return recusa('revoked', 'Este cupom não está mais válido.')
  }

  if (cupom.expiresAt !== null && new Date(cupom.expiresAt) <= agora) {
    return recusa('expired', 'Este cupom venceu.')
  }

  if (cupom.maxRedemptions !== null && cupom.redeemedCount >= cupom.maxRedemptions) {
    return recusa('exhausted', 'Este cupom já atingiu o limite de usos.')
  }

  const desconto = descontoEmCentavos(cupom, precoCents)

  return {
    status: 'applied',
    couponId: cupom.id,
    code: cupom.code,
    discountCents: desconto,
    finalCents: precoCents - desconto,
    cycles: cupom.discountCycles,
  }
}

const recusa = (
  code: 'not_found' | 'revoked' | 'expired' | 'exhausted',
  message: string,
): CouponApplication => ({ status: 'rejected', rejection: { code, message } })

/**
 * O desconto em centavo, nunca maior que o proprio preco.
 *
 * Cupom de valor fixo acima da mensalidade nao e erro — e um cupom generoso, e
 * recusa-lo seria o parceiro descobrindo pelo lojista que a promocao dele nao
 * funciona. O teto no preco transforma isso em ciclo gratuito, que e o que a
 * promocao queria dizer.
 *
 * (Aqui esta a diferenca para `applyDiscount`, de `domain`, que RECUSA
 * desconto maior que a base. La a base e uma venda, e desconto maior que ela
 * seria a loja pagando para vender; aqui o piso e zero e ninguem paga nada.)
 *
 * O percentual passa por `Money.percentage`, e nao por `preco * taxa / 100`:
 * aritmetica de ponto flutuante em dinheiro e como 10% de R$ 89,90 vira
 * R$ 8,989999999.
 */
function descontoEmCentavos(cupom: Coupon, precoCents: number): number {
  const preco = Money.fromCents(precoCents)

  const bruto =
    cupom.kind === 'percent'
      ? Number(preco.percentage(cupom.percent ?? 0).cents)
      : (cupom.amountCents ?? 0)

  return Math.min(bruto, precoCents)
}
