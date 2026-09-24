import { describe, expect, it } from 'vitest'
import { createProductInputSchema, updateProductInputSchema } from './product.js'

const produto = {
  description: 'Cafe torrado 500g',
  unitOfMeasure: 'un' as const,
  salePriceCents: 2490,
  costPriceCents: 1600,
}

describe('cadastro de produto', () => {
  it('aceita o caso minimo e aplica os padroes', () => {
    const r = createProductInputSchema.parse(produto)
    expect(r.stock).toBe(0)
    expect(r.minStock).toBe(0)
  })

  it('normaliza o codigo de barras', () => {
    const r = createProductInputSchema.parse({ ...produto, barcode: '789.123 45678 90' })
    expect(r.barcode).toBe('7891234567890')
  })

  it('aceita so CSOSN: o produto atende Simples e MEI, nao o regime normal', () => {
    expect(createProductInputSchema.parse({ ...produto, taxSituationCode: '102' })).toMatchObject({
      taxSituationCode: '102',
    })
    /* CST de dois digitos passaria aqui e seria recusado pela SEFAZ na nota. */
    expect(createProductInputSchema.safeParse({ ...produto, taxSituationCode: '00' }).success).toBe(
      false,
    )
  })

  it('recusa preco de venda abaixo do custo', () => {
    const r = createProductInputSchema.safeParse({ ...produto, salePriceCents: 1000 })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe(
        'Preco de venda menor que o custo. Confira os valores.',
      )
      expect(r.error.issues[0]?.path).toEqual(['salePriceCents'])
    }
  })

  it.each([
    [{ ...produto, description: 'x' }, 'descricao curta demais'],
    [{ ...produto, unitOfMeasure: 'duzia' }, 'unidade inexistente'],
    [{ ...produto, salePriceCents: 24.9 }, 'preco decimal'],
    [{ ...produto, costPriceCents: -1 }, 'custo negativo'],
    [{ ...produto, taxRate: 101 }, 'aliquota acima de 100'],
    [{ ...produto, taxRate: -1 }, 'aliquota negativa'],
    [{ ...produto, barcode: '123' }, 'codigo de barras curto'],
    [{ ...produto, stock: 1.5 }, 'estoque fracionado'],
    [{ ...produto, companyId: 'outra' }, 'companyId no corpo'],
  ])('recusa %o (%s)', (entrada, _motivo) => {
    expect(createProductInputSchema.safeParse(entrada).success).toBe(false)
  })

  it('exige custo — sem ele nao existe margem', () => {
    const { costPriceCents: _, ...semCusto } = produto
    expect(createProductInputSchema.safeParse(semCusto).success).toBe(false)
  })

  /*
   * O defeito que isto guarda: a coluna `products.supplier` existia desde a
   * migration 0007, mas nao havia caminho ate ela — o formulario pedia o
   * fornecedor e o cadastro descartava em silencio.
   */
  it('aceita fornecedor e apara os espacos', () => {
    const r = createProductInputSchema.parse({ ...produto, supplier: '  Torrefacao Aurora  ' })
    expect(r.supplier).toBe('Torrefacao Aurora')
  })

  it('fornecedor e opcional — nem toda loja rastreia isso', () => {
    expect(createProductInputSchema.parse(produto).supplier).toBeUndefined()
  })

  it('recusa fornecedor longo demais', () => {
    expect(
      createProductInputSchema.safeParse({ ...produto, supplier: 'x'.repeat(121) }).success,
    ).toBe(false)
  })
})

describe('edicao de produto', () => {
  it('aceita alterar um campo so', () => {
    expect(updateProductInputSchema.safeParse({ salePriceCents: 2990 }).success).toBe(true)
  })

  it('aceita objeto vazio — nada a alterar nao e erro de forma', () => {
    expect(updateProductInputSchema.safeParse({}).success).toBe(true)
  })

  it('recusa campo desconhecido', () => {
    expect(updateProductInputSchema.safeParse({ preco: 100 }).success).toBe(false)
  })

  it('aceita alterar so o fornecedor', () => {
    expect(updateProductInputSchema.safeParse({ supplier: 'Engenho Doce' }).success).toBe(true)
  })
})
