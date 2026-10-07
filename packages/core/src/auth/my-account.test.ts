import { describe, expect, it } from 'vitest'
import { changeEmail, changeName, changePassword, myAccount } from './my-account.js'

/** Meu perfil — NR-153. */

const AGORA = new Date('2026-09-24T12:00:00.000Z')
const quem = { userId: 'usr-1', companyId: 'emp-1', now: AGORA }

function cenario(over: { emUso?: boolean; bancoFalha?: boolean } = {}) {
  const estado = {
    nome: 'Ana',
    banco: 'ana@loja.com',
    provedor: 'ana@loja.com',
    senha: 'certa',
    trilha: [] as unknown[],
  }
  const deps = {
    contacts: {
      contactOf: async () => ({
        email: estado.banco,
        phone: '41999990000',
        subject: 'sub-1',
        name: estado.nome,
      }),
      changePhone: async () => undefined,
      changeEmail: async (_u: string, email: string) => {
        if (over.bancoFalha) throw new Error('indice unico')
        estado.banco = email
      },
      changeName: async (_u: string, nome: string) => void (estado.nome = nome),
    },
    provider: {
      verify: async (c: { identifier: string; secret: string }) =>
        c.secret === estado.senha
          ? { subject: 'sub-1', email: estado.banco, phone: null }
          : undefined,
    },
    editor: {
      setEmail: async (_s: string, novo: string) => {
        estado.provedor = novo
        return true
      },
      setSecretFor: async (_s: string, nova: string) => {
        estado.senha = nova
        return true
      },
    },
    users: {
      findByEmail: async () =>
        over.emUso ? { id: 'outro', name: 'Outro', isActive: true } : undefined,
    },
    audit: { record: async (e: unknown) => void estado.trilha.push(e) },
  }
  return { deps: deps as never, estado }
}

describe('meu perfil — NR-153', () => {
  it('mostra nome, e-mail e celular da pessoa', async () => {
    const c = cenario()

    expect(await myAccount(c.deps, quem)).toEqual({
      name: 'Ana',
      email: 'ana@loja.com',
      phone: '41999990000',
    })
  })

  it('troca o nome sem pedir senha, e registra', async () => {
    const c = cenario()

    const r = await changeName(c.deps, quem, { name: 'Ana Paula' })

    expect(r.name).toBe('Ana Paula')
    expect(c.estado.trilha).toHaveLength(1)
  })

  it('troca o e-mail no banco e no provedor', async () => {
    const c = cenario()

    await changeEmail(c.deps, quem, { email: 'Ana.Paula@Loja.com', secret: 'certa' })

    expect(c.estado).toMatchObject({ banco: 'ana.paula@loja.com', provedor: 'ana.paula@loja.com' })
  })

  it('e-mail com senha errada nao troca nada', async () => {
    const c = cenario()

    await expect(
      changeEmail(c.deps, quem, { email: 'novo@loja.com', secret: 'errada' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(c.estado.provedor).toBe('ana@loja.com')
  })

  it('e-mail de outra conta e recusado', async () => {
    const c = cenario({ emUso: true })

    await expect(
      changeEmail(c.deps, quem, { email: 'novo@loja.com', secret: 'certa' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(c.estado.provedor).toBe('ana@loja.com')
  })

  it('se o banco falhar, o provedor volta ao e-mail antigo', async () => {
    const c = cenario({ bancoFalha: true })

    await expect(
      changeEmail(c.deps, quem, { email: 'novo@loja.com', secret: 'certa' }),
    ).rejects.toThrow()
    expect(c.estado.provedor).toBe('ana@loja.com')
  })

  it('troca a senha com a atual certa — e a senha nao entra na trilha', async () => {
    const c = cenario()

    await changePassword(c.deps, quem, { secret: 'certa', newSecret: 'nova-senha-forte' })

    expect(c.estado.senha).toBe('nova-senha-forte')
    expect(JSON.stringify(c.estado.trilha)).not.toContain('nova-senha-forte')
  })

  it('senha atual errada nao troca', async () => {
    const c = cenario()

    await expect(
      changePassword(c.deps, quem, { secret: 'errada', newSecret: 'nova-senha-forte' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(c.estado.senha).toBe('certa')
  })
})
