import { pedir, type Resultado } from './http'

/** Meu perfil — NR-153. Os dados da PESSOA logada, validos em todas as lojas. */
export type MinhaConta = { name: string; email: string | null; phone: string | null }

export const carregarMinhaConta = (): Promise<Resultado<MinhaConta>> => pedir('/api/perfil/conta')

export const trocarNome = (name: string): Promise<Resultado<MinhaConta>> =>
  pedir('/api/perfil/nome', { method: 'PUT', body: JSON.stringify({ name: name.trim() }) })

/** Pede a senha atual: e por este e-mail que se entra e se recupera a conta. */
export const trocarEmail = (email: string, senha: string): Promise<Resultado<MinhaConta>> =>
  pedir('/api/perfil/email', {
    method: 'PUT',
    body: JSON.stringify({ email: email.trim(), secret: senha }),
  })

export const trocarSenha = (atual: string, nova: string): Promise<Resultado<unknown>> =>
  pedir('/api/perfil/senha', {
    method: 'PUT',
    body: JSON.stringify({ secret: atual, newSecret: nova }),
  })
