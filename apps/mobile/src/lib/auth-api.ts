import { chamarApi } from './api'
import { abrirSessao, encerrarSessao, type LojaDaSessao } from './session'
/**
 * ============================================================================
 * PONTOS DE INTEGRACAO — AUTENTICACAO (MOBILE)
 * ============================================================================
 *
 *  | Funcao  | Endpoint esperado | Disparo         |
 *  |---------|-------------------|-----------------|
 *  | entrar  | POST /auth/login  | submit do login |
 *
 * O mobile NAO tem criacao de conta nem fluxo de assinatura. Contratar o
 * plano, pagar e regularizar pendencia sao tarefas de retaguarda e ficam
 * so no web — aqui o lojista entra com uma conta que ja existe.
 */

/**
 * O desfecho do login, como UNIAO de TRES estados.
 *
 * Tres e nao dois, porque "entrou" e "falta escolher a loja" sao situacoes
 * diferentes e a tela faz coisas diferentes com elas. Espremer as duas num
 * `ok: true` obrigaria a tela a adivinhar pelo conteudo — e foi por nao existir
 * esse terceiro estado que a versao anterior simplesmente ESCOLHIA a primeira
 * loja sozinha.
 *
 * Nenhum deles devolve o usuario: quem precisa dele le a sessao, que ja foi
 * gravada. O `Usuario` que existia aqui nao era lido por ninguem.
 */
export type ResultadoLogin =
  | { estado: 'pronto' }
  | { estado: 'escolher-loja'; nome: string; lojas: readonly LojaDaSessao[] }
  | { estado: 'falhou'; erro: string }
  /** Super Admin sem loja propria: vai para a area da plataforma. */
  | { estado: 'plataforma' }

type SessaoDaApi = {
  token: string
  userId: string
  userName: string
  memberships: { companyId: string; companyName: string; role: string }[]
  activeCompanyId: string | null
  isPlatformAdmin: boolean
}

/**
 * Entra — RF-119, RF-120, US-059.
 *
 * ## A loja deixou de ser sorteada
 *
 * Quem tem acesso a mais de uma loja caia na PRIMEIRA da lista, em silencio. O
 * comentario que estava aqui tratava isso como tela faltando; a consequencia e
 * maior. O contador que atende cinco lojas entrava numa qualquer, e a venda ou
 * a conta que ele lancasse ia para a empresa errada — com o isolamento por RLS
 * funcionando perfeitamente, o que torna o erro INVISIVEL: nada falha, nada
 * avisa, o dado so esta no lugar errado.
 *
 * Agora quem pergunta e a tela, como no web.
 *
 * A mensagem de falha e a MESMA para usuario inexistente e senha errada, e vem
 * da api — RF-120 pede nao revelar se a conta existe, e reescrever aqui
 * desfaria isso.
 */
export async function entrar(credencial: string, senha: string): Promise<ResultadoLogin> {
  const r = await chamarApi<SessaoDaApi>('/auth/login', {
    method: 'POST',
    body: { identifier: credencial, secret: senha },
  })

  if (!r.ok) return { estado: 'falhou', erro: r.message }

  const sessao = r.dados

  if (sessao.memberships.length === 0 && sessao.isPlatformAdmin) {
    await gravar(sessao, null)
    return { estado: 'plataforma' }
  }

  if (sessao.memberships.length === 0) {
    return {
      estado: 'falhou',
      erro: 'Sua conta ainda não está ligada a nenhuma loja. Fale com quem administra.',
    }
  }

  /*
   * O token da PRIMEIRA resposta ja precisa estar guardado, mesmo com a loja
   * ainda por escolher: a chamada de escolher e autenticada, e sem isso ela
   * sairia sem `Authorization` e receberia 401.
   *
   * `empresaId: null` marca o meio do caminho. Se o app fechar aqui, a porta de
   * entrada ve o nulo e devolve a pessoa para a escolha, em vez de abrir o
   * painel sem empresa e falhar em toda chamada.
   */
  await gravar(sessao, null)

  if (sessao.activeCompanyId === null) {
    return { estado: 'escolher-loja', nome: sessao.userName, lojas: sessao.memberships }
  }

  /* Uma loja so: a api ja escolheu, e perguntar entre uma opcao e cerimonia. */
  await gravar(sessao, sessao.activeCompanyId)
  return { estado: 'pronto' }
}

/**
 * Fecha a sessao numa loja — US-059.
 *
 * Exportada porque serve a dois momentos: a escolha logo apos o login e a troca
 * de loja pelo menu. Sao a mesma operacao, e duas implementacoes seriam duas
 * chances de divergir.
 */
export async function escolherLoja(companyId: string): Promise<ResultadoLogin> {
  const r = await chamarApi<SessaoDaApi>('/auth/select-company', {
    method: 'POST',
    body: { companyId },
  })

  if (!r.ok) return { estado: 'falhou', erro: r.message }

  await gravar(r.dados, r.dados.activeCompanyId)
  return { estado: 'pronto' }
}

/**
 * Sair — NR-083, RF-119.
 *
 * ## Duas metades, e faltava a primeira
 *
 * `encerrarSessao` apaga o perfil e o token do aparelho, e isso continua sendo
 * necessario. O que faltava era AVISAR o servidor: o token seguia valido pelas
 * doze horas restantes, e quem tivesse uma copia dele continuava dentro depois
 * de a pessoa tocar em "Sair".
 *
 * ## A api primeiro, o aparelho depois
 *
 * Nesta ordem porque a chamada precisa do token, e `encerrarSessao` o apaga. Ao
 * contrario, a revogacao sairia sem `Authorization` e o servidor nao saberia
 * qual sessao encerrar.
 *
 * ## Falha da api nao impede sair
 *
 * No balcao o sinal cai, e nao sair porque a rede falhou seria deixar a sessao
 * aberta no aparelho — o oposto do que a pessoa pediu. O `catch` implicito esta
 * em `chamarApi`, que devolve resultado em vez de lancar; o resultado e
 * ignorado de proposito.
 */
export async function sair(): Promise<void> {
  await chamarApi('/auth/logout', { method: 'POST' })
  await encerrarSessao()
}

/* -------------------------------------------------------------------------- */
/* Criar conta e recuperar senha — as mesmas rotas publicas do web            */
/* -------------------------------------------------------------------------- */

export type ResultadoDoCupom =
  | { valido: true; codigo: string; parceiro: string; beneficio: string }
  | { valido: false; mensagem: string }

/** Confere o cupom de indicacao antes de criar a conta — RF-114. */
export async function conferirCupom(codigo: string): Promise<ResultadoDoCupom> {
  const r = await chamarApi<
    | { status: 'valid'; code: string; referrerLabel: string; discountPercent: number }
    | { status: 'rejected'; rejection: { message: string } }
  >(`/cupons/${encodeURIComponent(codigo.trim())}`)
  if (!r.ok) {
    return {
      valido: false,
      mensagem:
        r.status === 429
          ? 'Muitas tentativas. Espere um minuto e tente de novo.'
          : 'Não foi possível conferir o cupom agora.',
    }
  }
  if (r.dados.status === 'rejected') return { valido: false, mensagem: r.dados.rejection.message }
  return {
    valido: true,
    codigo: r.dados.code,
    parceiro: r.dados.referrerLabel,
    beneficio: `${String(r.dados.discountPercent).replace('.', ',')}% de desconto na primeira mensalidade`,
  }
}

export type DadosDaConta = {
  nome: string
  email: string
  celular: string
  senha: string
  razaoSocial: string
  cnpj: string
  /** So o cupom que a tela ja conferiu como valido. */
  cupom: string | null
  /** Conta de Parceiro (indicador) — NR-115. Ausente = lojista. */
  parceiro?: {
    pixKey: string
    pixKeyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP'
    message: string
    couponCode?: string
  }
}

/**
 * Cria a conta e a loja — RF-001, a mesma rota do web. Quem chega aqui ja
 * aceitou os termos na tela; a conta nasce logada.
 */
export async function criarConta(dados: DadosDaConta): Promise<ResultadoLogin> {
  const celular = dados.celular.replace(/\D/g, '')
  const r = await chamarApi<SessaoDaApi>('/auth/signup', {
    method: 'POST',
    body: {
      name: dados.nome.trim(),
      email: dados.email.trim(),
      ...(celular === '' ? {} : { phone: celular }),
      secret: dados.senha,
      legalName: dados.razaoSocial.trim(),
      cnpj: dados.cnpj.replace(/\D/g, ''),
      acceptedLegalTerms: true,
      ...(dados.cupom === null ? {} : { referralCode: dados.cupom }),
      ...(dados.parceiro === undefined ? {} : { account: { type: 'parceiro', ...dados.parceiro } }),
    },
  })

  if (!r.ok) {
    /* A mensagem do CAMPO quando existe: "confira os campos" nao diz qual. */
    const doCampo = (r.corpo as { error?: { fields?: { message: string }[] } } | null)?.error
      ?.fields?.[0]?.message
    return { estado: 'falhou', erro: doCampo ?? r.message }
  }

  await gravar(r.dados, r.dados.activeCompanyId)
  return { estado: 'pronto' }
}

/**
 * Pede o link de nova senha por e-mail. A resposta e a mesma exista ou nao a
 * conta: dizer "esse e-mail nao existe" entregaria quem e cliente.
 */
export async function recuperarSenha(
  email: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const r = await chamarApi<undefined>('/auth/recuperar-senha', {
    method: 'POST',
    body: { email: email.trim() },
  })
  return r.ok ? { ok: true } : { ok: false, erro: r.message }
}

/** Grava perfil e token. `empresaId` nulo e o estado de "falta escolher". */
async function gravar(sessao: SessaoDaApi, empresaId: string | null): Promise<void> {
  const ativa = sessao.memberships.find((m) => m.companyId === empresaId)

  await abrirSessao(
    {
      userId: sessao.userId,
      nome: sessao.userName,
      empresa: ativa?.companyName ?? '',
      empresaId,
      lojas: sessao.memberships,
      admin: sessao.isPlatformAdmin === true,
    },
    sessao.token,
  )
}
