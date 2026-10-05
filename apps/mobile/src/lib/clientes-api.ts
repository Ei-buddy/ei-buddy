import { chamarApi } from './api'

/**
 * Clientes no app — RF-011, US-036.
 *
 * Consulta, e nao cadastro: o que se precisa no balcao e responder "quem e essa
 * pessoa e ela deve alguma coisa?", e conseguir ligar na hora. Cadastro e
 * edicao ficam no web.
 *
 * A lista vinha de `mock-data`, com pendencias inventadas por id. Agora vem de
 * `GET /clientes`, a mesma rota do web, com busca e filtro no SERVIDOR.
 */

export type ClienteDaLista = {
  id: string
  nome: string
  documento: string | null
  celular: string | null
  /** Saldo devedor do fiado, em reais. */
  saldoFiado: number
  /** Nulo = NUNCA comprou. */
  ultimaCompra: string | null
}

type ClienteDaApi = {
  id: string
  name: string
  document: string | null
  phone: string | null
  walletBalanceCents: number
  lastSaleOn: string | null
}

export type ListaDeClientes = { clientes: ClienteDaLista[]; total: number }

export async function listarClientes(opcoes: {
  termo?: string
  soFiado?: boolean
}): Promise<{ ok: true; dados: ListaDeClientes } | { ok: false; erro: string }> {
  const query = new URLSearchParams()
  /* So vai o que veio: `q=` vazio faria a api recusar o pedido inteiro. */
  if (opcoes.termo) query.set('q', opcoes.termo)
  if (opcoes.soFiado) query.set('filter', 'fiado')

  const r = await chamarApi<{ customers: ClienteDaApi[]; total: number }>(
    `/clientes?${query.toString()}`,
  )
  if (!r.ok) return { ok: false, erro: r.message }

  return {
    ok: true,
    dados: {
      total: r.dados.total,
      clientes: r.dados.customers.map((c) => ({
        id: c.id,
        nome: c.name,
        documento: c.document,
        celular: c.phone,
        saldoFiado: c.walletBalanceCents / 100,
        ultimaCompra: c.lastSaleOn,
      })),
    },
  }
}

/**
 * O link do WhatsApp, ou nulo sem telefone.
 *
 * O telefone chega so com digitos, com ou sem o 55: sem o pais, o `wa.me`
 * abre uma conversa com um numero que nao existe.
 */
export function linkDoWhatsApp(celular: string | null): string | null {
  const digitos = (celular ?? '').replace(/\D/g, '')
  if (digitos.length < 10) return null
  return `https://wa.me/${digitos.startsWith('55') && digitos.length > 11 ? digitos : `55${digitos}`}`
}

/**
 * Quanto o cliente tem VENCIDO, em reais — o aviso do PDV antes de vender fiado.
 *
 * Mesma fonte do web (`GET /contas-a-receber?cliente=`): a faixa `overdue`,
 * descontado o que ja foi baixado em parte. Nulo quando nao deu para saber —
 * o aviso some, e a venda segue; quem decide vender e o lojista.
 */
export async function vencidoDoCliente(clienteId: string): Promise<number | null> {
  const r = await chamarApi<{
    grupos: {
      faixa: string
      receivables: { amountCents: number; settledAmountCents: number }[]
    }[]
  }>(`/contas-a-receber?cliente=${encodeURIComponent(clienteId)}`)
  if (!r.ok) return null

  const centavos = r.dados.grupos
    .filter((g) => g.faixa === 'overdue')
    .flatMap((g) => g.receivables)
    .reduce((soma, t) => soma + t.amountCents - t.settledAmountCents, 0)

  return centavos / 100
}
