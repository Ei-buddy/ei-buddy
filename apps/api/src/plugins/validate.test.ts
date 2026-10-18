import { createSaleInputSchema } from '@na-regua/contracts'
import { isAppError } from '@na-regua/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { validate } from './validate.js'

const vendaValida = {
  items: [{ productId: 'p1', quantity: 1, unitPriceCents: 1990 }],
  payments: [{ method: 'cash', amountCents: 1990 }],
}

describe('mensagem padrao do zod em portugues', () => {
  /* Schema sem mensagens proprias: so o texto padrao da biblioteca. */
  const schema = z.object({ nome: z.string(), estoque: z.number().min(0) }).strict()

  const mensagens = (entrada: unknown): Record<string, string> => {
    try {
      validate(schema, entrada)
      return {}
    } catch (error) {
      return isAppError(error)
        ? Object.fromEntries(error.fields.map((f) => [f.path, f.message]))
        : {}
    }
  }

  it('campo ausente vira "obrigatorio" e numero baixo diz o minimo', () => {
    expect(mensagens({ estoque: -1 })).toEqual({
      nome: 'Campo obrigatorio.',
      estoque: 'O valor minimo e 0.',
    })
  })

  it('campo desconhecido diz qual e', () => {
    expect(Object.values(mensagens({ nome: 'x', estoque: 1, foo: 1 }))).toEqual([
      'Campo nao reconhecido: foo.',
    ])
  })

  it('mensagem propria do schema passa intacta', () => {
    const proprio = z.object({ nome: z.string().min(2, 'Nome muito curto.') })
    try {
      validate(proprio, { nome: 'a' })
    } catch (error) {
      expect(isAppError(error) && error.fields[0]?.message).toBe('Nome muito curto.')
    }
  })
})

describe('validate', () => {
  it('devolve a entrada tipada quando o schema passa', () => {
    const venda = validate(createSaleInputSchema, vendaValida)
    expect(venda.items).toHaveLength(1)
  })

  it('lanca AppError com codigo VALIDATION_FAILED', () => {
    expect.assertions(2)
    try {
      validate(createSaleInputSchema, { items: [], payments: [] })
    } catch (error) {
      expect(isAppError(error)).toBe(true)
      if (isAppError(error)) expect(error.code).toBe('VALIDATION_FAILED')
    }
  })

  it('achata o caminho aninhado no formato que a tela usa', () => {
    expect.assertions(1)
    try {
      validate(createSaleInputSchema, {
        items: [{ productId: 'p1', quantity: 0, unitPriceCents: 1990 }],
        payments: [{ method: 'cash', amountCents: 1990 }],
      })
    } catch (error) {
      if (isAppError(error)) {
        expect(error.fields.map((f) => f.path)).toContain('items.0.quantity')
      }
    }
  })

  it('preserva a mensagem em pt-br que veio de contracts', () => {
    expect.assertions(1)
    try {
      validate(createSaleInputSchema, { ...vendaValida, items: [] })
    } catch (error) {
      if (isAppError(error)) {
        expect(error.fields[0]?.message).toBe('A venda precisa de ao menos um item.')
      }
    }
  })

  it('recusa companyId no corpo — principio 8', () => {
    expect.assertions(1)
    try {
      validate(createSaleInputSchema, { ...vendaValida, companyId: 'outra-empresa' })
    } catch (error) {
      expect(isAppError(error)).toBe(true)
    }
  })

  it('acumula todos os campos com problema, nao so o primeiro', () => {
    const schema = z.object({ a: z.string(), b: z.number() })
    expect.assertions(1)
    try {
      validate(schema, {})
    } catch (error) {
      if (isAppError(error)) expect(error.fields).toHaveLength(2)
    }
  })
})
