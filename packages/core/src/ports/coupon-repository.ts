import type { CouponLookup } from '@na-regua/contracts'

/**
 * Cupons — RF-114, RF-115, ADR-0013.
 *
 * **Sem `companyId` em lugar nenhum.** Quem digita o cupom esta no CADASTRO e
 * ainda nao tem empresa; um `companyId` aqui seria um parametro que nunca teria
 * valor no unico momento em que a consulta acontece.
 *
 * ## Uma consulta so, e de proposito
 *
 * A tabela `coupons` tem RLS forcada **sem politica permissiva** (migration
 * 0014): nao ha SELECT possivel nela pelo papel da aplicacao. O unico caminho
 * e a funcao `coupon_lookup`, que devolve o minimo — e essa porta existe para
 * refletir isso, e nao para esconder.
 *
 * Por isso nao ha `findByCode` devolvendo a linha: modelar a linha aqui seria
 * descrever algo que ninguem consegue ler, e convidaria a proxima pessoa a
 * tentar.
 */
export type CouponRepository = {
  /**
   * Consulta publica por codigo.
   *
   * `undefined` para o que nao existe E para o que foi apagado: sao a mesma
   * coisa do ponto de vista de quem digitou, e distinguir contaria que aquele
   * codigo ja existiu um dia.
   *
   * O que existe mas nao vale VOLTA, com `active: false` e o motivo — quem
   * digitou um codigo real precisa saber por que ele nao serve (RF-115).
   */
  lookup(code: string): Promise<CouponLookup | undefined>
}
