import { useEffect, useState } from 'react'
import { lerTaxasDeRecebimento, TAXAS_PADRAO, type TabelaDeTaxas } from './taxas-api'

/**
 * A tabela de taxas da loja, para a PREVISAO do PDV — DEC-027 (NR-224).
 *
 * Comeca na padrao e troca pela da loja quando a leitura volta. Sem sinal,
 * fica na padrao: e so a previsao — o valor gravado e o que o servidor
 * calcula, com a tabela certa, de qualquer jeito.
 */
export function useTaxasDaLoja(): TabelaDeTaxas {
  const [tabela, setTabela] = useState<TabelaDeTaxas>(TAXAS_PADRAO)
  useEffect(() => {
    let vivo = true
    void (async () => {
      const r = await lerTaxasDeRecebimento()
      if (vivo && r.ok) setTabela(r.dados)
    })()
    return () => {
      vivo = false
    }
  }, [])
  return tabela
}
