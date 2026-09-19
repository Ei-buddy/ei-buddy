import type { Coupon } from '@na-regua/contracts'

/**
 * Cupons de parceiro — RF-114, RF-115, DEC-012.
 *
 * **Sem `companyId` em lugar nenhum, e sem RLS.** `coupons` e `partners` sao
 * tabelas da PLATAFORMA, como o schema registra: o cupom existe antes de a
 * loja existir — e digitado no cadastro, por alguem que ainda nao tem empresa.
 * Um `companyId` aqui seria um parametro que nunca teria valor no unico
 * momento em que a consulta acontece.
 */
export type CouponRepository = {
  /**
   * Pelo codigo que o lojista digitou.
   *
   * `undefined` para o que nao existe E para o que foi apagado: sao a mesma
   * coisa do ponto de vista de quem digitou, e distinguir os dois na resposta
   * contaria que aquele codigo ja existiu um dia.
   *
   * Revogado e vencido, ao contrario, VOLTAM — quem digitou um codigo real
   * precisa saber que ele venceu, para nao ficar conferindo se errou a
   * digitacao (RF-115). Quem decide o que fazer com eles e o caso de uso.
   */
  findByCode(code: string): Promise<Coupon | undefined>
}
