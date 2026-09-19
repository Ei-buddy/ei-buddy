import type { CouponApplication } from '@na-regua/contracts'
import type { CouponRepository } from '../ports/coupon-repository.js'
import { avaliarCupom } from './cupom.js'

export type PreviewCouponDeps = {
  readonly coupons: CouponRepository
  /** Preco do plano, em centavo. Vem de quem sabe o catalogo. */
  readonly precoDoPlanoCents: number
}

/**
 * Mostra o desconto ANTES de confirmar — RF-114, RF-115.
 *
 * ## Nao resgata nada
 *
 * Isto e uma previa, e previa que consome cota e como o lojista digitar o
 * codigo para ver o preco e perder o cupom sem assinar. O `redeemed_count` so
 * sobe quando a assinatura e criada de fato.
 *
 * A consequencia honesta e uma corrida: entre ver "R$ 80,10" e confirmar,
 * outra pessoa pode levar a ultima cota. Quem cria a assinatura confere de
 * novo — a previa nao promete reserva, e prometer seria travar cota de quem so
 * estava espiando o preco.
 *
 * ## Sem `ExecutionContext`
 *
 * Pelo mesmo motivo de `startTrial` e de `submitWaitlistEntry`: isto roda no
 * cadastro, quando quem digitou o codigo ainda nao tem empresa — e cupom e
 * tabela de plataforma, sem `company_id`.
 *
 * `agora` entra por parametro, como `ctx.now` faria: a validade e uma data, e
 * um caso de uso que le o relogio por dentro nao e testavel sem congelar o do
 * processo.
 */
export async function previewCoupon(
  deps: PreviewCouponDeps,
  entrada: { readonly code: string; readonly agora: Date },
): Promise<CouponApplication> {
  /* O codigo chega como o lojista digitou. Normalizar caixa e espaco aqui, e
     nao na tela, para que web, mobile e assistente nao tenham tres ideias de
     que "parceiro10 " e. */
  const codigo = entrada.code.trim().toUpperCase()

  const cupom = await deps.coupons.findByCode(codigo)

  if (cupom === undefined) {
    /* Nao existe e foi apagado sao a mesma coisa para quem digitou. Distinguir
       contaria que aquele codigo ja existiu um dia. */
    return {
      status: 'rejected',
      rejection: { code: 'not_found', message: 'Não encontramos este cupom.' },
    }
  }

  return avaliarCupom(cupom, deps.precoDoPlanoCents, entrada.agora)
}
