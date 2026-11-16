import type { LocalUser, UserDirectory } from '../ports/identity.js'

/**
 * O mesmo celular em dois formatos — achado do QA ("não pode usar o mesmo
 * número de celular").
 *
 * Desde 2016 todo celular brasileiro tem nove digitos, mas o numero antigo, de
 * oito, continua sendo digitado: "(41) 9999-8888" e "(41) 99999-8888" sao o
 * mesmo WhatsApp. Como `users.phone` compara por igualdade, os dois passavam
 * como pessoas diferentes e a mesma pessoa abria duas contas.
 *
 * Regra: com 11 digitos e o terceiro igual a 9, a forma antiga e a mesma sem
 * esse 9; com 10 digitos e o numero comecando de 6 a 9 (faixa de celular), a
 * forma atual e a mesma com o 9 na frente. Fixo (2 a 5) nao tem variante.
 */
export function variantesDoCelular(phone: string): readonly string[] {
  const d = phone.replace(/\D/g, '')
  if (d.length === 11 && d[2] === '9' && /[6-9]/.test(d[3] ?? '')) {
    return [d, d.slice(0, 2) + d.slice(3)]
  }
  if (d.length === 10 && /[6-9]/.test(d[2] ?? '')) {
    return [d, `${d.slice(0, 2)}9${d.slice(2)}`]
  }
  return [d]
}

/** Quem ja usa este celular, em qualquer dos dois formatos. */
export async function donoDoCelular(
  users: Pick<UserDirectory, 'findByPhone'>,
  phone: string,
): Promise<LocalUser | undefined> {
  for (const variante of variantesDoCelular(phone)) {
    const dono = await users.findByPhone(variante)
    if (dono !== undefined) return dono
  }
  return undefined
}

/*
 * As mensagens do cadastro repetido — as mesmas na conferencia antecipada
 * (`checkSignupAvailability`) e na gravacao (`signup`), para a tela nao dizer
 * uma coisa ao sair do campo e outra no fim.
 *
 * Elas dizem que o dado ja esta em uso: o QA pediu recusa clara, e a recusa
 * vaga de antes ("nao foi possivel usar este e-mail") ja dava a mesma
 * informacao a quem testasse. O limite de requisicoes das rotas publicas e o
 * que impede varrer a base.
 */
export const MSG_EMAIL_EM_USO =
  'Já existe uma conta com este e-mail. Entre por "Acessar minha conta" ou use "Esqueci minha senha".'
export const MSG_CELULAR_EM_USO =
  'Este celular já está em uso por outra conta. Use outro número ou entre na conta que já existe.'
export const MSG_CNPJ_EM_USO =
  'Este CNPJ já tem cadastro. Se a empresa é sua, peça acesso a quem administra a conta.'
