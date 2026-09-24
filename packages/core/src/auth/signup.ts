import type { SessionOutput, SignupInput } from '@na-regua/contracts'
import { PLANO_DE_CONTAS_PADRAO } from '../accounting/default-chart.js'
import { AppError } from '../app-error.js'
import { recordLegalAcceptance, type OrigemDoAceite } from '../legal/legal-consent.js'
import type { ChartOfAccountsRepository } from '../ports/chart-of-accounts.js'
import type { IdentityRegistrar, SessionIssuer, UserDirectory } from '../ports/identity.js'
import type { LegalConsentRepository } from '../ports/legal-consent-repository.js'
import type { PartnerApplicationRepository } from '../ports/partner-application-repository.js'
import type { CompanyRepository } from '../ports/registration-repositories.js'

/**
 * Cadastro de conta — NR-014, RF-001, RF-002.
 *
 * O primeiro acesso ao sistema: cria a pessoa, a loja e o vinculo entre as
 * duas, e devolve a sessao ja aberta.
 *
 * ## Por que uma chamada so
 *
 * Sao tres escritas, e separa-las em telas diferentes criaria estados que nao
 * servem para nada: pessoa sem loja nao consegue fazer nada, e loja sem dono
 * nao tem quem a conserte. Numa chamada, o desfecho e "entrou" ou "nao entrou".
 *
 * ## O que este caso de uso NAO faz
 *
 * Nao guarda senha. O segredo vai para o provedor de identidade (ADR-0002) e o
 * nosso banco guarda apenas o `subject` que ele devolve. Com um provedor
 * alugado de verdade, este caso de uso perde o passo do registro e passa a
 * receber uma pessoa que ele ja autenticou — o resto continua igual.
 *
 * ## A ordem importa, e nao e arbitraria
 *
 * 1. **CNPJ primeiro.** Recusar antes de criar qualquer coisa; recusar depois
 *    deixaria a credencial no provedor sem loja nenhuma deste lado.
 * 2. **Credencial antes da loja.** E a unica escrita em sistema de TERCEIRO. Se
 *    ela falhar, nada nosso foi criado; se fosse por ultimo, a loja existiria e
 *    a pessoa nao conseguiria entrar — exatamente o defeito que este caso de
 *    uso nasceu para corrigir.
 * 3. Empresa, usuario com acesso, e o plano de contas padrao.
 */

export type SignupDeps = {
  readonly companies: CompanyRepository
  readonly users: UserDirectory
  readonly accounts: ChartOfAccountsRepository
  readonly registrar: IdentityRegistrar
  readonly sessions: SessionIssuer
  /** Candidatura de Parceiro — NR-115, ADR-0013. So chamada quando `account.type === 'parceiro'`. */
  readonly partners: PartnerApplicationRepository
  /** Prova de aceite dos Termos e da Politica — RF-02, LGPD art. 8 §1. */
  readonly legalConsents: LegalConsentRepository
}

/** Quanto tempo a sessao do cadastro vale. Igual a do login. */
const DURACAO_DA_SESSAO_HORAS = 12

export async function signup(
  deps: SignupDeps,
  input: SignupInput,
  agora: Date,
  /**
   * De onde veio o aceite — RF-02. Vem da REQUISICAO, e nunca do corpo que o
   * cliente mandou: IP que o proprio interessado informa nao prova nada.
   */
  origemDoAceite: OrigemDoAceite = {},
): Promise<SessionOutput> {
  /*
   * RF-002: CNPJ repetido e recusado "sem revelar dados da empresa existente".
   * A mensagem fala do que fazer, e nao de quem ja tem o cadastro.
   */
  if (await deps.companies.cnpjTaken(input.cnpj)) {
    throw AppError.conflict(
      'Este CNPJ ja tem cadastro. Se a empresa e sua, peca acesso a quem administra a conta.',
    )
  }

  /*
   * Telefone e nome de cupom tambem sao recusados ANTES de criar qualquer
   * coisa, pelo mesmo motivo do CNPJ. Depois da credencial, cada passo grava
   * sozinho: um telefone repetido estourava o indice unico de `users` (500) e
   * um cupom repetido so era pego na candidatura — nos dois casos a tela dizia
   * "erro" e o banco guardava meia conta. Na nova tentativa, o e-mail ja
   * estava "em uso", e a pessoa ficava presa fora do cadastro.
   *
   * A mensagem do telefone nao confirma que a conta existe — mesmo cuidado do
   * e-mail, logo abaixo.
   */
  if (input.phone !== undefined && (await deps.users.findByPhone(input.phone)) !== undefined) {
    throw AppError.conflict(
      'Nao foi possivel usar este telefone. Se a conta e sua, entre por "Acessar minha conta".',
    )
  }

  if (
    input.account?.type === 'parceiro' &&
    input.account.couponCode !== undefined &&
    (await deps.partners.couponCodeTaken(input.account.couponCode))
  ) {
    throw AppError.conflict('Este nome de cupom ja esta em uso. Escolha outro.')
  }

  const identidade = await deps.registrar.register(
    { identifier: input.email, secret: input.secret },
    { email: input.email, phone: input.phone ?? null },
  )

  /*
   * `undefined` e "este e-mail ja tem credencial". Nao e erro de sistema, e a
   * mensagem NAO confirma que a conta existe — dizer "ja cadastrado" a quem
   * digitou um e-mail alheio transformaria o formulario em consultor de contas.
   */
  if (identidade === undefined) {
    throw AppError.conflict(
      'Nao foi possivel usar este e-mail. Se a conta e sua, entre por "Acessar minha conta".',
    )
  }

  const empresa = await deps.companies.create({
    legalName: input.legalName,
    tradeName: input.legalName,
    cnpj: input.cnpj,
    email: input.email,
    phone: input.phone ?? '',
    createdAt: agora,
  })

  /* `owner`: quem cadastra a loja e dono dela. Papel menor deixaria a empresa
     sem ninguem que possa convidar o segundo usuario. */
  const usuario = await deps.users.createUserWithAccess({
    companyId: empresa.id,
    name: input.name,
    email: input.email,
    phone: input.phone ?? null,
    role: 'owner',
    createdAt: agora,
  })

  /*
   * O plano de contas padrao — RF-081.
   *
   * Fora de transacao com o resto, como no `registerCompany`: se falhar, a
   * conta existe e o plano fica vazio, o que e visivel e recuperavel a mao.
   * Perder o cadastro inteiro por causa do plano seria pior.
   */
  await deps.accounts.insertDefaults(empresa.id, PLANO_DE_CONTAS_PADRAO, usuario.id, agora)

  /*
   * A prova do aceite — RF-02, LGPD art. 8 §1.
   *
   * Que a pessoa aceitou ja esta garantido pelo contrato (`acceptedLegalTerms`
   * e `literal(true)`); o que se escreve aqui e a PROVA: qual versao, quando,
   * de onde. Antes disto o aceite era so um checkbox que morria no navegador.
   *
   * Fora da transacao do resto, como o plano de contas — e aqui isso custa
   * menos que parece: se falhar, `pendingLegalAcceptance` vai encontrar o
   * documento como pendente no proximo acesso e pedir o aceite de novo. A
   * falha se conserta sozinha pelo mesmo caminho do reaceite de versao nova.
   */
  await recordLegalAcceptance(deps, usuario.id, origemDoAceite)

  /*
   * Candidatura de Parceiro — NR-115, ADR-0013.
   *
   * Tambem fora da transacao do resto, mesmo raciocinio do plano de contas:
   * se falhar aqui, a conta ja existe e funciona como lojista normalmente —
   * a pessoa so precisa se candidatar de novo depois, o que e recuperavel.
   * Perder o cadastro inteiro por causa da candidatura seria pior.
   */
  if (input.account?.type === 'parceiro') {
    await deps.partners.submit({
      ownerUserId: usuario.id,
      ownerCompanyId: empresa.id,
      pixKey: input.account.pixKey,
      pixKeyType: input.account.pixKeyType,
      message: input.account.message,
      couponCode: input.account.couponCode,
    })
  }

  const expiraEm = new Date(agora.getTime() + DURACAO_DA_SESSAO_HORAS * 3_600_000)
  const token = await deps.sessions.issue(
    { userId: usuario.id, companyId: empresa.id, role: 'owner' },
    expiraEm,
  )

  /*
   * Devolve a sessao ABERTA, e nao "cadastrado com sucesso".
   *
   * Quem acabou de cadastrar quer usar o sistema, e mandar para a tela de login
   * digitar de novo o que digitou ha dois segundos e trocar uma tela por duas.
   * A empresa ja vem ativa porque so existe uma — nao ha o que escolher.
   */
  return {
    token,
    expiresAt: expiraEm.toISOString(),
    userId: usuario.id,
    userName: usuario.name,
    memberships: [{ companyId: empresa.id, companyName: empresa.tradeName, role: 'owner' }],
    activeCompanyId: empresa.id,
    isPlatformAdmin: false,
  }
}
