import type { PaymentMethod } from '@na-regua/contracts'
import { formatarCentavos } from './format.js'

/**
 * Visões humanizadas — o que o modelo lê das tools.
 *
 * O modelo só copia o que vê. Valor chega em reais, forma de pagamento em
 * português e campo vazio não chega, para a resposta já nascer sem centavos,
 * nome de campo e "indisponível" (FR-002, FR-003, FR-006).
 */

export function reais(cents: number): string {
  return formatarCentavos(cents)
}

const PAGAMENTO: Record<PaymentMethod, string> = {
  cash: 'dinheiro',
  pix: 'pix',
  debit: 'débito',
  credit: 'crédito',
  wallet: 'fiado',
}

export function pagamento(method: PaymentMethod): string {
  return PAGAMENTO[method]
}

export function semVazios<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const limpo: Partial<T> = {}
  for (const [chave, valor] of Object.entries(obj)) {
    if (valor === null || valor === undefined || valor === '') continue
    ;(limpo as Record<string, unknown>)[chave] = valor
  }
  return limpo
}

export type Recusado = { readonly status: 'recusado'; readonly mensagem: string }

/** `message` do AppError já é texto para a pessoa (RNF-054); o `path` nunca vai. */
export function erroHumano(erro: { readonly message: string }): Recusado {
  return { status: 'recusado', mensagem: erro.message }
}
