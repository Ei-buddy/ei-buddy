'use client'

import { useState } from 'react'
import { baixarExportacao, type Formato, type ListaExportavel } from '@/lib/exportar-api'
import { Button } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import { IconUpload } from '@/components/Icons'

/**
 * CSV e PDF de uma lista — NR-155. Os mesmos dois botoes de contas a pagar e a
 * receber, agora para qualquer lista: quem usa passa os filtros que a tela tem
 * aplicados, e o arquivo sai com eles.
 */
export default function BotoesExportar({
  lista,
  filtros = {},
}: {
  lista: ListaExportavel
  filtros?: Record<string, string | undefined>
}) {
  const [baixando, setBaixando] = useState<Formato | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function baixar(formato: Formato) {
    setBaixando(formato)
    const r = await baixarExportacao(lista, formato, filtros)
    setBaixando(null)
    if (!r.ok) setErro(r.erro)
  }

  return (
    <>
      {(['csv', 'pdf'] as const).map((f) => (
        <Button
          key={f}
          variant="secondary"
          disabled={baixando !== null}
          onClick={() => void baixar(f)}
        >
          <IconUpload size={16} />
          {baixando === f ? 'Gerando...' : f.toUpperCase()}
        </Button>
      ))}
      {erro !== null ? <Toast message={erro} tone="error" onClose={() => setErro(null)} /> : null}
    </>
  )
}
