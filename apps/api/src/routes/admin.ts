import {
  enterCompanyInputSchema,
  grantPlatformAdminInputSchema,
  platformUserQuerySchema,
  supportInboxQuerySchema,
  supportReplyInputSchema,
  testEmailInputSchema,
} from '@na-regua/contracts'
import {
  AppError,
  closeSupportTicket,
  enterCompany,
  getSupportInboxTicket,
  listSupportInbox,
  replyAsSupport,
  exitCompany,
  grantPlatformAdmin,
  revokePlatformAdmin,
  listPlatformAdmins,
  listPlatformCompanies,
  listPlatformUsers,
  sendTestEmail,
  type EmailTester,
  type IdentityRegistrar,
  type PlatformAdminAccess,
  type SessionClaims,
  type SessionIssuer,
  type SupportInbox,
  type UserDirectory,
} from '@na-regua/core'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { lerToken } from '../plugins/session.js'
import { validate } from '../plugins/validate.js'

/**
 * Rotas do Super Admin — ADR-0007, RF-131.
 *
 * Nenhuma exige `requireContext`: entrar/sair/listar empresas acontece ANTES
 * ou DEPOIS de haver empresa ativa, e uma sessao de Super Admin pode nao ter
 * nenhuma no momento em que pede a lista. O que toda rota aqui exige e
 * `request.sessionClaims` — a mesma exigencia de `/auth/select-company`.
 */

export type AdminRouteDeps = {
  readonly platformAdmin: PlatformAdminAccess
  readonly sessions: SessionIssuer
  readonly users: UserDirectory
  readonly registrar: IdentityRegistrar
  /** Envio de teste com o motivo da falha — achado do QA. */
  readonly emailTester: EmailTester
  /** Os chamados de todas as lojas — NR-215. */
  readonly supportInbox: SupportInbox
}

function sessaoOuFalha(request: FastifyRequest): SessionClaims {
  const claims = request.sessionClaims
  if (claims === undefined) {
    throw AppError.unauthorized('Entre na sua conta para continuar.')
  }
  return claims
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps): void {
  const usoDeps = {
    access: deps.platformAdmin,
    sessions: deps.sessions,
    users: deps.users,
    registrar: deps.registrar,
  }

  /**
   * Quem tem conta na plataforma — NR-121.
   *
   * Vizinha de `/admin/super-admins` e nao a mesma rota: aquela lista quem JA
   * tem o acesso, esta lista a quem ele pode ser dado. A promocao continua
   * saindo por `POST /admin/super-admins`, que e onde a concessao fica
   * registrada com `granted_by`.
   */
  app.get('/admin/usuarios', async (request, reply) => {
    const sessao = sessaoOuFalha(request)

    const input = validate(platformUserQuerySchema, request.query ?? {})
    const pagina = await listPlatformUsers(usoDeps, sessao.userId, input)

    return reply.code(200).send(pagina)
  })

  /**
   * Envio de teste de e-mail — achado do QA ("os e-mails nao funcionam").
   *
   * Responde 200 mesmo quando o e-mail nao sai: o resultado do teste e a
   * resposta (`sent`, `mode`, `reason`), e nao um erro da rota.
   */
  app.post('/admin/email-teste', async (request, reply) => {
    const sessao = sessaoOuFalha(request)
    const input = validate(testEmailInputSchema, request.body)
    return reply.code(200).send(await sendTestEmail(deps, sessao.userId, input))
  })

  /**
   * Toda empresa cadastrada — a visao geral do Super Admin.
   */
  app.get('/admin/empresas', async (request, reply) => {
    const sessao = sessaoOuFalha(request)
    const empresas = await listPlatformCompanies(usoDeps, sessao.userId)
    return reply.code(200).send({ companies: empresas })
  })

  /**
   * Entrar numa empresa — RF-131.
   *
   * Devolve a sessao no MESMO formato de `/auth/select-company`: o token nao
   * muda, so o que ele significa. O corpo confirma `activeCompanyId` para o
   * cliente atualizar a tela sem precisar de outra chamada.
   */
  app.post('/admin/entrar', async (request, reply) => {
    const sessao = sessaoOuFalha(request)
    const input = validate(enterCompanyInputSchema, request.body)
    const token = lerToken(request)
    if (token === undefined) throw AppError.unauthorized('Entre na sua conta para continuar.')

    const claims = await enterCompany(usoDeps, sessao, token, input)

    return reply.code(200).send({
      activeCompanyId: claims.companyId,
      role: claims.companyId === null ? null : claims.role,
    })
  })

  /** Sai do modo Super Admin — devolve a sessao ao estado sem empresa. */
  app.post('/admin/sair', async (request, reply) => {
    sessaoOuFalha(request)
    const token = lerToken(request)
    if (token === undefined) throw AppError.unauthorized('Entre na sua conta para continuar.')

    const claims = await exitCompany(usoDeps, token)

    return reply.code(200).send({ activeCompanyId: claims.companyId })
  })

  /** Quem e Super Admin hoje. */
  app.get('/admin/super-admins', async (request, reply) => {
    const sessao = sessaoOuFalha(request)
    const admins = await listPlatformAdmins(usoDeps, sessao.userId)
    return reply.code(200).send({ admins })
  })

  /**
   * Concede Super Admin — a alguem que ja tem conta, ou a alguem novo.
   *
   * 201 quando cria conta nova (o corpo traz `temporaryPassword`, UMA vez);
   * 200 quando so concedeu a capacidade a quem ja existia.
   */
  app.post('/admin/super-admins', async (request, reply) => {
    const sessao = sessaoOuFalha(request)
    const input = validate(grantPlatformAdminInputSchema, request.body)

    const resultado = await grantPlatformAdmin(usoDeps, sessao.userId, input)

    return reply.code(resultado.created ? 201 : 200).send(resultado)
  })

  /**
   * Tira o acesso de Super Admin — ADR-0007.
   *
   * `DELETE` e nao `POST /revogar`: e a remocao de um recurso que o `GET`
   * acima lista, e o verbo ja diz o que faz. A linha no banco nao some (ganha
   * `revoked_by`/`revoked_at`) — quem teve o maior privilegio do sistema e
   * quando o perdeu e o que a auditoria precisa depois.
   */
  app.delete('/admin/super-admins/:userId', async (request, reply) => {
    const sessao = sessaoOuFalha(request)
    const { userId } = request.params as { userId: string }

    await revokePlatformAdmin(usoDeps, sessao.userId, userId)

    return reply.code(204).send()
  })

  /* ------------------------------------------------------------------ *
   * Chamados de todas as lojas — NR-215.
   *
   * Achado do QA: "Suporte — como enxergaremos os chamados?". A equipe
   * EiBuddy ve a fila, responde como "Suporte EiBuddy" e encerra.
   * ------------------------------------------------------------------ */
  const filaDeps = { access: deps.platformAdmin, inbox: deps.supportInbox }

  app.get('/admin/chamados', async (request, reply) => {
    const sessao = sessaoOuFalha(request)
    const query = validate(supportInboxQuerySchema, request.query ?? {})
    return reply.code(200).send(await listSupportInbox(filaDeps, sessao.userId, query))
  })

  app.get('/admin/chamados/:id', async (request, reply) => {
    const sessao = sessaoOuFalha(request)
    const { id } = request.params as { id: string }
    return reply.code(200).send(await getSupportInboxTicket(filaDeps, sessao.userId, id))
  })

  app.post('/admin/chamados/:id/respostas', async (request, reply) => {
    const sessao = sessaoOuFalha(request)
    const { id } = request.params as { id: string }
    const input = validate(supportReplyInputSchema, request.body)
    return reply.code(201).send(await replyAsSupport(filaDeps, sessao.userId, id, input))
  })

  app.post('/admin/chamados/:id/encerrar', async (request, reply) => {
    const sessao = sessaoOuFalha(request)
    const { id } = request.params as { id: string }
    return reply.code(200).send(await closeSupportTicket(filaDeps, sessao.userId, id))
  })
}
