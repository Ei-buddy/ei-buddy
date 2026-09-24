import 'server-only'
import { cookies } from 'next/headers'
import { chamarApi } from './api-server'
import { SESSION_COOKIE } from './session'
import type { VendaDoHistorico } from './vendas-api'

/**
 * Uma venda, lida do SERVIDOR do Next — NR-027, US-021.
 *
 * A pagina de detalhe e um componente de servidor: ela precisa do dado antes de
 * renderizar, para `generateMetadata` poder por o numero da venda no titulo da
 * aba. Por isso nao passa pelo BFF — ela ja ESTA no servidor, e dar uma volta
 * pelo proprio Next para falar com a api seria um salto a toa.
 *
 * `server-only` no import de `api-server` continua valendo: se este arquivo
 * entrar num componente de cliente por engano, o build quebra em vez de mandar
 * o token da sessao para o navegador.
 */

type VendaDaApi = {
  id: string
  number: number
  soldAt: string
  customerId: string | null
  customerName: string | null
  status: VendaDoHistorico['status']
  grossAmountCents: number
  discountCents: number
  netAmountCents: number
  taxAmountCents: number
  cardFeeAmountCents: number
  items: { description: string; quantity: number; unitPriceCents: number; totalCents: number }[]
  payments: {
    method: VendaDoHistorico['pagamentos'][number]['forma']
    amountCents: number
    installments: number | null
  }[]
  invoiceNumber: number | null
  invoiceAccessKey: string | null
}

const reais = (centavos: number) => centavos / 100

/** `null` quando nao existe, e de outra loja, ou nao ha sessao. */
export async function buscarVenda(id: string): Promise<VendaDoHistorico | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (token === undefined) return null

  const r = await chamarApi<VendaDaApi>(`/sales/${encodeURIComponent(id)}`, { token })

  /*
   * Qualquer falha vira `null`, e a pagina responde 404.
   *
   * Venda de outra loja ja volta 404 da api — um 403 confirmaria que ela existe
   * em algum lugar, e o numero e sequencial por empresa. Distinguir aqui os
   * outros erros daria uma pagina de erro tecnica para quem so digitou um
   * endereco errado.
   */
  if (!r.ok) return null

  const v = r.dados

  return {
    id: v.id,
    numero: v.number,
    data: v.soldAt,
    clienteId: v.customerId,
    clienteNome: v.customerName,
    status: v.status,
    bruto: reais(v.grossAmountCents),
    desconto: reais(v.discountCents),
    /* Total e o que o cliente pagou; `netAmountCents` e o liquido da loja. */
    total: reais(v.grossAmountCents - v.discountCents),
    liquido: reais(v.netAmountCents),
    imposto: reais(v.taxAmountCents),
    taxaCartao: reais(v.cardFeeAmountCents),
    itens: v.items.map((i) => ({
      descricao: i.description,
      quantidade: i.quantity,
      precoUnitario: reais(i.unitPriceCents),
      total: reais(i.totalCents),
    })),
    pagamentos: v.payments.map((p) => ({
      forma: p.method,
      valor: reais(p.amountCents),
      parcelas: p.installments,
    })),
    notaNumero: v.invoiceNumber,
    notaChave: v.invoiceAccessKey,
  }
}
