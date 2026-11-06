import { describe, expect, it } from 'vitest'
import { signupAvailabilityInputSchema } from '@na-regua/contracts'
import { checkSignupAvailability } from './signup-availability.js'
import { variantesDoCelular } from './phone-variants.js'

/** Conferencia antecipada do cadastro — achado do QA. */

const usuarios = [
  { id: 'u1', name: 'Ana', isActive: true, email: 'ana@loja.local', phone: '41999990000' },
]
const deps = {
  companies: { cnpjTaken: async (cnpj: string) => cnpj === '11222333000181' },
  users: {
    findByEmail: async (e: string) => usuarios.find((u) => u.email === e),
    findByPhone: async (p: string) => usuarios.find((u) => u.phone === p),
  },
}

describe('cadastro sem repetir e-mail, CNPJ e celular', () => {
  it('tudo livre volta sem conflito', async () => {
    const r = await checkSignupAvailability(
      deps,
      signupAvailabilityInputSchema.parse({
        email: 'nova@loja.local',
        cnpj: '11444777000161',
        phone: '41988887777',
      }),
    )
    expect(r.conflicts).toEqual([])
  })

  it('aponta cada campo ja em uso, com a mensagem da tela', async () => {
    const r = await checkSignupAvailability(
      deps,
      signupAvailabilityInputSchema.parse({
        email: ' ANA@Loja.local ',
        cnpj: '11.222.333/0001-81',
        phone: '(41) 99999-0000',
      }),
    )
    expect(r.conflicts.map((c) => c.field)).toEqual(['email', 'cnpj', 'phone'])
    expect(r.conflicts[0]?.message).toMatch(/Já existe uma conta com este e-mail/)
  })

  it('o celular antigo, de oito digitos, e o mesmo numero', async () => {
    const r = await checkSignupAvailability(
      deps,
      signupAvailabilityInputSchema.parse({ phone: '(41) 9999-0000' }),
    )
    expect(r.conflicts.map((c) => c.field)).toEqual(['phone'])
  })

  it('pergunta vazia e recusada no contrato', () => {
    expect(signupAvailabilityInputSchema.safeParse({}).success).toBe(false)
  })
})

describe('variantes do celular', () => {
  it('nove digitos com 9 na frente tem a forma antiga sem ele', () => {
    expect(variantesDoCelular('41999990000')).toEqual(['41999990000', '4199990000'])
  })
  it('oito digitos de celular ganham o 9', () => {
    expect(variantesDoCelular('4199990000')).toEqual(['4199990000', '41999990000'])
  })
  it('fixo nao tem variante', () => {
    expect(variantesDoCelular('4133334444')).toEqual(['4133334444'])
  })
})
