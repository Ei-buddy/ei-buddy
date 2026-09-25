'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { IconArrowRight } from '@/components/Icons'
import { Card, EmptyState, PageHeader } from '@/components/ui/UI'
import { buscarCliente, type ClienteDaFicha } from '@/lib/clientes-api'
import ClienteForm from './ClienteForm'
import styles from './detalhe.module.css'

/**
 * Busca a ficha e entrega ao formulario — RF-009.
 *
 * Existe para que `ClienteForm` receba os valores prontos no PRIMEIRO desenho.
 * Preencher depois, por efeito, deixaria os campos vazios por um quadro — e
 * quem comecasse a digitar nesse intervalo perderia o que escreveu quando o
 * estado fosse sobrescrito.
 */
export default function EditarCliente({ clienteId }: { clienteId: string }) {
  const [cliente, setCliente] = useState<ClienteDaFicha | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const r = await buscarCliente(clienteId)
      setCarregando(false)

      if (!r.ok) {
        setErro(r.erro)
        return
      }

      setCliente(r.dados)
    })()
  }, [clienteId])

  if (carregando) {
    return <PageHeader title="Carregando…" subtitle="Buscando a ficha do cliente" />
  }

  if (cliente === null) {
    return (
      <>
        <PageHeader title="Editar cliente" />
        <Card>
          <EmptyState
            title="Não foi possível abrir a ficha"
            description={erro ?? 'Este cliente não existe ou não é da sua loja.'}
            action={
              <Link href="/app/clientes" className={styles.verMais}>
                Voltar para a lista
                <IconArrowRight size={14} />
              </Link>
            }
          />
        </Card>
      </>
    )
  }

  return <ClienteForm cliente={cliente} />
}
