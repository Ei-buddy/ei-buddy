import { chamarApi } from './api'

/** Meu perfil — NR-153, as mesmas rotas do web. */

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string }

export type MinhaConta = { name: string; email: string | null; phone: string | null }

export async function carregarMinhaConta(): Promise<Resultado<MinhaConta>> {
  const r = await chamarApi<MinhaConta>('/auth/conta')
  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

export async function trocarNome(nome: string): Promise<Resultado<MinhaConta>> {
  const r = await chamarApi<MinhaConta>('/auth/nome', {
    method: 'PUT',
    body: { name: nome.trim() },
  })
  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

/** Pede a senha atual: e por este e-mail que se entra e se recupera a conta. */
export async function trocarEmail(email: string, senha: string): Promise<Resultado<MinhaConta>> {
  const r = await chamarApi<MinhaConta>('/auth/email', {
    method: 'PUT',
    body: { email: email.trim(), secret: senha },
  })
  return r.ok ? { ok: true, dados: r.dados } : { ok: false, erro: r.message }
}

export async function trocarSenha(atual: string, nova: string): Promise<Resultado<null>> {
  const r = await chamarApi<unknown>('/auth/senha', {
    method: 'PUT',
    body: { secret: atual, newSecret: nova },
  })
  return r.ok ? { ok: true, dados: null } : { ok: false, erro: r.message }
}
