import { z } from 'zod'
import {
  dateTimeSchema,
  emailSchema,
  idSchema,
  nameSchema,
  phoneSchema,
  roleSchema,
} from '../common/primitives.js'
import { cnpjSchema } from '../common/document.js'
import { partnerAccountFieldsSchema } from '../partners/partner.js'

/** Autenticacao, sessao e convite — RF-005, RF-119, RF-120. */

/**
 * A credencial, sem saber de que tipo ela e.
 *
 * `identifier` + `secret` cobre senha (e-mail + senha) e codigo por mensagem
 * (telefone + codigo) com a mesma forma. A alternativa era uma uniao
 * discriminada por tipo de credencial, e ela vazaria para o contrato uma
 * escolha que a [ADR-0002](../../../docs/decisoes/adr/0002-autenticacao-identidade-propria.md)
 * deliberadamente deixou para tras da porta: quem prova a identidade nao muda
 * a forma do pedido de login.
 *
 * Sem `.trim()` no segredo: espaco no comeco ou no fim pode ser parte da senha,
 * e aparar silenciosamente faria uma senha valida ser recusada sem explicacao.
 */
export const credentialSchema = z
  .object({
    identifier: z
      .string()
      .trim()
      .min(1, 'Informe seu e-mail ou telefone.')
      .max(180, 'Identificador muito longo.'),
    secret: z.string().min(1, 'Informe sua senha.').max(200, 'Senha muito longa.'),
  })
  .strict()

export type Credential = z.infer<typeof credentialSchema>

export const loginInputSchema = credentialSchema

export type LoginInput = z.infer<typeof loginInputSchema>

/** Uma loja a que a pessoa tem acesso, com o papel que ela tem la. */
export const membershipOutputSchema = z.object({
  companyId: idSchema,
  companyName: z.string(),
  role: roleSchema,
})

export type MembershipOutput = z.infer<typeof membershipOutputSchema>

/**
 * A sessao emitida por nos — nunca um token de terceiro repassado.
 *
 * `activeCompanyId` nulo e estado legitimo e nao erro: quem tem acesso a mais
 * de uma loja entra e **depois** escolhe (US-059). Enquanto for nulo, rota de
 * negocio nenhuma funciona — nao existe operacao sem empresa.
 */
export const sessionOutputSchema = z.object({
  token: z.string(),
  expiresAt: dateTimeSchema,
  userId: idSchema,
  userName: z.string(),
  memberships: z.array(membershipOutputSchema),
  activeCompanyId: idSchema.nullable(),
  /**
   * Explicito, e nao inferido de `memberships.length === 0` — ADR-0007.
   *
   * E verdade hoje so nesse caso (Super Admin nao tem vinculo de loja), mas
   * deixar quem le o contrato deduzir isso e pedir para adivinhar uma regra
   * de negocio a partir da ausencia de dado. Um campo com nome diz a mesma
   * coisa sem exigir a deducao.
   */
  isPlatformAdmin: z.boolean(),
})

export type SessionOutput = z.infer<typeof sessionOutputSchema>

export const selectCompanyInputSchema = z.object({ companyId: idSchema }).strict()

export type SelectCompanyInput = z.infer<typeof selectCompanyInputSchema>

/**
 * Papel que se pode conceder a alguem — RF-005.
 *
 * `platform_admin` fica de fora: ele nao e operador de loja, e conceder por
 * esta rota deixaria um lojista criar acesso de plataforma. Quem rege esse
 * papel e a RF-131, que e outra regra.
 */
export const grantableRoleSchema = z.enum(['owner', 'staff', 'accountant'], {
  error: 'Papel invalido. Use owner, staff ou accountant.',
})

export type GrantableRole = z.infer<typeof grantableRoleSchema>

/**
 * Convite por e-mail **ou** telefone — RF-005.
 *
 * Os dois opcionais com pelo menos um obrigatorio, e nao um campo `contato`
 * unico: e-mail e telefone tem validacao e normalizacao diferentes, e um campo
 * que aceita os dois precisaria adivinhar qual e para validar — adivinhacao que
 * erra em telefone com formato de e-mail truncado.
 */
export const inviteUserInputSchema = z
  .object({
    name: nameSchema,
    email: z.string().trim().toLowerCase().email('E-mail invalido. Confira o endereco.').optional(),
    phone: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .refine((d) => d.length === 10 || d.length === 11, {
        message: 'Telefone invalido. Use DDD e numero.',
      })
      .optional(),
    role: grantableRoleSchema,
  })
  .strict()
  .refine((v) => v.email !== undefined || v.phone !== undefined, {
    message: 'Informe e-mail ou telefone para enviar o convite.',
    path: ['email'],
  })

export type InviteUserInput = z.infer<typeof inviteUserInputSchema>

export const invitedUserOutputSchema = z.object({
  userId: idSchema,
  companyId: idSchema,
  role: roleSchema,
  /** Falso quando a pessoa ja existia e so ganhou acesso a esta loja. */
  created: z.boolean(),
})

export type InvitedUserOutput = z.infer<typeof invitedUserOutputSchema>

/**
 * Tipo de conta escolhido no cadastro — NR-115, ADR-0013.
 *
 * `lojista` e o default (a UI so mostra a escolha, campo `account` inteiro e
 * opcional abaixo) — quem nao escolhe nada continua exatamente com o
 * cadastro de sempre. `parceiro` exige os campos extras do prompt de conta de
 * parceiro: chave PIX, mensagem e (opcional) o nome do cupom dele.
 */
export const signupAccountSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lojista') }).strict(),
  z
    .object({ type: z.literal('parceiro') })
    .strict()
    .extend(partnerAccountFieldsSchema.shape),
])

export type SignupAccount = z.infer<typeof signupAccountSchema>

/**
 * Cadastro de conta — NR-014, RF-001, RF-002.
 *
 * Pessoa e empresa juntas, numa chamada so. Sao dois cadastros no banco, e
 * separa-los em duas telas criaria o estado em que existe uma pessoa sem loja
 * ou uma loja sem dono — os dois inuteis, e o segundo sem ninguem que possa
 * consertar.
 */
export const signupInputSchema = z
  .object({
    /* Quem vai operar. */
    name: nameSchema,
    email: emailSchema,
    phone: phoneSchema.optional(),
    /**
     * O segredo vai para o PROVEDOR de identidade, nunca para o nosso banco.
     *
     * Comprimento minimo aqui e nao no provedor porque a mensagem precisa
     * chegar ao formulario junto dos outros campos — recusar depois, na
     * chamada externa, faria a pessoa perder o que digitou.
     */
    secret: z.string().min(8, 'A senha precisa de ao menos 8 caracteres.').max(200),

    /* A loja. */
    legalName: z.string().trim().min(2, 'Informe a razao social.').max(200),
    cnpj: cnpjSchema,

    /**
     * Ausente = lojista (NR-115). O tipo `parceiro` deixa a conta em analise
     * (ADR-0013) — a sessao devolvida no cadastro ja funciona normalmente
     * como lojista, so o cupom de indicacao fica inativo ate a aprovacao.
     */
    account: signupAccountSchema.optional(),
  })
  .strict()

export type SignupInput = z.infer<typeof signupInputSchema>

/**
 * Super Admin — ADR-0007, RF-131.
 *
 * "Entrar como" exige justificativa: e o que transforma acesso cross-tenant
 * de bypass cru em acesso auditado. Sem minimo, "." passaria e a trilha
 * ficaria tao vazia quanto sem justificativa nenhuma.
 */
export const enterCompanyInputSchema = z
  .object({
    companyId: idSchema,
    justification: z
      .string()
      .trim()
      .min(10, 'Explique em poucas palavras por que esta entrando nesta empresa.')
      .max(500, 'Justificativa muito longa.'),
  })
  .strict()

export type EnterCompanyInput = z.infer<typeof enterCompanyInputSchema>

/** A visao geral da plataforma — uma linha por empresa. */
export const companyOverviewSchema = z.object({
  id: idSchema,
  legalName: z.string(),
  tradeName: z.string().nullable(),
  cnpj: z.string(),
  isActive: z.boolean(),
  createdAt: dateTimeSchema,
})

export type CompanyOverview = z.infer<typeof companyOverviewSchema>

/**
 * Conceder Super Admin a alguem que ja tem conta — por e-mail, nunca por id.
 *
 * `name` so importa quando a pessoa ainda nao existe (nasce uma conta nova) —
 * ignorado quando o e-mail ja tem dono, porque essa pessoa ja escolheu o
 * proprio nome.
 */
export const grantPlatformAdminInputSchema = z
  .object({ email: emailSchema, name: nameSchema.optional() })
  .strict()

export type GrantPlatformAdminInput = z.infer<typeof grantPlatformAdminInputSchema>

export const platformAdminOutputSchema = z.object({
  userId: idSchema,
  name: z.string(),
  email: z.string(),
  grantedAt: dateTimeSchema,
})

export type PlatformAdminOutput = z.infer<typeof platformAdminOutputSchema>
