'use client'

import { useCallback, useState } from 'react'
import { createPixCharge, fetchPixChargeStatus } from '@/lib/auth-api'
import CobrancaPix from '@/components/app/CobrancaPix'
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import { plan } from '@/content/site'
import { reaisDoTexto } from '@/lib/valor'
import { useSubscription } from './SubscriptionProvider'
import styles from './assinatura.module.css'

/*
 * Sem faturas fixas no codigo. Esta tela mostrava quatro faturas inventadas
 * (maio a agosto, uma "Vencida" de R$ 149,00) para toda conta, inclusive a
 * criada agora — e o preco anunciado e outro. As faturas reais sao da NR-063,
 * que espera o preco e os prazos (QST-002); ate la, o historico fica vazio e
 * diz por que.
 */

export default function AssinaturaView() {
  const { bloqueado, setStatus } = useSubscription()
  const [pagando, setPagando] = useState(false)

  /* Estavel: o CobrancaPix usa esta funcao como dependencia de efeito. */
  const criarCobrancaFatura = useCallback((valor: number) => createPixCharge(plan.name, valor), [])

  const valorDoPlano = reaisDoTexto(plan.price)

  return (
    <>
      <PageHeader title="Assinatura" subtitle="Plano, faturas e formas de pagamento" />

      <div className="statRow">
        <Stat label="Plano atual" value={plan.name} hint={`${plan.price}${plan.period}`} />
        <Stat
          label="Situação"
          value={bloqueado ? 'Pagamento pendente' : 'Em dia'}
          hint={bloqueado ? 'acesso restrito' : 'acesso completo'}
          tone={bloqueado ? 'warning' : 'positive'}
        />
      </div>

      {bloqueado && !pagando ? (
        <div className={styles.callout}>
          <div>
            <strong className={styles.calloutTitle}>
              Regularize para liberar o acesso completo
            </strong>
            <p className={styles.calloutText}>
              Assim que o pagamento cair, os módulos voltam automaticamente — nenhum dado seu foi
              apagado.
            </p>
          </div>
          <Button onClick={() => setPagando(true)}>Pagar com Pix</Button>
        </div>
      ) : null}

      {pagando ? (
        <div className={styles.pixWrap}>
          <CobrancaPix
            titulo={plan.name}
            subtitulo="Fatura em aberto"
            amount={valorDoPlano}
            criarCobranca={criarCobrancaFatura}
            consultarStatus={fetchPixChargeStatus}
            onPago={() => {
              /* Confirmado: libera o painel na hora. Com backend, isto vira
                 uma releitura de GET /billing/subscription. */
              setStatus('active')
              setPagando(false)
            }}
            textoSucesso="Acesso liberado. Obrigado!"
          />
        </div>
      ) : null}

      <Card title="Histórico de faturas">
        <EmptyState
          title="Nenhuma fatura ainda"
          description="As faturas da mensalidade aparecem aqui assim que a cobrança começar."
        />
      </Card>
    </>
  )
}
