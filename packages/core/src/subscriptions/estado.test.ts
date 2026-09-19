import type { SubscriptionStatus } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import {
  avancar,
  deveAvisarDoFimDoTeste,
  fimDaTolerancia,
  fimDoTeste,
  type AssinaturaParaDecidir,
  type PoliticaDeAssinatura,
} from './estado.js'

/*
 * Numeros de TESTE, e nao a politica do produto: QST-002 segue aberta. Estao
 * aqui como qualquer outro dado de fixture — se fossem os valores reais, o
 * teste passaria a defender uma decisao que ninguem tomou.
 */
const POLITICA: PoliticaDeAssinatura = {
  diasDeTeste: 14,
  diasDeAvisoDoFimDoTeste: 3,
  diasDeTolerancia: 5,
}

const assinatura = (
  status: SubscriptionStatus,
  extra: Partial<AssinaturaParaDecidir> = {},
): AssinaturaParaDecidir => ({
  status,
  fimDoTeste: null,
  proximoVencimento: null,
  ...extra,
})

describe('pagamento confirmado', () => {
  it('ativa a partir de qualquer estado vivo, inclusive restrita', () => {
    /* RF-118: o acesso volta sozinho. Exigir alguem para destravar
       transformaria um lojista que acabou de pagar num chamado de suporte. */
    for (const de of ['trial', 'overdue', 'restricted'] as const) {
      const r = avancar(assinatura(de), { tipo: 'pago' }, POLITICA)
      expect([de, r.status, r.mudou]).toEqual([de, 'active', true])
    }
  })

  it('em assinatura ja ativa nao muda nada', () => {
    /* O provedor reentrega o mesmo evento; sem isto, uma confirmacao repetida
       viraria uma segunda ativacao na auditoria. */
    expect(avancar(assinatura('active'), { tipo: 'pago' }, POLITICA).mudou).toBe(false)
  })

  it('nao ressuscita assinatura encerrada', () => {
    /* Reativar sozinha o que o lojista pediu para encerrar e ele descobrindo
       pela fatura. */
    const r = avancar(assinatura('cancelled'), { tipo: 'pago' }, POLITICA)
    expect([r.status, r.mudou]).toEqual(['cancelled', false])
  })
})

describe('pagamento recusado', () => {
  it('leva de ativa para vencida, e NAO para restrita', () => {
    /* Bloquear na recusa seria nao ter tolerancia nenhuma: a primeira falha de
       cartao fecharia a loja. */
    const r = avancar(assinatura('active'), { tipo: 'pagamento_recusado' }, POLITICA)
    expect([r.status, r.mudou]).toEqual(['overdue', true])
  })

  it('em vencida nao muda nada — o relogio ja esta correndo', () => {
    expect(avancar(assinatura('overdue'), { tipo: 'pagamento_recusado' }, POLITICA).mudou).toBe(
      false,
    )
  })

  it('nao bloqueia quem esta em teste', () => {
    /* Nao ha cobranca no teste; uma recusa aqui e ruido do provedor. */
    const r = avancar(assinatura('trial'), { tipo: 'pagamento_recusado' }, POLITICA)
    expect([r.status, r.mudou]).toEqual(['trial', false])
  })
})

describe('cancelamento', () => {
  /*
   * O diagrama de `fluxos.md` desenha a seta de cancelamento so a partir de
   * Restrita. Leio isso como simplificacao do desenho, e nao como proibicao:
   * "so pode cancelar depois de ser bloqueado" seria obrigar o lojista a
   * ficar inadimplente para conseguir sair. Se a intencao for mesmo restringir
   * de onde se cancela, e aqui que muda.
   */
  it('encerra a partir de qualquer estado vivo', () => {
    for (const de of ['trial', 'active', 'overdue', 'restricted'] as const) {
      expect(avancar(assinatura(de), { tipo: 'cancelado' }, POLITICA).status).toBe('cancelled')
    }
  })
})

describe('a passagem do tempo', () => {
  it('teste vencido sem plano vira restrita', () => {
    const r = avancar(
      assinatura('trial', { fimDoTeste: '2026-10-03' }),
      { tipo: 'tempo_passou', hoje: '2026-10-04' },
      POLITICA,
    )
    expect([r.status, r.mudou]).toEqual(['restricted', true])
  })

  it('o ultimo dia do teste ainda e teste', () => {
    /* `hoje > fim`, e nao `>=`: quem leu "seu teste vai ate 03/10" tem o dia
       03 inteiro. Trocar por `>=` tira um dia de todo mundo. */
    const r = avancar(
      assinatura('trial', { fimDoTeste: '2026-10-03' }),
      { tipo: 'tempo_passou', hoje: '2026-10-03' },
      POLITICA,
    )
    expect([r.status, r.mudou]).toEqual(['trial', false])
  })

  it('vencida so bloqueia depois da tolerancia inteira', () => {
    const vencida = assinatura('overdue', { proximoVencimento: '2026-10-05' })

    /* Tolerancia de 5 dias: o dia 10 ainda escreve, o dia 11 nao. */
    expect(avancar(vencida, { tipo: 'tempo_passou', hoje: '2026-10-10' }, POLITICA).mudou).toBe(
      false,
    )
    const depois = avancar(vencida, { tipo: 'tempo_passou', hoje: '2026-10-11' }, POLITICA)
    expect([depois.status, depois.mudou]).toEqual(['restricted', true])
  })

  it('a tolerancia conta do VENCIMENTO, nao de quando o aviso chegou', () => {
    /* Aviso que atrasa dois dias no provedor nao pode render dois dias a mais
       de tolerancia para um lojista e nao para outro. */
    expect(fimDaTolerancia('2026-10-05', POLITICA)).toBe('2026-10-10')
  })

  it('sem vencimento, a vencida fica parada em vez de bloquear', () => {
    /* Bloquear sem saber de quando contar seria bloquear por falta de dado. */
    const r = avancar(assinatura('overdue'), { tipo: 'tempo_passou', hoje: '2027-01-01' }, POLITICA)
    expect([r.status, r.mudou]).toEqual(['overdue', false])
  })

  it('nao mexe em ativa nem em restrita', () => {
    for (const de of ['active', 'restricted'] as const) {
      expect(
        avancar(assinatura(de), { tipo: 'tempo_passou', hoje: '2027-01-01' }, POLITICA).mudou,
      ).toBe(false)
    }
  })

  it('distingue os dois caminhos ate restrita pelo motivo', () => {
    /* As duas terminam no mesmo estado. "Nunca assinou" e "parou de pagar"
       levam a conversas diferentes com o lojista, e a auditoria precisa saber
       qual foi. */
    const porTeste = avancar(
      assinatura('trial', { fimDoTeste: '2026-10-03' }),
      { tipo: 'tempo_passou', hoje: '2026-10-04' },
      POLITICA,
    )
    const porTolerancia = avancar(
      assinatura('overdue', { proximoVencimento: '2026-10-05' }),
      { tipo: 'tempo_passou', hoje: '2026-10-11' },
      POLITICA,
    )
    expect(porTeste.motivo).not.toBe(porTolerancia.motivo)
  })
})

describe('prazos do periodo de teste', () => {
  it('o fim do teste sai da data de criacao', () => {
    expect(fimDoTeste('2026-09-19', POLITICA)).toBe('2026-10-03')
  })

  it('atravessa a virada de mes sem perder dia', () => {
    /* Contas de calendario feitas com `Date` e fuso e onde o prazo some. */
    expect(fimDoTeste('2026-02-25', { ...POLITICA, diasDeTeste: 7 })).toBe('2026-03-04')
  })

  it('avisa durante a janela inteira, e nao so no dia exato', () => {
    /* Aviso de data unica se perde quando o job nao roda naquele dia — e o
       lojista descobre o fim do teste pela tela bloqueada. */
    for (const dia of ['2026-09-30', '2026-10-01', '2026-10-03']) {
      expect(deveAvisarDoFimDoTeste('2026-10-03', dia, POLITICA)).toBe(true)
    }
  })

  it('nao avisa cedo demais nem depois de vencido', () => {
    expect(deveAvisarDoFimDoTeste('2026-10-03', '2026-09-29', POLITICA)).toBe(false)
    /* Depois de vencido a mensagem e outra: ja esta bloqueado. */
    expect(deveAvisarDoFimDoTeste('2026-10-03', '2026-10-04', POLITICA)).toBe(false)
  })

  it('sem prazo definido nao avisa nada', () => {
    expect(deveAvisarDoFimDoTeste(null, '2026-10-01', POLITICA)).toBe(false)
  })
})
