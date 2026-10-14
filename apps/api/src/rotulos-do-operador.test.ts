import { describe, expect, it } from 'vitest'
import { buscarRotulosDoOperador } from './rotulos-do-operador.js'

const users = {
  findById: async (id: string) =>
    id === 'user-A' ? { id, name: 'Ana Silva', isActive: true } : undefined,
}

const companies = {
  findById: async (id: string) =>
    id === 'emp-A' ? ({ tradeName: 'Mercearia Sol' } as { tradeName: string }) : undefined,
}

describe('buscarRotulosDoOperador', () => {
  it('devolve nome e fantasia quando os dois existem', async () => {
    await expect(
      buscarRotulosDoOperador(users, companies, { userId: 'user-A', companyId: 'emp-A' }),
    ).resolves.toEqual({ userName: 'Ana Silva', companyName: 'Mercearia Sol' })
  })

  it('omite o campo que não existir', async () => {
    await expect(
      buscarRotulosDoOperador(users, companies, { userId: 'sumiu', companyId: 'emp-A' }),
    ).resolves.toEqual({ companyName: 'Mercearia Sol' })
  })

  it('falha de lookup devolve objeto vazio', async () => {
    await expect(
      buscarRotulosDoOperador(
        { findById: async () => Promise.reject(new Error('db')) },
        companies,
        { userId: 'user-A', companyId: 'emp-A' },
      ),
    ).resolves.toEqual({})
  })
})
