import { saleHistoryInputSchema, updateProductInputSchema } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  contemTermoTecnico,
  limparTermosTecnicos,
  termosDasFerramentas,
  TEXTO_SEM_RESPOSTA_LIMPA,
} from './technical-terms.js'

const proibidos = termosDasFerramentas({
  list_sales: { id: 'list_sales', inputSchema: z.preprocess((v) => v, saleHistoryInputSchema) },
  update_product: {
    id: 'update_product',
    inputSchema: z.object({ id: z.string() }).and(updateProductInputSchema),
  },
})

describe('contemTermoTecnico', () => {
  it.each([
    'O id é 78a3705e-de89-4b52-b5a2-276561075c13.',
    'Produto PROD-0003 alterado.',
    'Chamei list_sales para ver.',
    'Alterar salePriceCents para 14.',
    'O unitPriceCents ficou 2500.',
    'Custa 2500 centavos.',
    'Campo customerId vazio.',
  ])('acusa "%s"', (texto) => {
    expect(contemTermoTecnico(texto, proibidos)).toBe(true)
  })

  it.each([
    'Tem café em grãos a R$ 25,00.',
    'Hoje foram 3 vendas, R$ 150,00 no total.',
    'Quer que eu cadastre o João?',
    'De 2026-10-01 a 2026-10-31 o resultado foi R$ 50,00.',
  ])('aceita texto comum "%s"', (texto) => {
    expect(contemTermoTecnico(texto, proibidos)).toBe(false)
  })

  it('coleta os ids das tools e as chaves camelCase dos schemas', () => {
    expect(proibidos.has('list_sales')).toBe(true)
    expect(proibidos.has('update_product')).toBe(true)
    expect(proibidos.has('customerId')).toBe(true)
    expect(proibidos.has('salePriceCents')).toBe(true)
    expect(proibidos.has('from')).toBe(false)
  })
})

describe('limparTermosTecnicos', () => {
  it('remove a frase com o termo e preserva o resto', () => {
    const texto =
      'Tem café em grãos a R$ 25,00. O código é 78a3705e-de89-4b52-b5a2-276561075c13. Quer vender?'
    expect(limparTermosTecnicos(texto, proibidos)).toBe(
      'Tem café em grãos a R$ 25,00. Quer vender?',
    )
  })

  it('remove o item de lista com o termo', () => {
    const texto = 'Encontrei:\n- café em grãos (PROD-0001)\n- café moído R$ 18,00'
    expect(limparTermosTecnicos(texto, proibidos)).toBe('Encontrei:\n- café moído R$ 18,00')
  })

  it('texto sem termo volta igual', () => {
    expect(limparTermosTecnicos('Tudo certo.', proibidos)).toBe('Tudo certo.')
  })

  it('se nada sobrar, devolve uma frase segura', () => {
    expect(limparTermosTecnicos('PROD-0001', proibidos)).toBe(TEXTO_SEM_RESPOSTA_LIMPA)
  })
})
