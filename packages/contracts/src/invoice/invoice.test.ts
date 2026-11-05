import { describe, expect, it } from 'vitest'
import {
  accessKeySchema,
  cancelInvoiceRequestSchema,
  cfopSchema,
  invoiceCancellationSchema,
  invoiceIssueResultSchema,
  invoiceItemSchema,
  invoiceRecipientSchema,
  invoiceRejectionSchema,
  invoiceStatusSchema,
  issueInvoiceRequestSchema,
  LOCAL_REJECTION_CODES,
  ncmSchema,
  separarOrigem,
  taxSituationCodeSchema,
} from './invoice.js'

const CHAVE = '4'.repeat(44)

/** Item minimo valido — base para variar um campo por vez. */
const item = {
  productId: 'p1',
  description: 'Cafe torrado 500g',
  quantity: 2,
  unitPriceCents: 1990,
  unitOfMeasure: 'un' as const,
  ncm: '09011110',
  cfop: '5102',
  taxSituationCode: '102',
}

const pedido = {
  companyId: 'e1',
  saleId: 'v1',
  series: 1,
  items: [item],
  payments: [{ method: 'pix' as const, amountCents: 3980 }],
  requestedAt: '2026-09-02T13:00:00.000Z',
}

describe('classificacao fiscal', () => {
  it('aceita NCM de 8 digitos e descarta a pontuacao do cadastro', () => {
    /* Cadastro traz "0901.11.10" com ponto; recusar isso seria recusar o
       formato em que a pessoa copia da tabela. */
    expect(ncmSchema.parse('0901.11.10')).toBe('09011110')
  })

  it.each([
    ['12345', 'curto'],
    ['090111101', 'longo'],
    ['', 'vazio'],
  ])('recusa NCM %s (%s)', (entrada, _motivo) => {
    const r = ncmSchema.safeParse(entrada)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toBe('NCM invalido. Deve ter 8 digitos.')
  })

  it('aceita CFOP de 4 digitos', () => {
    expect(cfopSchema.parse('5.102')).toBe('5102')
  })

  it('recusa CFOP fora de 4 digitos', () => {
    expect(cfopSchema.safeParse('510').success).toBe(false)
    expect(cfopSchema.safeParse('51023').success).toBe(false)
  })

  it('aceita CST de 2 digitos e CSOSN de 3', () => {
    /* Dois codigos no mesmo campo: regime normal usa CST, Simples usa CSOSN.
       Qual dos dois vale e regra, e mora em core. */
    expect(taxSituationCodeSchema.parse('00')).toBe('00')
    expect(taxSituationCodeSchema.parse('102')).toBe('102')
  })

  it('aceita 4 digitos (origem + CSOSN) e recusa 1 ou 5', () => {
    expect(taxSituationCodeSchema.parse('0102')).toBe('0102')
    expect(taxSituationCodeSchema.safeParse('0').success).toBe(false)
    expect(taxSituationCodeSchema.safeParse('01020').success).toBe(false)
  })

  it('separa a origem do codigo', () => {
    expect(separarOrigem('0102')).toEqual({ origem: 0, codigo: '102' })
    expect(separarOrigem('2500')).toEqual({ origem: 2, codigo: '500' })
    expect(separarOrigem('102')).toEqual({ origem: 0, codigo: '102' })
    expect(separarOrigem('00')).toEqual({ origem: 0, codigo: '00' })
  })
})

describe('chave de acesso', () => {
  it('aceita exatamente 44 digitos', () => {
    expect(accessKeySchema.safeParse(CHAVE).success).toBe(true)
  })

  it.each([
    ['4'.repeat(43), '43 digitos'],
    ['4'.repeat(45), '45 digitos'],
    ['4'.repeat(43) + 'a', 'com letra'],
    ['', 'vazia'],
  ])('recusa chave com %s (%s)', (entrada, _motivo) => {
    const r = accessKeySchema.safeParse(entrada)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('Chave de acesso invalida. Deve ter 44 digitos.')
    }
  })
})

describe('estado fiscal', () => {
  it.each(['authorized', 'contingency', 'rejected', 'cancelled'])('aceita %s', (estado) => {
    expect(invoiceStatusSchema.safeParse(estado).success).toBe(true)
  })

  it('recusa estado inventado, com mensagem para a tela', () => {
    const r = invoiceStatusSchema.safeParse('pendente')
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toBe('Estado fiscal invalido.')
  })
})

describe('item da nota', () => {
  it('aceita o caso minimo', () => {
    expect(invoiceItemSchema.safeParse(item).success).toBe(true)
  })

  it.each([
    [{ ...item, ncm: '123' }, 'NCM curto'],
    [{ ...item, cfop: '99999' }, 'CFOP longo'],
    [{ ...item, taxSituationCode: '' }, 'CST vazio'],
    [{ ...item, quantity: 0 }, 'quantidade zero'],
    [{ ...item, quantity: 1.5 }, 'quantidade fracionada'],
    [{ ...item, unitPriceCents: 19.9 }, 'preco decimal em vez de centavos'],
    [{ ...item, unitPriceCents: -1 }, 'preco negativo'],
    [{ ...item, unitOfMeasure: 'duzia' }, 'unidade inexistente'],
    [{ ...item, description: '' }, 'sem descricao'],
  ])('recusa %o (%s)', (entrada, _motivo) => {
    expect(invoiceItemSchema.safeParse(entrada).success).toBe(false)
  })

  it('recusa campo desconhecido, para o adapter nao transmitir lixo', () => {
    expect(invoiceItemSchema.safeParse({ ...item, aliquotaChutada: 18 }).success).toBe(false)
  })
})

describe('destinatario', () => {
  it('aceita ausencia total — NFC-e de balcao sai sem identificacao', () => {
    expect(invoiceRecipientSchema.safeParse({}).success).toBe(true)
  })

  it('aceita CPF e CNPJ, descartando pontuacao', () => {
    expect(invoiceRecipientSchema.parse({ document: '123.456.789-09' }).document).toBe(
      '12345678909',
    )
    expect(invoiceRecipientSchema.parse({ document: '12.345.678/0001-95' }).document).toBe(
      '12345678000195',
    )
  })

  it('recusa documento com quantidade de digitos que nao e CPF nem CNPJ', () => {
    const r = invoiceRecipientSchema.safeParse({ document: '123456' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('Documento invalido. Informe CPF ou CNPJ.')
    }
  })

  it('recusa nome de uma letra', () => {
    expect(invoiceRecipientSchema.safeParse({ name: 'J' }).success).toBe(false)
  })
})

describe('pedido de emissao', () => {
  it('aceita o caso minimo', () => {
    expect(issueInvoiceRequestSchema.safeParse(pedido).success).toBe(true)
  })

  it('aceita destinatario identificado', () => {
    const r = issueInvoiceRequestSchema.safeParse({
      ...pedido,
      recipient: { name: 'Maria Souza', document: '123.456.789-09' },
    })
    expect(r.success).toBe(true)
  })

  it.each([
    [{ ...pedido, items: [] }, 'sem item'],
    [{ ...pedido, payments: [] }, 'sem pagamento'],
    [{ ...pedido, series: 0 }, 'serie zero'],
    [{ ...pedido, series: 1000 }, 'serie acima de 999'],
    [{ ...pedido, series: 1.5 }, 'serie fracionada'],
    [{ ...pedido, saleId: '' }, 'sem venda de origem'],
    [{ ...pedido, companyId: '' }, 'sem empresa'],
    [{ ...pedido, requestedAt: '2026-09-02T13:00:00' }, 'instante sem fuso'],
    [{ ...pedido, requestedAt: '2026-09-02' }, 'so a data'],
  ])('recusa %o (%s)', (entrada, _motivo) => {
    expect(issueInvoiceRequestSchema.safeParse(entrada).success).toBe(false)
  })

  it('recusa mais de 200 itens', () => {
    const r = issueInvoiceRequestSchema.safeParse({
      ...pedido,
      items: Array.from({ length: 201 }, () => item),
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('Nota com itens demais. Divida em duas.')
    }
  })

  it('recusa forma de pagamento fora das aceitas', () => {
    const r = issueInvoiceRequestSchema.safeParse({
      ...pedido,
      payments: [{ method: 'boleto', amountCents: 100 }],
    })
    expect(r.success).toBe(false)
  })
})

describe('resultado da emissao', () => {
  const autorizada = {
    status: 'authorized' as const,
    accessKey: CHAVE,
    number: 1,
    series: 1,
    danfeUrl: 'https://fiscal.example.com/danfe/1',
    xml: '<NFe/>',
    issuedAt: '2026-09-02T13:00:01.000Z',
  }

  it('aceita autorizada completa', () => {
    expect(invoiceIssueResultSchema.safeParse(autorizada).success).toBe(true)
  })

  it('aceita contingencia com o motivo que a tela mostra', () => {
    const r = invoiceIssueResultSchema.safeParse({
      status: 'contingency',
      accessKey: CHAVE,
      number: 1,
      series: 1,
      xml: '<NFe/>',
      issuedAt: '2026-09-02T13:00:01.000Z',
      reason: 'SEFAZ indisponivel.',
    })
    expect(r.success).toBe(true)
  })

  it('aceita rejeitada com codigo e mensagem', () => {
    const r = invoiceIssueResultSchema.safeParse({
      status: 'rejected',
      rejection: { code: '539', message: 'Duplicidade de NF-e.' },
    })
    expect(r.success).toBe(true)
  })

  it('exige chave de acesso na autorizada — nota sem chave nao serve a ninguem', () => {
    const { accessKey: _semChave, ...semChave } = autorizada
    expect(invoiceIssueResultSchema.safeParse(semChave).success).toBe(false)
  })

  it('exige XML na autorizada — e o que a guarda de 5 anos guarda', () => {
    expect(invoiceIssueResultSchema.safeParse({ ...autorizada, xml: '' }).success).toBe(false)
  })

  it('recusa link de DANFE que nao e URL', () => {
    const r = invoiceIssueResultSchema.safeParse({ ...autorizada, danfeUrl: 'danfe.pdf' })
    expect(r.success).toBe(false)
  })

  it('nao deixa a rejeitada carregar chave: rejeicao nao gera nota', () => {
    const r = invoiceIssueResultSchema.safeParse({
      status: 'rejected',
      rejection: { code: '539', message: 'Duplicidade.' },
      accessKey: CHAVE,
    })
    expect(r.success).toBe(false)
  })

  it('recusa estado que nao existe na uniao', () => {
    expect(invoiceIssueResultSchema.safeParse({ status: 'pendente' }).success).toBe(false)
  })

  it('recusa rejeicao com mensagem vazia — a tela precisa dizer algo', () => {
    expect(invoiceRejectionSchema.safeParse({ code: '539', message: '' }).success).toBe(false)
  })
})

describe('pedido de cancelamento', () => {
  const cancelamento = {
    companyId: 'e1',
    accessKey: CHAVE,
    reason: 'Cliente desistiu da compra no balcao',
    requestedAt: '2026-09-02T13:30:00.000Z',
  }

  it('aceita justificativa dentro do que a SEFAZ exige', () => {
    expect(cancelInvoiceRequestSchema.safeParse(cancelamento).success).toBe(true)
  })

  it('recusa justificativa com menos de 15 caracteres', () => {
    /* Recusar na entrada poupa uma transmissao e da mensagem em portugues. */
    const r = cancelInvoiceRequestSchema.safeParse({ ...cancelamento, reason: 'erro' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('A justificativa precisa de ao menos 15 caracteres.')
    }
  })

  it('recusa justificativa acima de 255 caracteres', () => {
    const r = cancelInvoiceRequestSchema.safeParse({ ...cancelamento, reason: 'a'.repeat(256) })
    expect(r.success).toBe(false)
  })

  it('conta a justificativa depois do trim: espaco nao e justificativa', () => {
    const r = cancelInvoiceRequestSchema.safeParse({ ...cancelamento, reason: '  erro  ' })
    expect(r.success).toBe(false)
  })
})

describe('resultado do cancelamento', () => {
  it('aceita cancelada com protocolo, a prova de que o evento ocorreu', () => {
    const r = invoiceCancellationSchema.safeParse({
      status: 'cancelled',
      accessKey: CHAVE,
      protocol: '141260000000001',
      xml: '<evento/>',
      cancelledAt: '2026-09-02T13:30:01.000Z',
    })
    expect(r.success).toBe(true)
  })

  it('aceita rejeitada', () => {
    const r = invoiceCancellationSchema.safeParse({
      status: 'rejected',
      rejection: { code: '501', message: 'Prazo de cancelamento expirado.' },
    })
    expect(r.success).toBe(true)
  })

  it('exige protocolo na cancelada', () => {
    const r = invoiceCancellationSchema.safeParse({
      status: 'cancelled',
      accessKey: CHAVE,
      protocol: '',
      xml: '<evento/>',
      cancelledAt: '2026-09-02T13:30:01.000Z',
    })
    expect(r.success).toBe(false)
  })
})

describe('codigos de rejeicao local', () => {
  it('distingue erro de dado nosso de resposta do fisco', () => {
    /* core compara com estas constantes, nao com string solta: e o que faz a
       troca de provedor nao quebrar a regra em silencio. */
    expect(LOCAL_REJECTION_CODES.validation).toBe('LOCAL-VALIDACAO')
    expect(LOCAL_REJECTION_CODES.notFound).toBe('LOCAL-NOTA-NAO-ENCONTRADA')
  })

  it('nao colide com codigo numerico da SEFAZ', () => {
    for (const codigo of Object.values(LOCAL_REJECTION_CODES)) {
      expect(codigo).toMatch(/^LOCAL-/)
      expect(Number.isNaN(Number(codigo))).toBe(true)
    }
  })
})
