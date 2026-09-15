import AppShell from '@/components/app/AppShell'
import ModuleGuard from '@/components/billing/ModuleGuard'
import { SubscriptionProvider } from '@/components/billing/SubscriptionProvider'
import AvisoDeReaceite from '@/components/legal/AvisoDeReaceite'

export default function PainelLayout({ children }: LayoutProps<'/app'>) {
  return (
    /* O status da assinatura envolve todo o painel: o shell usa para o banner
       e os cadeados, e o ModuleGuard para bloquear as rotas restritas. */
    <SubscriptionProvider>
      <AppShell>
        {/* Documento legal novo (RF-03): avisa em toda tela do painel, e nao
            so numa — quem entra direto em /app/vendas por um link salvo
            tambem precisa ver. */}
        <AvisoDeReaceite />
        <ModuleGuard>{children}</ModuleGuard>
      </AppShell>
    </SubscriptionProvider>
  )
}
