'use client'

import { useEffect } from 'react'
import { limparSaida } from '@/lib/saida-de-pagina'

/**
 * O fim da saida — NR-133.
 *
 * Mora dentro do `template.tsx`, que o App Router remonta a cada navegacao:
 * montou, a tela nova chegou, e o conteudo volta a aparecer. Ver
 * `lib/saida-de-pagina.ts`.
 */
export default function FimDaSaida() {
  useEffect(() => {
    limparSaida()
  })

  return null
}
