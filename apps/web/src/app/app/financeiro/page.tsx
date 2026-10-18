import { redirect } from 'next/navigation'

/**
 * `/app/financeiro` e o item-pai do menu e o alvo do tutorial, mas nao tinha
 * pagina: quem chegava pela URL caia num 404 (achado do QA). Leva para a tela
 * do grupo que o lojista mais abre.
 */
export default function FinanceiroPage() {
  redirect('/app/financeiro/contas-a-receber')
}
