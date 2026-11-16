'use client'

import Link from 'next/link'
import { useState } from 'react'
import { resumoDaAssinatura } from '@/lib/assinatura-api'
import { IconClose } from '../Icons'
import { useSubscription } from './SubscriptionProvider'
import styles from './billing.module.css'

/**
 * Banner fixo da assinatura que pede atencao — atrasada, restrita ou
 * cancelada (NR-216).
 *
 * O texto vem da situacao do servidor. Antes dizia "14 dias em atraso" para
 * qualquer loja, um numero fixo no codigo, e so aparecia num estado que o
 * servidor nunca mandava.
 *
 * Fica no topo do painel em tom de alerta (ambar) — nunca vermelho, que
 * fica reservado para erro critico. Pode ser recolhido, mas volta a cada
 * navegacao: e um aviso persistente, nao uma notificacao descartavel.
 */
export default function PaymentOverdueBanner() {
  const { situacao } = useSubscription()
  const [recolhido, setRecolhido] = useState(false)

  const status = situacao.status
  if (status !== 'overdue' && status !== 'restricted' && status !== 'cancelled') return null

  const resumo = resumoDaAssinatura(situacao)

  if (recolhido) {
    return (
      <button type="button" className={styles.bannerCollapsed} onClick={() => setRecolhido(false)}>
        <span className={styles.bannerDot} aria-hidden="true" />
        {resumo.rotulo}
      </button>
    )
  }

  return (
    <div className={styles.banner} role="status">
      <span className={styles.bannerIcon} aria-hidden="true">
        !
      </span>

      <p className={styles.bannerText}>
        <strong>{resumo.rotulo}.</strong> {primeiraMaiuscula(resumo.detalhe)}.
      </p>

      <Link href="/app/assinatura" className={styles.bannerCta}>
        {status === 'cancelled' ? 'Ver assinatura' : 'Regularizar pagamento'}
      </Link>

      <button
        type="button"
        className={styles.bannerClose}
        onClick={() => setRecolhido(true)}
        aria-label="Recolher aviso"
      >
        <IconClose size={17} />
      </button>
    </div>
  )
}

function primeiraMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}
