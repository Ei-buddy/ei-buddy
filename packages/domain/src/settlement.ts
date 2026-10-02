import { Money } from '@na-regua/money'
import { DomainError } from './domain-error.js'

/**
 * Baixa, baixa parcial e estorno — RF-059, RF-060, RF-066, RF-067.
 *
 * A regra e a mesma para conta a pagar e para recebivel: muda quem deve a quem,
 * nao a aritmetica. Por isso ela vive aqui, em `domain`, e nao duplicada nos
 * dois casos de uso — duas copias da mesma conta e a garantia de que uma delas
 * vai divergir num caso de borda, e o caso de borda em dinheiro e o caro.
 */

/** Situacao derivada dos valores, nunca guardada por conta propria. */
export type SituacaoDoTitulo = 'open' | 'partially_settled' | 'settled'

export type ResultadoDaBaixa = {
  /** Total baixado depois desta operacao. */
  readonly settledAmountCents: number
  readonly status: SituacaoDoTitulo
}

/**
 * A situacao SEMPRE sai dos valores.
 *
 * Guardar o status como campo independente cria duas fontes para a mesma
 * verdade, e a hora em que elas discordam e a hora em que o lojista ve uma
 * conta "paga" com saldo devedor na tela ao lado.
 */
export function situacaoPorValor(valorCents: number, baixadoCents: number): SituacaoDoTitulo {
  if (baixadoCents <= 0) return 'open'
  if (baixadoCents >= valorCents) return 'settled'
  return 'partially_settled'
}

/**
 * Aplica uma baixa, total ou parcial — RF-059, RF-066.
 *
 * Recusa pagar mais do que se deve. Nao e zelo: um valor a maior digitado por
 * engano ficaria como credito invisivel dentro de um titulo, e o lojista so
 * descobriria conferindo o extrato contra o sistema, meses depois. Quem quer
 * registrar pagamento a maior esta querendo outra coisa — adiantamento — e isso
 * e um lancamento proprio, nao uma baixa que estourou.
 */
export function aplicarBaixa(
  valorCents: number,
  jaBaixadoCents: number,
  baixaCents: number,
): ResultadoDaBaixa {
  if (!Number.isInteger(baixaCents) || baixaCents <= 0) {
    throw new DomainError('INVALID_SETTLEMENT', 'O valor da baixa precisa ser maior que zero.')
  }
  if (jaBaixadoCents < 0 || valorCents <= 0) {
    throw new DomainError('INVALID_SETTLEMENT', 'Titulo com valores invalidos.')
  }

  const restante = valorCents - jaBaixadoCents

  if (restante <= 0) {
    throw new DomainError('ALREADY_SETTLED', 'Este titulo ja esta quitado.')
  }
  if (baixaCents > restante) {
    throw new DomainError(
      'SETTLEMENT_EXCEEDS_BALANCE',
      `A baixa de ${Money.fromCents(baixaCents).format()} passa do saldo devedor de ${Money.fromCents(restante).format()}.`,
    )
  }

  const settledAmountCents = jaBaixadoCents + baixaCents
  return { settledAmountCents, status: situacaoPorValor(valorCents, settledAmountCents) }
}

/**
 * Desfaz uma baixa — RF-060, RF-067.
 *
 * Devolve o titulo ao estado anterior AQUELA baixa, e nao ao estado inicial: se
 * houve tres baixas e a segunda foi estornada, as outras duas continuam de pe.
 * Por isso a entrada e o valor da baixa estornada, e nao "zerar".
 */
export function estornarBaixa(
  valorCents: number,
  jaBaixadoCents: number,
  baixaEstornadaCents: number,
): ResultadoDaBaixa {
  if (!Number.isInteger(baixaEstornadaCents) || baixaEstornadaCents <= 0) {
    throw new DomainError('INVALID_SETTLEMENT', 'O valor do estorno precisa ser maior que zero.')
  }
  if (baixaEstornadaCents > jaBaixadoCents) {
    /* Estornar mais do que foi baixado deixaria o titulo com saldo baixado
       negativo — um titulo que "pagou menos que nada". */
    throw new DomainError('INVALID_SETTLEMENT', 'O estorno passa do total ja baixado neste titulo.')
  }

  const settledAmountCents = jaBaixadoCents - baixaEstornadaCents
  return { settledAmountCents, status: situacaoPorValor(valorCents, settledAmountCents) }
}
