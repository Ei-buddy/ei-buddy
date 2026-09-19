import type { CompanyOutput, CreateCompanyInput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import { PLANO_DE_CONTAS_PADRAO } from '../accounting/default-chart.js'
import type { ChartOfAccountsRepository } from '../ports/chart-of-accounts.js'
import type { CepLookup } from '../ports/cep-lookup.js'
import type { CompanyRepository } from '../ports/registration-repositories.js'
import { startTrial, type StartTrialDeps } from '../subscriptions/start-trial.js'
import { resolveCoordinates } from './geocoding.js'

export type RegisterCompanyDeps = {
  readonly companies: CompanyRepository
  readonly accounts: ChartOfAccountsRepository
  readonly cepLookup: CepLookup
  /**
   * Comeca o periodo de teste junto com a empresa — RF-110.
   *
   * Opcional, e pelo mesmo criterio de `SECRETS_KEY`: os prazos vem de
   * configuracao (QST-002, ainda aberta), e sem eles o cadastro continua
   * funcionando — a empresa nasce sem assinatura, que e o estado que
   * `getSubscription` ja trata como "pode lancar". Uma funcionalidade a
   * menos e melhor que um cadastro que nao conclui.
   */
  readonly assinatura?: StartTrialDeps | undefined
}

/**
 * Cadastra a empresa — RF-001, RF-002.
 *
 * Nao chama `assertCanWrite`: quem cria a empresa ainda nao tem papel NELA,
 * porque ela nao existe. Este e o unico caso de uso de escrita do sistema em
 * que isso vale, e por isso esta escrito aqui em vez de subentendido. Quem
 * pode chamar e assunto da rota de onboarding (DEC-008), nao do papel de
 * tenant.
 *
 * O preenchimento automatico de razao social e endereco a partir do CNPJ, que a
 * RF-001 tambem pede, depende de um servico externo de consulta e ainda nao tem
 * porta nem decisao. Ele vem antes deste caso de uso, na borda: aqui os dados
 * chegam prontos, validados por `contracts`.
 */
export async function registerCompany(
  deps: RegisterCompanyDeps,
  ctx: ExecutionContext,
  input: CreateCompanyInput,
): Promise<CompanyOutput> {
  /*
   * RF-002 pede recusar CNPJ repetido "sem revelar dados da empresa
   * existente". Por isso a porta responde se EXISTE, e nao qual e: com a linha
   * em maos, a tentacao de por a razao social na mensagem ("Ja cadastrada como
   * MERCEARIA DO JOAO LTDA") seria grande, e ela transformaria o formulario num
   * consultor de CNPJ para qualquer um.
   */
  if (await deps.companies.cnpjTaken(input.cnpj)) {
    throw AppError.conflict(
      'Este CNPJ ja tem cadastro. Se a empresa e sua, peca acesso a quem administra a conta.',
    )
  }

  const coordinates = await resolveCoordinates(deps.cepLookup, input.address)

  const empresa = await deps.companies.create({
    legalName: input.legalName,
    tradeName: input.tradeName,
    cnpj: input.cnpj,
    email: input.email,
    phone: input.phone,
    stateRegistration: input.stateRegistration,
    municipalRegistration: input.municipalRegistration,
    businessSegment: input.businessSegment,
    address: input.address,
    coordinates,
    createdAt: ctx.now,
  })

  /*
   * O plano de contas padrao nasce com a empresa — RF-081.
   *
   * Para que o lojista NUNCA veja a tela de classificacao vazia. Plano em
   * branco e uma pergunta que ele nao sabe responder ("que contas eu tenho?"),
   * e a resposta pratica e nao classificar nada — o que transforma o DRE num
   * relatorio de uma linha so.
   *
   * Fora da transacao que cria a empresa, porque `companies.create` e um
   * insert proprio e a porta nao tem unidade de trabalho. Se a semeadura
   * falhar, a empresa existe com o plano vazio: visivel, recuperavel, e o
   * lojista pode criar as contas a mao (RF-082). Perder o cadastro por causa
   * do plano seria pior. `insertDefaults` e idempotente justamente para que
   * refazer seja seguro.
   */
  await deps.accounts.insertDefaults(empresa.id, PLANO_DE_CONTAS_PADRAO, ctx.userId, ctx.now)

  /*
   * O periodo de teste comeca aqui — RF-110.
   *
   * Fora da criacao da empresa e depois dela, pelo mesmo desenho (e a mesma
   * razao) da semeadura do plano de contas: se isto falhar, a empresa existe
   * sem assinatura — visivel, recuperavel, e reexecutavel porque
   * `startTrial` e idempotente. Perder o cadastro por causa do teste seria
   * pior que comecar o teste um minuto depois.
   */
  if (deps.assinatura !== undefined) {
    await startTrial(deps.assinatura, { companyId: empresa.id, criadaEm: ctx.now })
  }

  return empresa
}
