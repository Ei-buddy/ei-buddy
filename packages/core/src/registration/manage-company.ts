import type { CompanyOutput, UpdateCompanyInput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { CepLookup } from '../ports/cep-lookup.js'
import type { CompanyRepository } from '../ports/registration-repositories.js'
import { resolveCoordinates } from './geocoding.js'

export type ManageCompanyDeps = {
  readonly companies: CompanyRepository
  readonly cepLookup: CepLookup
  /** Trilha — RF-123. Opcional para os testes de regra; a composicao entrega. */
  readonly audit?: AuditTrail
}

/**
 * O cadastro da propria loja — RF-003.
 *
 * Nao recebe id: a empresa e a do contexto, e sempre sera. Aceitar um id
 * abriria uma rota para ler o cadastro de outra loja se a RLS um dia falhasse
 * — e o parametro que nao existe e o que nao pode ser usado errado.
 *
 * Leitura: nao passa por `assertCanWrite`. `accountant` precisa do CNPJ e das
 * inscricoes para fechar o mes.
 */
export async function getCompany(
  deps: ManageCompanyDeps,
  ctx: ExecutionContext,
): Promise<CompanyOutput> {
  const empresa = await deps.companies.findById(ctx.companyId)

  if (empresa === undefined) {
    /*
     * Nao deveria acontecer: quem tem sessao com empresa tem empresa. Se
     * acontecer, e sinal de linha apagada ou sessao de um tenant que sumiu, e
     * responder 404 e melhor que devolver um cadastro em branco que a tela
     * salvaria por cima.
     */
    throw AppError.notFound('Empresa nao encontrada.')
  }

  return empresa
}

/**
 * Atualiza o cadastro da loja — RF-003.
 *
 * ## O CNPJ nao muda
 *
 * Ele nem chega aqui: `updateCompanyInputSchema` o omite. Trocar CNPJ nao e
 * corrigir um cadastro, e apontar para outra empresa — e as notas emitidas, os
 * recebiveis e a trilha de auditoria continuariam apontando para a anterior.
 * Quem digitou errado no cadastro abre chamado; quem mudou de CNPJ abre outra
 * loja.
 *
 * ## Campo ausente e "nao mexa"
 *
 * A entrada e parcial e cada campo ausente fica como esta. Tratar ausente como
 * "apague" faria a tela de endereco, ao salvar, limpar a inscricao estadual
 * que a aba fiscal tinha preenchido.
 */
export async function updateCompany(
  deps: ManageCompanyDeps,
  ctx: ExecutionContext,
  input: UpdateCompanyInput,
): Promise<CompanyOutput> {
  assertCanWrite(ctx)

  /*
   * Corpo vazio e recusado em vez de virar uma escrita sem efeito. Um PUT que
   * responde 200 sem ter mudado nada e indistinguivel de um que funcionou, e
   * quem esta depurando um formulario que "nao salva" perde a tarde nisso.
   */
  if (Object.keys(input).length === 0) {
    throw AppError.validation('Nada para atualizar.', [
      { path: 'legalName', message: 'Informe ao menos um campo.' },
    ])
  }

  const coordinates = await resolveCoordinates(deps.cepLookup, input.address)

  const atualizada = await deps.companies.update(ctx.companyId, {
    ...input,
    ...(coordinates === undefined ? {} : { coordinates }),
  })

  /* Quais campos mudaram — "quem trocou o endereco da loja?". */
  await deps.audit?.record({
    companyId: ctx.companyId,
    entity: 'Company',
    entityId: ctx.companyId,
    action: 'updated',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: null,
    after: { campos: Object.keys(input).sort() },
  })

  return atualizada
}
