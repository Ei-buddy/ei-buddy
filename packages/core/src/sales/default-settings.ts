import type { CardFeeTable, DiscountPolicy, TaxRules } from '@na-regua/domain'
import type { CompanySettingsRepository, SaleSettings } from '../ports/sale-writers.js'

/**
 * Configuracao de venda enquanto as tabelas nao existem — RF-007, RF-008.
 *
 * A porta `CompanySettingsRepository` ja registra que aliquota, tabela de
 * tarifas e teto de desconto por papel **nao tem tabela**, e que "quem
 * implementa hoje devolve a configuracao que tiver". Isto e essa configuracao.
 *
 * Vive em `core` e nao na raiz de composicao da `api` por um motivo pratico: o
 * worker e o agente fecham venda pelos mesmos casos de uso, e um padrao por
 * aplicacao seria a mesma venda calculando tarifa diferente conforme o canal —
 * exatamente o que a arquitetura existe para impedir.
 *
 * **Os numeros sao provisorios e conservadores de proposito.** Quando as
 * tabelas existirem, o adapter de `db` substitui isto e este arquivo sai. Ate
 * la, e melhor um valor documentado num lugar so do que um valor chutado
 * espalhado por tres.
 */

/** Simples Nacional, faixa inicial de comercio. */
const ALIQUOTA_PADRAO: TaxRules = { regime: 'simples_nacional', defaultRate: 6 }

/**
 * Tarifas de cartao — RF-007.
 *
 * Valores de mercado para credenciamento pequeno, arredondados para cima: se a
 * tarifa real for menor, o liquido previsto chega maior que o esperado, que e o
 * erro que ninguem reclama. Ao contrario, o lojista faria conta com dinheiro
 * que nao vai receber.
 */
const TARIFAS_PADRAO: CardFeeTable = {
  /* De 1x a 12x, que e o que o PDV oferece. Sem a linha de um numero de
     parcelas, o dominio recusa a venda (`CARD_FEE_NOT_FOUND`) — e o balcao
     so descobria no 2x. Ponto e meio a mais por parcela alem da 3x, o mesmo
     degrau da 1x para a 3x. */
  rates: [
    { brand: 'unknown', installments: 1, feeRatePercent: 3 },
    { brand: 'unknown', installments: 2, feeRatePercent: 5 },
    ...Array.from({ length: 10 }, (_, i) => ({
      brand: 'unknown' as const,
      installments: i + 3,
      feeRatePercent: 6 + i * 1.5,
    })),
  ],
  settlementDays: 30,
}

/**
 * Teto de desconto por papel — RF-008, RF-031.
 *
 * `owner` sem teto: a loja e dele. `staff` em 10%, que cobre o "arredonda pra
 * mim" do balcao sem cobrir uma venda dada de presente. `accountant` nem chega
 * aqui — `assertCanWrite` recusa antes.
 */
const TETO_POR_PAPEL: Readonly<Record<string, number>> = {
  owner: 100,
  platform_admin: 100,
  staff: 10,
}

const TETO_CONSERVADOR = 0

export function createDefaultSaleSettings(): CompanySettingsRepository {
  return {
    forSale: async (_companyId, role): Promise<SaleSettings> => ({
      taxRules: ALIQUOTA_PADRAO,
      cardFees: TARIFAS_PADRAO,
      /* Papel desconhecido cai em zero, e nao no teto do `owner`: um papel novo
         que ninguem mapeou aqui nao pode nascer podendo dar desconto. */
      discountPolicy: {
        maxDiscountRate: TETO_POR_PAPEL[role] ?? TETO_CONSERVADOR,
      } satisfies DiscountPolicy,
    }),
  }
}
