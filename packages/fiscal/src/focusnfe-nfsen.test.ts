import {
  ErroDeIntegracao,
  LOCAL_REJECTION_CODES,
  type ServiceInvoiceRequest,
} from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { criarEmissorNfsenFalso } from './fake-nfsen.js'
import {
  corpoDaNfsen,
  criarEmissorNfsenFocus,
  horarioDeBrasilia,
  paraResultadoDaNfsen,
  referenciaDaNfsen,
} from './focusnfe-nfsen.js'
import { serviceInvoiceRequestSchema } from '@na-regua/contracts'

const PEDIDO: ServiceInvoiceRequest = {
  companyId: 'empresa-1',
  saleId: 'venda-1',
  provider: {
    cnpj: '12.345.678/0001-95',
    municipalRegistration: '12345',
    cityIbgeCode: '4106902',
    simplesNacional: 'me_epp',
  },
  service: {
    nationalServiceCode: '01.07.01',
    nbsCode: '1.0101.10.00',
    description: '1x Corte de cabelo; 1x Barba',
    amountCents: 8000,
    discountCents: 500,
    issRatePercent: 2.5,
  },
  recipient: { document: '529.982.247-25', name: 'Maria Cliente', email: 'maria@teste.local' },
  competenceDate: '2026-11-20',
  requestedAt: '2026-11-20T18:30:00.000Z',
}

/** Exemplo de nota autorizada da documentacao (consultar_nfse_nacional.md). */
const AUTORIZADA = {
  cnpj_prestador: '12345678000123',
  ref: 'TRANSACTION=742130=1=0=092467d0-e275-4ff2-b633-3510643cfd03',
  numero_rps: '73895',
  serie_rps: '1',
  tipo_rps: '1',
  status: 'autorizado',
  numero: '74798',
  codigo_verificacao: 'ABC123',
  data_emissao: '2026-03-30T11:25:14-03:00',
  url: 'https://www.nfse.gov.br/consultapublica/?tpc=1&chave=42054072212345678000123000000007479826039913594189',
  caminho_xml_nota_fiscal:
    '/arquivos/12345678000123_1/202603/XMLsNFSe/NFS42054072212345678000123000000007479826039913594189-nfse.xml',
  url_danfse:
    'https://focusnfe.s3.sa-east-1.amazonaws.com/arquivos/12345678000123_1/202603/DANFSEs/NFS42054072212345678000123000000007479826039913594189.pdf',
}

type Pedido = { url: string; init: RequestInit }

/** Responde em ordem: cada chamada leva a proxima resposta da fila. */
function fetchEmFila(respostas: { status: number; corpo: unknown }[]) {
  const pedidos: Pedido[] = []
  const f = (async (url: string, init: RequestInit) => {
    pedidos.push({ url, init })
    const r = respostas.shift()
    if (r === undefined) throw new Error(`chamada inesperada: ${init.method} ${url}`)
    return new Response(typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo), {
      status: r.status,
    })
  }) as unknown as typeof globalThis.fetch
  return { f, pedidos }
}

/** `null` = empresa sem token (o padrao de parametro trataria `undefined` como ausente). */
const emissor = (f: typeof globalThis.fetch, token: string | null = 'tok') =>
  criarEmissorNfsenFocus({
    ambiente: 'homologacao',
    credenciais: { tokenDe: async () => token ?? undefined },
    fetch: f,
  })

const pedidoValidado = () => serviceInvoiceRequestSchema.parse(PEDIDO)

describe('corpo da DPS — NR-240', () => {
  it('leva prestador, servico, tomador e os campos da Reforma com os nomes da Focus', () => {
    expect(corpoDaNfsen(pedidoValidado())).toEqual({
      data_emissao: '2026-11-20T15:30:00-03:00',
      data_competencia: '2026-11-20',
      emitente_dps: 1,
      codigo_municipio_emissora: 4106902,
      cnpj_prestador: '12345678000195',
      inscricao_municipal_prestador: '12345',
      codigo_opcao_simples_nacional: 3,
      regime_tributario_simples_nacional: 1,
      regime_especial_tributacao: 0,
      cpf_tomador: '52998224725',
      razao_social_tomador: 'Maria Cliente',
      email_tomador: 'maria@teste.local',
      codigo_municipio_prestacao: '4106902',
      codigo_tributacao_nacional_iss: '010701',
      codigo_nbs: '101011000',
      descricao_servico: '1x Corte de cabelo; 1x Barba',
      valor_servico: 80,
      desconto_incondicionado: 5,
      tributacao_iss: 1,
      tipo_retencao_iss: 1,
      percentual_aliquota_relativa_municipio: 2.5,
      finalidade_emissao: 0,
      consumidor_final: 1,
      indicador_destinatario: 0,
      ibs_cbs_situacao_tributaria: '000',
      ibs_cbs_classificacao_tributaria: '000001',
    })
  })

  it('MEI nao informa aliquota nem regime de apuracao do Simples', () => {
    const c = corpoDaNfsen(
      serviceInvoiceRequestSchema.parse({
        ...PEDIDO,
        provider: { ...PEDIDO.provider, simplesNacional: 'mei' },
      }),
    )
    expect(c.codigo_opcao_simples_nacional).toBe(2)
    expect(c).not.toHaveProperty('percentual_aliquota_relativa_municipio')
    expect(c).not.toHaveProperty('regime_tributario_simples_nacional')
  })

  it('tomador CNPJ nao e consumidor final; sem tomador, nenhum campo dele vai', () => {
    const empresa = corpoDaNfsen(
      serviceInvoiceRequestSchema.parse({
        ...PEDIDO,
        recipient: { document: '11.222.333/0001-81' },
      }),
    )
    expect(empresa.cnpj_tomador).toBe('11222333000181')
    expect(empresa.consumidor_final).toBe(0)

    const { recipient: _r, ...semTomador } = PEDIDO
    const balcao = corpoDaNfsen(serviceInvoiceRequestSchema.parse(semTomador))
    expect(Object.keys(balcao).filter((k) => k.endsWith('_tomador'))).toEqual([])
    expect(balcao.consumidor_final).toBe(1)
  })

  it('sem desconto e sem NBS, os campos nao vao', () => {
    const c = corpoDaNfsen(
      serviceInvoiceRequestSchema.parse({
        ...PEDIDO,
        service: { nationalServiceCode: '010701', description: 'Corte', amountCents: 4590 },
      }),
    )
    expect(c.valor_servico).toBe(45.9)
    expect(c).not.toHaveProperty('desconto_incondicionado')
    expect(c).not.toHaveProperty('codigo_nbs')
    expect(c).not.toHaveProperty('percentual_aliquota_relativa_municipio')
  })

  it('horario em Brasilia, sem milissegundos nem Z', () => {
    expect(horarioDeBrasilia('2026-11-21T01:05:09.123Z')).toBe('2026-11-20T22:05:09-03:00')
  })

  it('referencia so com letras e numeros, distinta da NFC-e da mesma venda', () => {
    expect(referenciaDaNfsen('0f8b2c1e-77aa-4c3d-9e10-5b6a7c8d9e0f')).toBe(
      '0f8b2c1e77aa4c3d9e105b6a7c8d9e0fnfse',
    )
  })
})

describe('resposta da Focus — NR-240', () => {
  it('autorizada (exemplo da documentacao) vira autorizada com chave de 50 digitos', () => {
    expect(paraResultadoDaNfsen(AUTORIZADA)).toEqual({
      status: 'authorized',
      number: '74798',
      accessKey: '42054072212345678000123000000007479826039913594189',
      verificationCode: 'ABC123',
      danfseUrl: AUTORIZADA.url_danfse,
      publicUrl: AUTORIZADA.url,
      xmlPath: AUTORIZADA.caminho_xml_nota_fiscal,
      issuedAt: '2026-03-30T11:25:14-03:00',
    })
  })

  it('autorizada sem PDF ou XML ainda e "processando" — nunca rejeitada', () => {
    const { url_danfse: _d, url: _u, ...semPdf } = AUTORIZADA
    expect(paraResultadoDaNfsen(semPdf)).toEqual({ status: 'processing' })
    const { caminho_xml_nota_fiscal: _x, ...semXml } = AUTORIZADA
    expect(paraResultadoDaNfsen(semXml)).toEqual({ status: 'processing' })
  })

  it('erro de autorizacao (exemplo da documentacao) vira rejeicao com o codigo', () => {
    const r = paraResultadoDaNfsen({
      status: 'erro_autorizacao',
      erros: [
        {
          codigo: 'E0014',
          mensagem:
            'Conjunto de Série, Número, Código do Município Emissor e CNPJ/CPF informado nesta DPS já existe em uma NFS-e gerada a partir de uma DPS enviada anteriormente.',
        },
      ],
    })
    expect(r).toMatchObject({ status: 'rejected', rejection: { code: 'E0014' } })
  })

  it('a correcao sugerida vem junto da mensagem', () => {
    const r = paraResultadoDaNfsen({
      status: 'erro_autorizacao',
      erros: [{ codigo: 'E1', mensagem: 'Aliquota invalida.', correcao: 'Informe 2%.' }],
    })
    expect(r).toEqual({
      status: 'rejected',
      rejection: { code: 'E1', message: 'Aliquota invalida. Informe 2%.' },
    })
  })

  it('cancelada traz numero e chave; estado desconhecido segue processando', () => {
    expect(paraResultadoDaNfsen({ ...AUTORIZADA, status: 'cancelado' })).toEqual({
      status: 'cancelled',
      number: '74798',
      accessKey: '42054072212345678000123000000007479826039913594189',
    })
    expect(paraResultadoDaNfsen({ status: 'algo_novo' })).toEqual({ status: 'processing' })
  })
})

describe('emissor NFS-e nacional — NR-240', () => {
  it('consulta antes e, sem nota, envia com Basic e a referencia da venda', async () => {
    const { f, pedidos } = fetchEmFila([
      { status: 404, corpo: { codigo: 'nao_encontrado', mensagem: 'Nota fiscal não encontrada' } },
      {
        status: 202,
        corpo: {
          cnpj_prestador: '12345678000195',
          ref: 'venda1nfse',
          status: 'processando_autorizacao',
        },
      },
    ])

    const r = await emissor(f).issue(PEDIDO)

    expect(r).toEqual({ status: 'processing' })
    expect(pedidos.map((p) => `${p.init.method} ${p.url}`)).toEqual([
      'GET https://homologacao.focusnfe.com.br/v2/nfsen/venda1nfse',
      'POST https://homologacao.focusnfe.com.br/v2/nfsen?ref=venda1nfse',
    ])
    const cabecalhos = pedidos[1]!.init.headers as Record<string, string>
    expect(cabecalhos.authorization).toBe(`Basic ${Buffer.from('tok:').toString('base64')}`)
    const corpo = JSON.parse(String(pedidos[1]!.init.body)) as Record<string, unknown>
    expect(corpo.codigo_tributacao_nacional_iss).toBe('010701')
  })

  it('nota ja enviada nao e enviada de novo: devolve o estado dela', async () => {
    const { f, pedidos } = fetchEmFila([{ status: 200, corpo: AUTORIZADA }])
    const r = await emissor(f).issue(PEDIDO)
    expect(r.status).toBe('authorized')
    expect(pedidos).toHaveLength(1)
  })

  it('recusa sincrona da Focus (422) vira rejeicao, nao excecao', async () => {
    const { f } = fetchEmFila([
      { status: 404, corpo: {} },
      {
        status: 422,
        corpo: { codigo: 'erro_validacao', mensagem: 'Já existe um DPS com esta referência.' },
      },
    ])
    expect(await emissor(f).issue(PEDIDO)).toEqual({
      status: 'rejected',
      rejection: { code: 'erro_validacao', message: 'Já existe um DPS com esta referência.' },
    })
  })

  it('dado invalido e recusado aqui, sem ir a rede', async () => {
    const { f, pedidos } = fetchEmFila([])
    const r = await emissor(f).issue({
      ...PEDIDO,
      service: { ...PEDIDO.service, nationalServiceCode: '123' },
    })
    expect(r).toMatchObject({
      status: 'rejected',
      rejection: { code: LOCAL_REJECTION_CODES.validation },
    })
    expect(pedidos).toHaveLength(0)
  })

  it('Focus fora do ar (5xx) lanca, para o job tentar de novo', async () => {
    const { f } = fetchEmFila([
      { status: 404, corpo: {} },
      { status: 503, corpo: { mensagem: 'indisponivel' } },
    ])
    await expect(emissor(f).issue(PEDIDO)).rejects.toBeInstanceOf(ErroDeIntegracao)
  })

  it('token recusado (HTML) lanca como infraestrutura', async () => {
    const { f } = fetchEmFila([{ status: 401, corpo: 'HTTP Basic: Access denied' }])
    await expect(emissor(f).issue(PEDIDO)).rejects.toBeInstanceOf(ErroDeIntegracao)
  })

  it('empresa sem token lanca: e configuracao, nao rejeicao fiscal', async () => {
    const { f } = fetchEmFila([])
    await expect(emissor(f, null).issue(PEDIDO)).rejects.toThrow(/token ausente/)
  })

  it('consulta: 404 e "nunca enviada"', async () => {
    const { f, pedidos } = fetchEmFila([{ status: 404, corpo: {} }])
    const r = await emissor(f).consult({ companyId: 'empresa-1', saleId: 'venda-1' })
    expect(r).toBeUndefined()
    expect(pedidos[0]!.url).toBe('https://homologacao.focusnfe.com.br/v2/nfsen/venda1nfse')
  })

  it('nota rejeitada e reenviada com a mesma referencia (a correcao)', async () => {
    const { f, pedidos } = fetchEmFila([
      {
        status: 200,
        corpo: { status: 'erro_autorizacao', erros: [{ codigo: 'E1', mensagem: 'x' }] },
      },
      { status: 202, corpo: { status: 'processando_autorizacao' } },
    ])
    expect(await emissor(f).issue(PEDIDO)).toEqual({ status: 'processing' })
    expect(pedidos.map((p) => p.init.method)).toEqual(['GET', 'POST'])
    expect(pedidos[1]!.url).toBe('https://homologacao.focusnfe.com.br/v2/nfsen?ref=venda1nfse')
  })

  it('cancela com DELETE e a justificativa', async () => {
    const { f, pedidos } = fetchEmFila([{ status: 200, corpo: { status: 'cancelado' } }])
    const r = await emissor(f).cancel({
      companyId: 'empresa-1',
      saleId: 'venda-1',
      reason: 'Servico lancado em duplicidade',
    })
    expect(r).toEqual({ status: 'cancelled' })
    expect(pedidos[0]!.init.method).toBe('DELETE')
    expect(JSON.parse(String(pedidos[0]!.init.body))).toEqual({
      justificativa: 'Servico lancado em duplicidade',
    })
  })

  it('cancelamento recusado e nota desconhecida voltam como rejeicao', async () => {
    const recusa = fetchEmFila([
      {
        status: 200,
        corpo: {
          status: 'erro_cancelamento',
          erros: [{ codigo: 'E1', mensagem: 'Prazo encerrado.' }],
        },
      },
    ])
    expect(
      await emissor(recusa.f).cancel({
        companyId: 'e',
        saleId: 'v',
        reason: 'Motivo com mais de 15',
      }),
    ).toEqual({ status: 'rejected', rejection: { code: 'E1', message: 'Prazo encerrado.' } })

    const sumida = fetchEmFila([{ status: 404, corpo: {} }])
    expect(
      await emissor(sumida.f).cancel({
        companyId: 'e',
        saleId: 'v',
        reason: 'Motivo com mais de 15',
      }),
    ).toMatchObject({ status: 'rejected', rejection: { code: LOCAL_REJECTION_CODES.notFound } })
  })

  it('justificativa curta e recusada sem ir a rede', async () => {
    const { f, pedidos } = fetchEmFila([])
    const r = await emissor(f).cancel({ companyId: 'e', saleId: 'v', reason: 'curta' })
    expect(r.status).toBe('rejected')
    expect(pedidos).toHaveLength(0)
  })
})

describe('emissor falso de NFS-e — NR-240', () => {
  it('processa, autoriza na consulta e nao envia duas vezes', async () => {
    const falso = criarEmissorNfsenFalso()
    expect(await falso.issue(PEDIDO)).toEqual({ status: 'processing' })
    expect(await falso.issue(PEDIDO)).toEqual({ status: 'processing' })
    expect(falso.enviadas()).toBe(1)

    const r = await falso.consult({ companyId: 'empresa-1', saleId: 'venda-1' })
    expect(r?.status).toBe('authorized')
    expect(await falso.consult({ companyId: 'empresa-1', saleId: 'venda-1' })).toEqual(r)
  })

  it('"REJEITAR" na descricao simula a rejeicao; cancela a autorizada', async () => {
    const falso = criarEmissorNfsenFalso()
    const r = await falso.issue({
      ...PEDIDO,
      service: { ...PEDIDO.service, description: 'REJEITAR' },
    })
    expect(r.status).toBe('rejected')

    await falso.issue({ ...PEDIDO, saleId: 'venda-2' })
    await falso.consult({ companyId: 'empresa-1', saleId: 'venda-2' })
    expect(
      await falso.cancel({
        companyId: 'empresa-1',
        saleId: 'venda-2',
        reason: 'Lancamento em duplicidade',
      }),
    ).toEqual({ status: 'cancelled' })
    expect((await falso.consult({ companyId: 'empresa-1', saleId: 'venda-2' }))?.status).toBe(
      'cancelled',
    )
  })
})
