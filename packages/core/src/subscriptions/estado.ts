import type { SubscriptionStatus } from '@na-regua/contracts'
import { somarDias } from '@na-regua/domain'

/**
 * A maquina de estados da assinatura — RF-110 a RF-118, NR-063.
 *
 * Puro de proposito, como `authorization.ts`: nenhuma porta, nenhuma
 * transacao, nenhum relogio proprio. Quem decide o acesso do lojista ao
 * proprio negocio precisa ser a coisa mais facil de testar do repositorio.
 *
 * O desenho e o de
 * [fluxos.md](../../../../docs/arquitetura/fluxos.md#assinatura-e-bloqueio-por-inadimplência);
 * este arquivo e aquele diagrama em codigo.
 *
 * ## Os prazos NAO estao aqui
 *
 * Dias de teste, de aviso e de tolerancia entram como `PoliticaDeAssinatura`,
 * e nao como constante. Nao e flexibilidade gratuita: esses numeros sao a
 * QST-002, ainda em aberto (DEC-010). Escreve-los aqui seria inventar decisao
 * de produto e escondê-la dentro de uma regra — e, quando a resposta viesse,
 * seria refatoracao em vez de configuracao.
 */

export type PoliticaDeAssinatura = {
  /** Quanto dura o periodo de teste — RF-110. */
  readonly diasDeTeste: number
  /** Com quanta antecedencia avisar que o teste acaba — RF-111. */
  readonly diasDeAvisoDoFimDoTeste: number
  /**
   * Quanto tempo depois do vencimento ate o bloqueio — RF-116, RF-117.
   *
   * Zero significa bloquear no dia do vencimento, o que e o mesmo que nao ter
   * tolerancia. A politica admite, mas quem escolher isso esta escolhendo.
   */
  readonly diasDeTolerancia: number
}

/** O que acontece com a assinatura. Nenhum deles e "o tempo passou" sozinho. */
export type EventoDaAssinatura =
  /** O provedor confirmou o pagamento — RF-112, RF-118. */
  | { readonly tipo: 'pago' }
  /** A cobranca do ciclo nao foi paga — RF-113. */
  | { readonly tipo: 'pagamento_recusado' }
  /** O lojista encerrou. */
  | { readonly tipo: 'cancelado' }
  /**
   * O relogio, trazido de fora como DATA e nao como `Date.now()`.
   *
   * `hoje` decide se o teste acabou e se a tolerancia estourou. Vir de fora e
   * o que permite testar "o dia seguinte ao vencimento" sem esperar por ele.
   */
  | { readonly tipo: 'tempo_passou'; readonly hoje: string }

/** O recorte da assinatura de que a regra precisa — e so ele. */
export type AssinaturaParaDecidir = {
  readonly status: SubscriptionStatus
  /** Fim do teste, em data de calendario. Nulo fora de `trial`. */
  readonly fimDoTeste: string | null
  /** Vencimento em aberto. Nulo quando nao ha ciclo cobrado. */
  readonly proximoVencimento: string | null
}

/** O que a transicao decidiu. `mudou` falso significa "nada a fazer". */
export type Transicao = {
  readonly status: SubscriptionStatus
  readonly mudou: boolean
  /** Por que, em uma linha. Vai para a auditoria, nao para a tela. */
  readonly motivo: string
}

const PARADO = (status: SubscriptionStatus, motivo: string): Transicao => ({
  status,
  mudou: false,
  motivo,
})

/**
 * O proximo estado, dado o atual e o que aconteceu.
 *
 * Total de proposito: todo par (estado, evento) tem resposta, e a resposta de
 * um par sem sentido e "nao mudou nada" — nunca uma excecao. Um webhook
 * reentregue depois do cancelamento e coisa normal do provedor, e derrubar o
 * processamento por causa dele criaria fila presa em vez de estado errado.
 */
export function avancar(
  assinatura: AssinaturaParaDecidir,
  evento: EventoDaAssinatura,
  politica: PoliticaDeAssinatura,
): Transicao {
  const { status } = assinatura

  /* Encerrada e terminal. Voltar de la seria reativar sozinha uma assinatura
     que o lojista pediu para encerrar — e ele descobriria pela fatura. */
  if (status === 'cancelled') return PARADO(status, 'Assinatura ja encerrada.')

  switch (evento.tipo) {
    /*
     * Pagamento confirmado ativa de QUALQUER estado vivo, inclusive de
     * `restricted` — e isso e o RF-118: o acesso volta sozinho, sem
     * intervencao manual. Exigir alguem para destravar transformaria um
     * lojista que acabou de pagar num chamado de suporte.
     */
    case 'pago':
      return status === 'active'
        ? PARADO(status, 'Assinatura ja ativa.')
        : { status: 'active', mudou: true, motivo: 'Pagamento confirmado pelo provedor.' }

    /*
     * Recusa NAO bloqueia: leva a `overdue`, que ainda escreve. O bloqueio
     * vem depois, quando a tolerancia estourar. Bloquear na recusa seria nao
     * ter tolerancia nenhuma — e a primeira falha de cartao fecharia a loja.
     */
    case 'pagamento_recusado':
      return status === 'active'
        ? { status: 'overdue', mudou: true, motivo: 'Cobranca do ciclo nao foi paga.' }
        : PARADO(status, 'Recusa que nao muda nada neste estado.')

    case 'cancelado':
      return { status: 'cancelled', mudou: true, motivo: 'Encerrada pelo lojista.' }

    case 'tempo_passou':
      return pelaPassagemDoTempo(assinatura, evento.hoje, politica)
  }
}

/**
 * O tempo so mexe em duas coisas: o fim do teste e o fim da tolerancia.
 *
 * As duas terminam no MESMO estado (`restricted`) e por motivos diferentes, e
 * a auditoria precisa distinguir: "nunca assinou" e "parou de pagar" levam a
 * conversas diferentes com o lojista.
 */
function pelaPassagemDoTempo(
  assinatura: AssinaturaParaDecidir,
  hoje: string,
  politica: PoliticaDeAssinatura,
): Transicao {
  if (assinatura.status === 'trial') {
    if (assinatura.fimDoTeste === null) return PARADO('trial', 'Teste sem prazo definido.')
    return hoje > assinatura.fimDoTeste
      ? { status: 'restricted', mudou: true, motivo: 'Periodo de teste terminou sem plano.' }
      : PARADO('trial', 'Periodo de teste em andamento.')
  }

  if (assinatura.status === 'overdue') {
    const limite = fimDaTolerancia(assinatura.proximoVencimento, politica)
    if (limite === null) return PARADO('overdue', 'Sem vencimento para contar a tolerancia.')
    return hoje > limite
      ? { status: 'restricted', mudou: true, motivo: 'Prazo de tolerancia esgotado.' }
      : PARADO('overdue', 'Dentro do prazo de tolerancia.')
  }

  return PARADO(assinatura.status, 'O tempo nao muda este estado.')
}

/**
 * Quando o teste termina, dado o dia em que a empresa foi criada — RF-110.
 *
 * Data de calendario e nao instante: "seu teste vai ate 03/10" e o que cabe na
 * tela, e contar em horas faria o prazo terminar no meio de um expediente.
 */
export function fimDoTeste(criadaEm: string, politica: PoliticaDeAssinatura): string {
  return somarDias(criadaEm, politica.diasDeTeste)
}

/**
 * Se e hora de avisar que o teste acaba — RF-111.
 *
 * Avisa na janela, e nao so no dia exato: um aviso de uma data unica se perde
 * se o job nao rodar naquele dia, e o lojista descobre o fim do teste pela
 * tela bloqueada. Depois de vencido nao avisa mais — ai a mensagem e outra.
 */
export function deveAvisarDoFimDoTeste(
  fimDoTeste: string | null,
  hoje: string,
  politica: PoliticaDeAssinatura,
): boolean {
  if (fimDoTeste === null) return false
  if (hoje > fimDoTeste) return false
  return hoje >= somarDias(fimDoTeste, -politica.diasDeAvisoDoFimDoTeste)
}

/**
 * Ate quando a loja continua escrevendo depois do vencimento — RF-116.
 *
 * Conta do VENCIMENTO, e nao do dia em que o webhook chegou: aviso de recusa
 * que atrasa dois dias no provedor nao pode render dois dias a mais de
 * tolerancia para um lojista e nao para outro.
 */
export function fimDaTolerancia(
  proximoVencimento: string | null,
  politica: PoliticaDeAssinatura,
): string | null {
  return proximoVencimento === null ? null : somarDias(proximoVencimento, politica.diasDeTolerancia)
}
