import { describe, expect, it } from 'vitest'
import {
  cancelServiceInvoiceRequestSchema,
  serviceInvoiceRequestSchema,
  serviceInvoiceResultSchema,
} from './service-invoice.js'

const PEDIDO = {
  companyId: 'empresa-1',
  saleId: 'venda-1',
  provider: { cnpj: '12.345.678/0001-95', cityIbgeCode: '41.06902', simplesNacional: 'me_epp' },
  service: { nationalServiceCode: '01.07.01', description: 'Corte', amountCents: 4500 },
  competenceDate: '2026-11-20',
  requestedAt: '2026-11-20T18:30:00.000Z',
}

describe('pedido de NFS-e nacional — NR-240', () => {
  it('guarda so digitos', () => {
    const p = serviceInvoiceRequestSchema.parse(PEDIDO)
    expect(p.provider.cnpj).toBe('12345678000195')
    expect(p.provider.cityIbgeCode).toBe('4106902')
    expect(p.service.nationalServiceCode).toBe('010701')
  })

  it('recusa municipio sem 7 digitos e codigo de tributacao sem 6', () => {
    expect(
      serviceInvoiceRequestSchema.safeParse({
        ...PEDIDO,
        provider: { ...PEDIDO.provider, cityIbgeCode: '410690' },
      }).success,
    ).toBe(false)
    expect(
      serviceInvoiceRequestSchema.safeParse({
        ...PEDIDO,
        service: { ...PEDIDO.service, nationalServiceCode: '0107' },
      }).success,
    ).toBe(false)
  })

  it('recusa servico de valor zero e desconto que zera a nota', () => {
    expect(
      serviceInvoiceRequestSchema.safeParse({
        ...PEDIDO,
        service: { ...PEDIDO.service, amountCents: 0 },
      }).success,
    ).toBe(false)
    const r = serviceInvoiceRequestSchema.safeParse({
      ...PEDIDO,
      service: { ...PEDIDO.service, discountCents: 4500 },
    })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.path).toEqual(['service', 'discountCents'])
  })

  it('tomador precisa de CPF ou CNPJ', () => {
    expect(
      serviceInvoiceRequestSchema.safeParse({ ...PEDIDO, recipient: { document: '123' } }).success,
    ).toBe(false)
  })
})

describe('resultado e cancelamento da NFS-e — NR-240', () => {
  it('"processando" e um resultado valido, e a chave tem 50 digitos', () => {
    expect(serviceInvoiceResultSchema.parse({ status: 'processing' })).toEqual({
      status: 'processing',
    })
    expect(
      serviceInvoiceResultSchema.safeParse({
        status: 'authorized',
        number: '1',
        accessKey: '1'.repeat(44),
        danfseUrl: 'https://nfse.invalid/x.pdf',
        xmlPath: '/x.xml',
        issuedAt: '2026-11-20T15:30:00-03:00',
      }).success,
    ).toBe(false)
  })

  it('cancelamento exige justificativa de 15 caracteres', () => {
    expect(
      cancelServiceInvoiceRequestSchema.safeParse({ companyId: 'e', saleId: 'v', reason: 'curta' })
        .success,
    ).toBe(false)
  })
})
