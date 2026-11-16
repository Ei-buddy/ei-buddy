import type { SignupAvailabilityInput, SignupAvailabilityOutput } from '@na-regua/contracts'
import type { UserDirectory } from '../ports/identity.js'
import type { CompanyRepository } from '../ports/registration-repositories.js'
import {
  donoDoCelular,
  MSG_CELULAR_EM_USO,
  MSG_CNPJ_EM_USO,
  MSG_EMAIL_EM_USO,
} from './phone-variants.js'

export type SignupAvailabilityDeps = {
  readonly companies: Pick<CompanyRepository, 'cnpjTaken'>
  readonly users: Pick<UserDirectory, 'findByEmail' | 'findByPhone'>
}

/**
 * O e-mail, o CNPJ ou o celular ja estao em uso? — achado do QA.
 *
 * Responde na primeira etapa do cadastro, ao sair do campo, com a mesma
 * mensagem que o `signup` daria no fim. So le: nada e reservado, e o cadastro
 * confere tudo de novo ao gravar (entre a pergunta e o envio cabe outra
 * pessoa).
 */
export async function checkSignupAvailability(
  deps: SignupAvailabilityDeps,
  input: SignupAvailabilityInput,
): Promise<SignupAvailabilityOutput> {
  const conflitos: SignupAvailabilityOutput['conflicts'] = []

  if (input.email !== undefined && (await deps.users.findByEmail(input.email)) !== undefined) {
    conflitos.push({ field: 'email', message: MSG_EMAIL_EM_USO })
  }
  if (input.cnpj !== undefined && (await deps.companies.cnpjTaken(input.cnpj))) {
    conflitos.push({ field: 'cnpj', message: MSG_CNPJ_EM_USO })
  }
  if (input.phone !== undefined && (await donoDoCelular(deps.users, input.phone)) !== undefined) {
    conflitos.push({ field: 'phone', message: MSG_CELULAR_EM_USO })
  }

  return { conflicts: conflitos }
}
