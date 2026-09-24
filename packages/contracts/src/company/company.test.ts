import { describe, expect, it } from 'vitest'
import { createCustomerInputSchema, updateCustomerInputSchema } from '../customer/customer.js'
import {
  createCompanyInputSchema,
  createUserInputSchema,
  updateCompanyInputSchema,
} from './company.js'

const empresa = {
  legalName: 'Mercearia da Marina LTDA',
  cnpj: '11.222.333/0001-81',
  email: 'Contato@Mercearia.COM.BR',
  phone: '(11) 98765-4321',
}

describe('cadastro de empresa', () => {
  it('normaliza documento, e-mail e telefone', () => {
    const r = createCompanyInputSchema.parse(empresa)
    expect(r.cnpj).toBe('11222333000181')
    expect(r.email).toBe('contato@mercearia.com.br')
    expect(r.phone).toBe('11987654321')
  })

  it.each([
    [{ ...empresa, cnpj: '11222333000182' }, 'CNPJ com digito errado'],
    [{ ...empresa, email: 'contato@' }, 'e-mail incompleto'],
    [{ ...empresa, phone: '99999' }, 'telefone curto'],
    [{ ...empresa, legalName: 'X' }, 'razao social curta'],
    [{ ...empresa, companyId: 'outra' }, 'companyId no corpo'],
  ])('recusa %o (%s)', (entrada, _motivo) => {
    expect(createCompanyInputSchema.safeParse(entrada).success).toBe(false)
  })
})

describe('cadastro de usuario', () => {
  it.each(['owner', 'staff', 'accountant', 'platform_admin'])(
    'aceita o papel %s',
    (role, _motivo) => {
      const r = createUserInputSchema.safeParse({ name: 'Marina Alves', email: 'm@x.com', role })
      expect(r.success).toBe(true)
    },
  )

  it('recusa papel inventado', () => {
    const r = createUserInputSchema.safeParse({
      name: 'Marina Alves',
      email: 'm@x.com',
      role: 'gerente',
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toBe('Papel de acesso invalido.')
  })
})

describe('cadastro de cliente', () => {
  it('aceita so o nome — o balcao vende antes de cadastrar tudo', () => {
    expect(createCustomerInputSchema.safeParse({ name: 'Joana Ribeiro' }).success).toBe(true)
  })

  it('aceita CPF e CNPJ no mesmo campo', () => {
    expect(
      createCustomerInputSchema.parse({ name: 'Joana R', document: '529.982.247-25' }).document,
    ).toBe('52998224725')
    expect(
      /* PJ leva o fantasia junto — regra logo abaixo. */
      createCustomerInputSchema.parse({
        name: 'Padaria Sol LTDA',
        tradeName: 'Padaria Sol',
        document: '11222333000181',
      }).document,
    ).toBe('11222333000181')
  })

  describe('nome fantasia — RF-009', () => {
    it('PJ sem fantasia e recusada, no campo certo', () => {
      const r = createCustomerInputSchema.safeParse({
        name: 'Padaria Sol LTDA',
        document: '11222333000181',
      })

      expect(r.success).toBe(false)
      /*
       * O `path` importa: sem ele o erro aparece no topo do formulario e a
       * pessoa procura qual campo esta errado numa tela de treze.
       */
      expect(r.success === false && r.error.issues[0]?.path).toEqual(['tradeName'])
    })

    it('pessoa fisica NAO precisa de fantasia', () => {
      /* Pessoa fisica nao tem nome fantasia. Exigir seria pedir um dado que
         nao existe. */
      expect(
        createCustomerInputSchema.safeParse({ name: 'Joana R', document: '52998224725' }).success,
      ).toBe(true)
    })

    it('sem documento a regra nao se aplica', () => {
      /* O balcao cadastra com nome e telefone e completa depois (RF-009).
         Sem documento nao ha PJ conhecida. */
      expect(createCustomerInputSchema.safeParse({ name: 'Padaria Sol' }).success).toBe(true)
    })

    it('a edicao que introduz um CNPJ tambem exige o fantasia', () => {
      expect(updateCustomerInputSchema.safeParse({ document: '11222333000181' }).success).toBe(
        false,
      )
      expect(
        updateCustomerInputSchema.safeParse({
          document: '11222333000181',
          tradeName: 'Padaria Sol',
        }).success,
      ).toBe(true)
    })

    it('a edicao de outro campo passa sem mexer no fantasia', () => {
      /* Schema nao le banco: uma atualizacao que nao toca o documento nao tem
         como saber se o cliente guardado e PJ. */
      expect(updateCustomerInputSchema.safeParse({ email: 'novo@email.com' }).success).toBe(true)
    })
  })

  it.each([
    [{ name: 'J' }, 'nome curto'],
    [{ name: 'Joana R', document: '12345678900' }, 'CPF com digito errado'],
    [{ name: 'Joana R', walletLimitCents: 99.9 }, 'limite decimal'],
    [{ name: 'Joana R', companyId: 'outra' }, 'companyId no corpo'],
  ])('recusa %o (%s)', (entrada, _motivo) => {
    expect(createCustomerInputSchema.safeParse(entrada).success).toBe(false)
  })
})

describe('os dados fiscais da empresa — RF-003, RF-046', () => {
  it('os tres sao opcionais no cadastro', () => {
    const r = createCompanyInputSchema.parse(empresa)

    /* MEI nao tem inscricao estadual; loja que so vende produto nao tem
       municipal. Exigi-los quebraria o cadastro de conta, que e a primeira
       coisa que o lojista faz. */
    expect(r.stateRegistration).toBeUndefined()
    expect(r.businessSegment).toBeUndefined()
  })

  it('aceita "ISENTO" como inscricao estadual', () => {
    /* Valor legitimo em varios estados. Um formato numerico fixo recusaria
       empresa de verdade — e cada UF tem o seu. */
    const r = createCompanyInputSchema.parse({ ...empresa, stateRegistration: '  ISENTO  ' })

    expect(r.stateRegistration).toBe('ISENTO')
  })

  it('o ramo de atividade e TEXTO, e nao um codigo de sete digitos', () => {
    /* A tela oferece segmentos em portugues corrente, que e o que o lojista
       sabe responder. CNAE e do contador, e entra quando houver quem informe. */
    const r = createCompanyInputSchema.parse({
      ...empresa,
      businessSegment: 'Mercearia e minimercado',
    })

    expect(r.businessSegment).toBe('Mercearia e minimercado')
  })

  it.each([
    [{ stateRegistration: 'x' }, 'inscricao estadual curta demais'],
    [{ municipalRegistration: 'x'.repeat(21) }, 'inscricao municipal longa demais'],
    [{ businessSegment: 'x'.repeat(81) }, 'ramo longo demais'],
  ])('recusa %o (%s)', (extra, _motivo) => {
    expect(createCompanyInputSchema.safeParse({ ...empresa, ...extra }).success).toBe(false)
  })
})

describe('atualizacao do cadastro da empresa — RF-003', () => {
  it('aceita um campo so — as abas da tela mandam o que conhecem', () => {
    expect(updateCompanyInputSchema.parse({ tradeName: 'Mercearia Sol' }).tradeName).toBe(
      'Mercearia Sol',
    )
  })

  /*
   * O CNPJ nao entra. Trocar CNPJ nao e corrigir um cadastro, e apontar para
   * outra empresa — as notas emitidas, os recebiveis e a trilha de auditoria
   * continuariam apontando para a anterior.
   */
  it('recusa o CNPJ, em vez de ignora-lo em silencio', () => {
    expect(updateCompanyInputSchema.safeParse({ cnpj: '11222333000181' }).success).toBe(false)
  })

  it('aceita o endereco parcial — mandar so o CEP e legitimo', () => {
    const r = updateCompanyInputSchema.parse({ address: { zipCode: '80010000' } })

    expect(r.address?.zipCode).toBe('80010000')
    expect(r.address?.city).toBeUndefined()
  })

  it('recusa campo desconhecido — o schema e strict', () => {
    expect(updateCompanyInputSchema.safeParse({ cor: 'azul' }).success).toBe(false)
  })
})
