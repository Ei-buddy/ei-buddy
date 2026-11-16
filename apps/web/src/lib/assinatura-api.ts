import { diaLocal, formatDate } from './format'

/**
 * A assinatura lida do SERVIDOR — NR-216, RF-117.
 *
 * Antes a web lia `demo:subscription-status` do armazenamento do navegador:
 * um valor que so o proprio cadastro escrevia ("trial" ou "active") e que
 * nenhuma cobrança, atraso ou restricao chegava a mudar. Agora a fonte e
 * `GET /assinatura`.
 *
 * Tipos locais, e nao importados de `@na-regua/contracts`: o bundler do Next
 * nao resolve os imports `.js` do pacote. O teste confere que `podeEscrever`
 * daqui responde igual ao do contrato para os cinco estados.
 */

export type EstadoDaAssinatura = 'trial' | 'active' | 'overdue' | 'restricted' | 'cancelled'

export const ESTADOS_DA_ASSINATURA: readonly EstadoDaAssinatura[] = [
  'trial',
  'active',
  'overdue',
  'restricted',
  'cancelled',
]

export type Assinatura = {
  companyId: string
  planCode: string
  status: EstadoDaAssinatura
  trialEndsAt: string | null
  currentPeriodEndsAt: string | null
  couponId: string | null
  restrictedAt: string | null
  cancelledAt: string | null
  nextDueDate: string | null
}

export type SituacaoDaAssinatura = {
  subscription: Assinatura | null
  status: EstadoDaAssinatura | null
  canWrite: boolean
}

/** Sem assinatura nenhuma: o caso de toda loja enquanto a cobranca nao liga (QST-002). */
export const SEM_ASSINATURA: SituacaoDaAssinatura = {
  subscription: null,
  status: null,
  canWrite: true,
}

/**
 * A leitura que o painel usa, separando os dois jeitos de NAO ter resposta.
 *
 * - `'sem-empresa'` (401/403): sessao sem loja ativa — o Super Admin que saiu
 *   de uma loja, por exemplo. Nao ha o que restringir, e a situacao da loja
 *   anterior nao pode ficar na tela.
 * - `null`: falha de rede ou do servidor. Quem chama MANTEM o ultimo valor:
 *   trocar por "liberado" desbloquearia uma loja restrita a cada oscilacao.
 */
export async function lerAssinaturaDoServidor(): Promise<
  SituacaoDaAssinatura | 'sem-empresa' | null
> {
  let resposta: Response
  try {
    resposta = await fetch('/api/assinatura', { credentials: 'same-origin' })
  } catch {
    return null
  }
  if (resposta.status === 401 || resposta.status === 403) return 'sem-empresa'
  if (!resposta.ok) return null
  return (await resposta.json().catch(() => null)) as SituacaoDaAssinatura | null
}

/**
 * Espelho de `podeEscrever` do contrato: atrasada AINDA escreve.
 *
 * A tela antiga bloqueava em "overdue" — o oposto da regra. Entre o
 * vencimento e a restricao ha um prazo de tolerancia inteiro (RF-116), e ele
 * so serve se a loja continuar funcionando durante ele.
 */
export function podeEscrever(status: EstadoDaAssinatura | null): boolean {
  return status === null || status === 'trial' || status === 'active' || status === 'overdue'
}

/** Data de um `timestamptz` no fuso de quem olha (o corte em "T" daria o dia em UTC). */
export function diaDoInstante(valor: string): string {
  return formatDate(diaLocal(new Date(valor)))
}

export type Tom = 'positive' | 'warning' | 'negative' | 'neutral'

export type ResumoDaAssinatura = {
  rotulo: string
  detalhe: string
  tom: Tom
}

/**
 * Como a situacao aparece para a LOJA — rotulo curto, detalhe e tom.
 *
 * Num lugar so porque a mesma frase aparece no painel de assinatura e na
 * faixa de aviso; duas versoes divergiriam no primeiro ajuste de texto.
 */
export function resumoDaAssinatura(s: SituacaoDaAssinatura): ResumoDaAssinatura {
  const a = s.subscription

  switch (s.status) {
    case null:
      return {
        rotulo: 'Liberado',
        detalhe: 'acesso completo · a cobrança da mensalidade ainda não começou',
        tom: 'positive',
      }
    case 'trial':
      return {
        rotulo: 'Em teste',
        detalhe:
          a?.trialEndsAt != null
            ? `teste grátis até ${diaDoInstante(a.trialEndsAt)}`
            : 'período de teste grátis',
        tom: 'positive',
      }
    case 'active':
      return {
        rotulo: 'Em dia',
        detalhe:
          a?.nextDueDate != null
            ? `próximo vencimento em ${formatDate(a.nextDueDate)}`
            : 'acesso completo',
        tom: 'positive',
      }
    case 'overdue':
      return {
        rotulo: 'Pagamento atrasado',
        detalhe:
          a?.nextDueDate != null
            ? `venceu em ${formatDate(a.nextDueDate)} · o acesso continua durante a tolerância`
            : 'o acesso continua durante a tolerância',
        tom: 'warning',
      }
    case 'restricted':
      return {
        rotulo: 'Acesso restrito',
        detalhe:
          a?.restrictedAt != null
            ? `desde ${diaDoInstante(a.restrictedAt)} · seus dados continuam salvos`
            : 'seus dados continuam salvos',
        tom: 'negative',
      }
    case 'cancelled':
      return {
        rotulo: 'Assinatura cancelada',
        detalhe: 'seus dados continuam salvos',
        tom: 'negative',
      }
  }
}

/* ------------------------------------------------------------------------
 * Plataforma: quem esta em dia, em teste, atrasado ou restrito.
 * --------------------------------------------------------------------- */

/** Rotulo curto por estado, para a lista da plataforma. */
export const ROTULO_DO_ESTADO: Record<EstadoDaAssinatura | 'sem', string> = {
  trial: 'Em teste',
  active: 'Em dia',
  overdue: 'Atrasada',
  restricted: 'Restrita',
  cancelled: 'Cancelada',
  sem: 'Sem assinatura',
}

export const TOM_DO_ESTADO: Record<EstadoDaAssinatura | 'sem', Tom> = {
  trial: 'neutral',
  active: 'positive',
  overdue: 'warning',
  restricted: 'negative',
  cancelled: 'neutral',
  sem: 'neutral',
}

/**
 * Os filtros da plataforma. "Inadimplentes" junta atrasada e restrita: as
 * duas devem dinheiro, e e a lista que alguem da equipe abre para cobrar.
 */
export type GrupoDeAssinatura = 'todas' | 'inadimplentes' | 'trial' | 'active' | 'cancelled' | 'sem'

export const GRUPOS_DE_ASSINATURA: readonly { valor: GrupoDeAssinatura; rotulo: string }[] = [
  { valor: 'todas', rotulo: 'Todas' },
  { valor: 'inadimplentes', rotulo: 'Inadimplentes' },
  { valor: 'trial', rotulo: 'Em teste' },
  { valor: 'active', rotulo: 'Em dia' },
  { valor: 'cancelled', rotulo: 'Canceladas' },
  { valor: 'sem', rotulo: 'Sem assinatura' },
]

export function estaNoGrupo(status: EstadoDaAssinatura | null, grupo: GrupoDeAssinatura): boolean {
  switch (grupo) {
    case 'todas':
      return true
    case 'inadimplentes':
      return status === 'overdue' || status === 'restricted'
    case 'sem':
      return status === null
    default:
      return status === grupo
  }
}

export function contarPorGrupo(
  estados: readonly (EstadoDaAssinatura | null)[],
): Record<GrupoDeAssinatura, number> {
  const contagem = {} as Record<GrupoDeAssinatura, number>
  for (const { valor } of GRUPOS_DE_ASSINATURA) {
    contagem[valor] = estados.filter((s) => estaNoGrupo(s, valor)).length
  }
  return contagem
}

/** A data que importa para cada estado, na lista da plataforma. */
export function dataQueImporta(e: {
  subscriptionStatus: EstadoDaAssinatura | null
  trialEndsAt: string | null
  nextDueDate: string | null
  restrictedAt: string | null
}): string | null {
  switch (e.subscriptionStatus) {
    case 'trial':
      return e.trialEndsAt === null ? null : `teste até ${diaDoInstante(e.trialEndsAt)}`
    case 'active':
      return e.nextDueDate === null ? null : `vence em ${formatDate(e.nextDueDate)}`
    case 'overdue':
      return e.nextDueDate === null ? null : `venceu em ${formatDate(e.nextDueDate)}`
    case 'restricted':
      return e.restrictedAt === null ? null : `restrita desde ${diaDoInstante(e.restrictedAt)}`
    default:
      return null
  }
}
