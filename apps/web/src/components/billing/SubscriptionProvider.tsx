'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'
import type { EstadoDaAssinatura, SituacaoDaAssinatura } from '@/lib/assinatura-api'
import {
  getSubscriptionServerSnapshot,
  getSubscriptionSnapshot,
  recarregarAssinatura,
  subscribeSubscription,
} from '@/lib/subscription-store'

type SubscriptionContextValue = {
  /** A situacao inteira, como o servidor devolveu. */
  situacao: SituacaoDaAssinatura
  /** `null` = sem assinatura (a cobranca ainda nao comecou). */
  status: EstadoDaAssinatura | null
  /**
   * true quando a loja NAO pode criar lancamentos: restrita ou cancelada.
   *
   * Atrasada nao bloqueia — o prazo de tolerancia (RF-116) so serve se a
   * loja continuar funcionando durante ele. A tela antiga bloqueava em
   * "overdue", o oposto da regra.
   */
  bloqueado: boolean
  /** Le de novo do servidor — depois de um pagamento, por exemplo. */
  recarregar: () => Promise<void>
  /** Abre o modal de "pagamento necessario" a partir de qualquer tela. */
  pedirRegularizacao: () => void
  modalAberto: boolean
  fecharModal: () => void
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null)

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  /* O servidor renderiza "sem assinatura" (liberado) e o navegador troca pelo
     valor de `GET /assinatura` assim que ele volta — NR-216. */
  const situacao = useSyncExternalStore(
    subscribeSubscription,
    getSubscriptionSnapshot,
    getSubscriptionServerSnapshot,
  )

  const [modalAberto, setModalAberto] = useState(false)
  const pathname = usePathname()

  /*
   * De novo a cada troca de tela — o mesmo criterio dos avisos (NR-147).
   *
   * O layout do `/app` NAO remonta ao navegar: entrar numa loja como Super
   * Admin, voltar da plataforma ou pagar a fatura troca a situacao sem
   * remontar nada, e uma leitura so na montagem mostraria a da loja anterior.
   */
  useEffect(() => {
    void recarregarAssinatura()
  }, [pathname])

  const recarregar = useCallback(async () => {
    await recarregarAssinatura()
  }, [])

  const value = useMemo<SubscriptionContextValue>(
    () => ({
      situacao,
      status: situacao.status,
      bloqueado: !situacao.canWrite,
      recarregar,
      pedirRegularizacao: () => setModalAberto(true),
      modalAberto,
      fecharModal: () => setModalAberto(false),
    }),
    [situacao, recarregar, modalAberto],
  )

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>
}

export function useSubscription(): SubscriptionContextValue {
  const ctx = useContext(SubscriptionContext)
  if (!ctx) {
    throw new Error('useSubscription precisa estar dentro de SubscriptionProvider')
  }
  return ctx
}
