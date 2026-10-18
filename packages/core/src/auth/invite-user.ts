import type { InviteUserInput, InvitedUserOutput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite, assertSegundoCanal } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { AuthDeps } from './login.js'

/**
 * Convida usuario e atribui papel — RF-005.
 *
 * Tres portoes, cada um por um motivo diferente:
 *
 * 1. `assertCanWrite` — `accountant` nao cria acesso.
 * 2. `assertSegundoCanal` — convite por WhatsApp NAO, mesmo com o numero
 *    vinculado. Convidar cria credencial nova, e credencial nova a partir de um
 *    canal que o SIM swap entrega e escalada de privilegio: quem roubou o
 *    numero convidaria a si mesmo como `owner` e o roubo deixaria de depender
 *    do chip. Ver ADR-0002.
 * 3. Somente `owner` — `staff` opera a loja, nao decide quem entra nela.
 *
 * O papel possivel ja vem restrito pelo contrato (`grantableRoleSchema` nao
 * inclui `platform_admin`), entao aqui nao ha o que conferir sobre ele.
 */
export async function inviteUser(
  deps: AuthDeps,
  ctx: ExecutionContext,
  input: InviteUserInput,
): Promise<InvitedUserOutput> {
  assertCanWrite(ctx)
  assertSegundoCanal(ctx, 'Convidar usuario')

  if (ctx.role !== 'owner') {
    throw AppError.forbidden('Somente o responsável pela loja pode convidar usuários.')
  }

  const existente =
    (input.email === undefined ? undefined : await deps.users.findByEmail(input.email)) ??
    (input.phone === undefined ? undefined : await deps.users.findByPhone(input.phone))

  /*
   * Pessoa que ja existe ganha VINCULO, e nao um usuario novo.
   *
   * O contador que atende cinco lojas e uma pessoa so — criar uma linha em
   * `users` por loja daria a ele cinco identidades, cinco senhas e cinco
   * historicos de auditoria para a mesma pessoa. O modelo
   * `users ↔ company_users` existe exatamente para isto.
   */
  if (existente !== undefined) {
    if (!existente.isActive) {
      throw AppError.conflict(
        'Esta pessoa tem uma conta desativada. Reative a conta antes de dar acesso.',
      )
    }

    if ((await deps.users.findMembership(ctx.companyId, existente.id)) !== undefined) {
      throw AppError.conflict('Esta pessoa já tem acesso a esta loja.')
    }

    await deps.users.grantAccess({
      companyId: ctx.companyId,
      userId: existente.id,
      role: input.role,
      createdAt: ctx.now,
    })

    await registra(deps, ctx, existente.id, input, false)

    return { userId: existente.id, companyId: ctx.companyId, role: input.role, created: false }
  }

  /*
   * Pessoa e acesso numa operacao so — ver `createUserWithAccess`. Usuario
   * gravado sem vinculo nao entra e ainda ocupa o e-mail no indice unico, o
   * que tornaria o convite impossivel de repetir.
   *
   * Nasce sem `subject`: quem prova a identidade e o provedor, e ele so
   * conhece a pessoa quando ela entra pela primeira vez. O `login` amarra o
   * `subject` nesse momento, por e-mail ou telefone — e e por isso que o
   * convite exige um dos dois.
   */
  const criado = await deps.users.createUserWithAccess({
    companyId: ctx.companyId,
    name: input.name,
    email: input.email ?? null,
    phone: input.phone ?? null,
    role: input.role,
    createdAt: ctx.now,
  })

  await registra(deps, ctx, criado.id, input, true)

  return { userId: criado.id, companyId: ctx.companyId, role: input.role, created: true }
}

/**
 * Auditoria do convite, sem o contato.
 *
 * `email` e `phone` ficam fora do `after` de proposito: a trilha e imutavel
 * (RF-124) e a exclusao da LGPD (RF-127) nao alcanca o que nao pode ser
 * apagado. Guardar contato pessoal ali criaria uma copia que a anonimizacao
 * nao consegue tocar. O `userId` liga a linha a pessoa enquanto ela existir, e
 * e o suficiente para responder "quem deu acesso a quem, quando".
 */
async function registra(
  deps: AuthDeps,
  ctx: ExecutionContext,
  userId: string,
  input: InviteUserInput,
  created: boolean,
): Promise<void> {
  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'User',
    entityId: userId,
    /* `access_granted` entrou no vocabulario na NR-087. Antes era `created`
       com o nome real em `after.event` — e uma consulta por "usuarios criados"
       devolvia tambem quem so ganhou acesso a mais uma loja. */
    action: 'access_granted',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: null,
    after: { role: input.role, userCreated: created },
  })
}
