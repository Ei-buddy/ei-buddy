'use client'

import { useCallback, useEffect, useState } from 'react'
import { carregarOrcamentos, ROTULO_SITUACAO, vencido, type Orcamento } from '@/lib/orcamentos-api'
import { formatCentavos, formatDate, hoje } from '@/lib/format'
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/UI'
import { ButtonLink } from '@/components/ui/Button'
import Toast from '@/components/ui/Toast'
import OrcamentoForm from './OrcamentoForm'
import styles from './orcamentos.module.css'

/**
 * Orcamentos — NR-159.
 *
 * A proposta ao cliente: nao baixa estoque nem lanca financeiro. Os precos
 * ficam gravados. Na ficha, o orcamento sai no papel (imprimir), vai pelo
 * WhatsApp ou vira venda no PDV com o carrinho ja montado.
 */
export default function OrcamentosView() {
  const [orcamentos, setOrcamentos] = useState<Orcamento[] | undefined>(undefined)
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null)

  const carregar = useCallback(async () => {
    const r = await carregarOrcamentos()
    if (r.ok) {
      setOrcamentos(r.dados)
      setErro(null)
    } else setErro(r.erro)
  }, [])

  useEffect(() => {
    void (async () => {
      await carregar()
    })()
  }, [carregar])

  const dia = hoje()

  return (
    <>
      <PageHeader
        title="Orçamentos"
        subtitle="Proposta ao cliente: não baixa estoque e vira venda quando ele aceitar"
      />

      <OrcamentoForm
        aoSalvar={(o) => {
          setToast({ msg: `Orçamento nº ${o.number} criado.`, tone: 'success' })
          void carregar()
        }}
        aoErrar={(msg) => setToast({ msg, tone: 'error' })}
      />

      <Card title="Orçamentos">
        {erro !== null ? (
          <EmptyState title="Não deu para carregar os orçamentos" description={erro} />
        ) : orcamentos === undefined ? (
          <p className={styles.vazio}>Carregando...</p>
        ) : orcamentos.length === 0 ? (
          <p className={styles.vazio}>Nenhum orçamento ainda.</p>
        ) : (
          <ul className={styles.lista}>
            {orcamentos.map((o) => (
              <li key={o.id} className={styles.orcamento}>
                <span className={styles.info}>
                  <strong>
                    Nº {o.number}
                    {o.customerName ? ` · ${o.customerName}` : ''}
                  </strong>
                  <small>
                    {o.items.length} {o.items.length === 1 ? 'item' : 'itens'} · válido até{' '}
                    {formatDate(o.validUntil)}
                  </small>
                </span>
                <Badge
                  tone={
                    o.status === 'converted'
                      ? 'success'
                      : o.status === 'cancelled'
                        ? 'neutral'
                        : vencido(o, dia)
                          ? 'warning'
                          : 'info'
                  }
                >
                  {vencido(o, dia) ? 'Vencido' : ROTULO_SITUACAO[o.status]}
                </Badge>
                <strong className={styles.valor}>{formatCentavos(o.totalCents)}</strong>
                <span className={styles.botoes}>
                  <ButtonLink href={`/app/orcamentos/${o.id}`} variant="secondary" size="sm">
                    Abrir
                  </ButtonLink>
                  {/* Achado do QA: do orcamento direto para a venda, com o
                      carrinho e o cliente montados. */}
                  {o.status === 'open' ? (
                    <ButtonLink href={`/app/vendas/nova?orcamento=${o.id}`} size="sm">
                      Vender
                    </ButtonLink>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {toast ? (
        <Toast message={toast.msg} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </>
  )
}
