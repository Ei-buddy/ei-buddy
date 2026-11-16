import type { CardFeeTable, DiscountPolicy, TaxRules } from '@na-regua/domain'
import type { CompanySettingsRepository, SaleSettings } from '../ports/sale-writers.js'
import { TAXAS_PADRAO, tabelaDeTarifas } from './fee-settings.js'

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
 * Desde a DEC-027 a loja configura as dela (`comTaxasDaLoja`); esta e a de
 * quem nunca configurou, e mora em `TAXAS_PADRAO` para haver uma fonte so.
 * Valores de mercado para credenciamento pequeno, arredondados para cima: se
 * a tarifa real for menor, o liquido previsto chega maior que o esperado, que
 * e o erro que ninguem reclama.
 */
const TARIFAS_PADRAO: CardFeeTable = tabelaDeTarifas(TAXAS_PADRAO)

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
