import {
  ErroDeIntegracao,
  type ServiceInvoiceRequest,
  type ServiceInvoiceResult,
} from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type {
  EmpresaParaNfse,
  NfseGuardada,
  ServiceInvoiceCheck,
  ServiceInvoiceRepository,
  VendaParaNfse,
} from '../ports/service-invoice.js'
import {
  CONSULTAS_MAXIMAS,
  cancelSaleServiceInvoice,
  checkServiceInvoiceJob,
  diaDeCompetencia,
  esperaDaConsulta,
  getSaleServiceInvoice,
  issueServiceInvoiceJob,
  montarServico,
  opcaoDoSimples,
  requestServiceInvoice,
} from './service-invoice.js'

const AGORA = new Date('2026-11-20T23:30:00.000Z')
const EMPRESA = 'empresa-1'

const contexto = (over: Partial<ExecutionContext> = {}): ExecutionContext => ({
  companyId: EMPRESA,
  userId: 'usuario-1',
  role: 'owner',
  channel: 'app',
  requestId: 'req-1',
  now: AGORA,
  ...over,
})

const VENDA: VendaParaNfse = {
  saleId: 'venda-1',
  soldAt: AGORA,
  grossAmountCents: 10_000,
  discountCents: 1_000,
  items: [
    { description: 'Corte', quantity: 1, unitPriceCents: 5_000, nbsCode: '101011000' },
    { description: 'Barba', quantity: 1, unitPriceCents: 3_000, nbsCode: '101012000' },
    { description: 'Pomada', quantity: 1, unitPriceCents: 2_000, nbsCode: null },
  ],
  customer: { document: '529.982.247-25', name: 'Maria Cliente', email: 'maria@teste.local' },
}

const EMPRESA_OK: EmpresaParaNfse = {
  cnpj: '12345678000195',
  municipalRegistration: '12345',
  city: 'Curitiba',
  state: 'PR',
  cityIbgeCode: null,
  taxRegime: 'simples_nacional',
  nationalServiceCode: '060101',
  issRatePercent: 2.5,
}

/** A guarda em memoria, com as mesmas regras do repositorio de verdade. */
/** `null` = venda que nao existe (o padrao do parametro trataria `undefined` como ausente). */
function guarda(venda: VendaParaNfse | null = VENDA, empresa: EmpresaParaNfse = EMPRESA_OK) {
  const notas = new Map<string, NfseGuardada>()
  const codigos: string[] = []
  let empresaAtual = empresa

  const repo: ServiceInvoiceRepository = {
    saleForNfse: async () => venda ?? undefined,
    companyForNfse: async () => empresaAtual,
    saveCityCode: async (_c, codigo) => {
      codigos.push(codigo)
      empresaAtual = { ...empresaAtual, cityIbgeCode: codigo }
    },
    find: async (_c, saleId) => notas.get(saleId),
    open: async (_c, saleId, p) => {
      const atual = notas.get(saleId)
      if (atual !== undefined && atual.status !== 'rejected') return false
      notas.set(saleId, {
        status: 'processing',
        amountCents: p.amountCents,
        discountCents: p.discountCents,
        description: p.description,
        number: null,
        accessKey: null,
        verificationCode: null,
        danfseUrl: null,
        publicUrl: null,
        rejection: null,
        requestedAt: p.requestedAt.toISOString(),
        issuedAt: null,
        cancelledAt: null,
        lastCheckedAt: null,
        checks: 0,
      })
      return true
    },
    record: async (_c, saleId, r, em) => {
      const atual = notas.get(saleId)!
      const base = { ...atual, lastCheckedAt: em.toISOString(), checks: atual.checks + 1 }
      if (r.status === 'authorized') {
        notas.set(saleId, {
          ...base,
          status: 'authorized',
          number: r.number,
          accessKey: r.accessKey ?? null,
          danfseUrl: r.danfseUrl,
          issuedAt: r.issuedAt,
          rejection: null,
        })
      } else if (r.status === 'rejected') {
        notas.set(saleId, { ...base, status: 'rejected', rejection: r.rejection })
      } else if (r.status === 'cancelled') {
        notas.set(saleId, { ...base, status: 'cancelled' })
      } else {
        notas.set(saleId, base)
      }
    },
    markCancelled: async (_c, saleId, _motivo, em) => {
      notas.set(saleId, {
        ...notas.get(saleId)!,
        status: 'cancelled',
        cancelledAt: em.toISOString(),
      })
    },
  }
  return { repo, notas, codigos }
}

function fila() {
  const envios: ServiceInvoiceRequest[] = []
  const consultas: { check: ServiceInvoiceCheck; delayMs: number }[] = []
  return {
    envios,
    consultas,
    queue: {
      enqueueIssue: async (r: ServiceInvoiceRequest) => void envios.push(r),
      enqueueCheck: async (check: ServiceInvoiceCheck, delayMs: number) =>
        void consultas.push({ check, delayMs }),
    },
  }
}

/** `null` = cidade que o IBGE nao conhece. */
const cidades = (codigo: string | null = '4106902') => ({
  procuradas: [] as string[],
  async codigoIbge(uf: string, cidade: string) {
    this.procuradas.push(`${cidade}/${uf}`)
    return codigo ?? undefined
  },
})

const AUTORIZADA: ServiceInvoiceResult = {
  status: 'authorized',
  number: '74798',
  accessKey: '4'.repeat(50),
  danfseUrl: 'https://nfse.invalid/x.pdf',
  xmlPath: '/x.xml',
  issuedAt: '2026-11-20T20:31:00-03:00',
}

async function pegaErro(fn: () => Promise<unknown>) {
  try {
    await fn()
    return undefined
  } catch (e) {
    return e
  }
}

describe('montar o servico da nota — NR-241', () => {
  it('soma so os servicos, leva a parte deles no desconto e o NBS do maior', () => {
    expect(montarServico(VENDA)).toEqual({
      amountCents: 8_000,
      /* R$ 10 de desconto em R$ 100: R$ 8 cabem aos R$ 80 de servico. */
      discountCents: 800,
      description: '1x Corte; 1x Barba',
      nbsCode: '101011000',
    })
  })

  it('regime do cadastro para a opcao do Simples', () => {
    expect(opcaoDoSimples('mei')).toBe('mei')
    expect(opcaoDoSimples('simples_nacional')).toBe('me_epp')
    expect(opcaoDoSimples('lucro_presumido')).toBe('not_optant')
  })

  it('competencia no dia de Brasilia, e nao no de UTC', () => {
    /* 23h30 UTC de 20/11 e 20h30 de 20/11 em Brasilia; 02h UTC de 21/11 ainda e 20/11. */
    expect(diaDeCompetencia(AGORA)).toBe('2026-11-20')
    expect(diaDeCompetencia(new Date('2026-11-21T02:00:00Z'))).toBe('2026-11-20')
  })

  it('espera entre consultas dobra e para em 15 minutos', () => {
    expect(esperaDaConsulta(0)).toBe(15_000)
    expect(esperaDaConsulta(1)).toBe(30_000)
    expect(esperaDaConsulta(10)).toBe(15 * 60_000)
  })
})

describe('pedir a NFS-e — NR-241', () => {
  it('grava "processando", acha e guarda o codigo IBGE e enfileira o pedido', async () => {
    const g = guarda()
    const f = fila()
    const c = cidades()

    const r = await requestServiceInvoice({ nfse: g.repo, queue: f.queue, cities: c }, contexto(), {
      saleId: 'venda-1',
    })

    expect(r.status).toBe('processing')
    expect(c.procuradas).toEqual(['Curitiba/PR'])
    expect(g.codigos).toEqual(['4106902'])
    expect(f.envios).toHaveLength(1)
    expect(f.envios[0]).toMatchObject({
      saleId: 'venda-1',
      provider: { cnpj: '12345678000195', cityIbgeCode: '4106902', simplesNacional: 'me_epp' },
      service: {
        nationalServiceCode: '060101',
        nbsCode: '101011000',
        amountCents: 8_000,
        discountCents: 800,
        issRatePercent: 2.5,
      },
      recipient: { document: '52998224725', name: 'Maria Cliente' },
      competenceDate: '2026-11-20',
    })
  })

  it('segundo pedido devolve a nota que ja esta processando, sem enviar de novo', async () => {
    const g = guarda()
    const f = fila()
    const deps = { nfse: g.repo, queue: f.queue, cities: cidades() }
    await requestServiceInvoice(deps, contexto(), { saleId: 'venda-1' })
    const r = await requestServiceInvoice(deps, contexto(), { saleId: 'venda-1' })
    expect(r.status).toBe('processing')
    expect(f.envios).toHaveLength(1)
  })

  it('rejeitada e pedida de novo: e a correcao do lojista', async () => {
    const g = guarda()
    const f = fila()
    const deps = { nfse: g.repo, queue: f.queue, cities: cidades() }
    await requestServiceInvoice(deps, contexto(), { saleId: 'venda-1' })
    await g.repo.record(
      EMPRESA,
      'venda-1',
      { status: 'rejected', rejection: { code: 'E1', message: 'x' } },
      AGORA,
    )

    const r = await requestServiceInvoice(deps, contexto(), { saleId: 'venda-1' })
    expect(r.status).toBe('processing')
    expect(r.rejection).toBeNull()
    expect(f.envios).toHaveLength(2)
  })

  it('cancelada nao vira segunda NFS-e', async () => {
    const g = guarda()
    const deps = { nfse: g.repo, queue: fila().queue, cities: cidades() }
    await requestServiceInvoice(deps, contexto(), { saleId: 'venda-1' })
    await g.repo.markCancelled(EMPRESA, 'venda-1', 'x', AGORA)
    const erro = await pegaErro(() =>
      requestServiceInvoice(deps, contexto(), { saleId: 'venda-1' }),
    )
    expect(isAppError(erro) && erro.code).toBe('CONFLICT')
  })

  it('venda sem servico diz o que e servico e manda para a NFC-e', async () => {
    const g = guarda({ ...VENDA, items: [VENDA.items[2]!] })
    const f = fila()
    const erro = await pegaErro(() =>
      requestServiceInvoice({ nfse: g.repo, queue: f.queue, cities: cidades() }, contexto(), {
        saleId: 'venda-1',
      }),
    )
    expect(isAppError(erro) && erro.message).toMatch(/NBS/)
    expect(f.envios).toHaveLength(0)
  })

  it('loja sem Codigo de Tributacao Nacional diz onde informar', async () => {
    const g = guarda(VENDA, { ...EMPRESA_OK, nationalServiceCode: null })
    const erro = await pegaErro(() =>
      requestServiceInvoice({ nfse: g.repo, queue: fila().queue, cities: cidades() }, contexto(), {
        saleId: 'venda-1',
      }),
    )
    expect(isAppError(erro) && erro.message).toMatch(/Código de Tributação Nacional em Empresa/)
  })

  it('cidade que o IBGE nao conhece pede para conferir o endereco', async () => {
    const g = guarda()
    const erro = await pegaErro(() =>
      requestServiceInvoice(
        { nfse: g.repo, queue: fila().queue, cities: cidades(null) },
        contexto(),
        { saleId: 'venda-1' },
      ),
    )
    expect(isAppError(erro) && erro.message).toMatch(/Curitiba\/PR/)
  })

  it('consulta do IBGE fora do ar vira "tente de novo", e nada e gravado', async () => {
    const g = guarda()
    const erro = await pegaErro(() =>
      requestServiceInvoice(
        {
          nfse: g.repo,
          queue: fila().queue,
          cities: {
            codigoIbge: async () => {
              throw new ErroDeIntegracao('fora', {
                provedor: 'brasilapi',
                operacao: 'GET',
                status: 503,
              })
            },
          },
        },
        contexto(),
        { saleId: 'venda-1' },
      ),
    )
    expect(isAppError(erro) && erro.message).toMatch(/Tente de novo/)
    expect(g.notas.size).toBe(0)
  })

  it('codigo IBGE ja guardado nao e procurado de novo; tomador sem documento nao vai', async () => {
    const g = guarda(
      { ...VENDA, customer: { name: 'Sem CPF' } },
      { ...EMPRESA_OK, cityIbgeCode: '4106902' },
    )
    const f = fila()
    const c = cidades()
    await requestServiceInvoice({ nfse: g.repo, queue: f.queue, cities: c }, contexto(), {
      saleId: 'venda-1',
    })
    expect(c.procuradas).toEqual([])
    expect(f.envios[0]).not.toHaveProperty('recipient')
  })

  it('venda de outra empresa responde como inexistente', async () => {
    const g = guarda(null)
    const erro = await pegaErro(() =>
      requestServiceInvoice({ nfse: g.repo, queue: fila().queue, cities: cidades() }, contexto(), {
        saleId: 'venda-x',
      }),
    )
    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })
})

describe('worker: enviar e consultar de novo — NR-241', () => {
  async function pedida() {
    const g = guarda()
    const f = fila()
    await requestServiceInvoice({ nfse: g.repo, queue: f.queue, cities: cidades() }, contexto(), {
      saleId: 'venda-1',
    })
    return { g, f, pedido: f.envios[0]! }
  }

  it('enviada e processando: grava e agenda a primeira consulta em 15 s', async () => {
    const { g, f, pedido } = await pedida()
    await issueServiceInvoiceJob(
      {
        nfse: g.repo,
        issuer: { issue: async () => ({ status: 'processing' }), consult: async () => undefined },
        queue: f.queue,
        now: () => AGORA,
      },
      pedido,
    )
    expect(f.consultas).toEqual([
      { check: { companyId: EMPRESA, saleId: 'venda-1', checks: 0 }, delayMs: 15_000 },
    ])
    expect(g.notas.get('venda-1')?.checks).toBe(1)
  })

  it('consulta que autoriza grava a nota e para de consultar', async () => {
    const { g, f } = await pedida()
    const r = await checkServiceInvoiceJob(
      {
        nfse: g.repo,
        issuer: { issue: async () => AUTORIZADA, consult: async () => AUTORIZADA },
        queue: f.queue,
        now: () => AGORA,
      },
      { companyId: EMPRESA, saleId: 'venda-1', checks: 0 },
    )
    expect(r).toMatchObject({ status: 'authorized' })
    expect(g.notas.get('venda-1')).toMatchObject({ status: 'authorized', number: '74798' })
    expect(f.consultas).toHaveLength(0)
  })

  it('segue processando: agenda a proxima com espera maior, ate o teto', async () => {
    const { g, f } = await pedida()
    const deps = {
      nfse: g.repo,
      issuer: { issue: async () => AUTORIZADA, consult: async () => undefined },
      queue: f.queue,
      now: () => AGORA,
    }
    await checkServiceInvoiceJob(deps, { companyId: EMPRESA, saleId: 'venda-1', checks: 2 })
    expect(f.consultas.at(-1)).toEqual({
      check: { companyId: EMPRESA, saleId: 'venda-1', checks: 3 },
      delayMs: esperaDaConsulta(3),
    })

    await checkServiceInvoiceJob(deps, {
      companyId: EMPRESA,
      saleId: 'venda-1',
      checks: CONSULTAS_MAXIMAS - 1,
    })
    expect(f.consultas).toHaveLength(1)
  })

  it('nota que ja saiu de "processando" nao e consultada', async () => {
    const { g, f } = await pedida()
    await g.repo.record(EMPRESA, 'venda-1', AUTORIZADA, AGORA)
    let consultou = false
    const r = await checkServiceInvoiceJob(
      {
        nfse: g.repo,
        issuer: {
          issue: async () => AUTORIZADA,
          consult: async () => {
            consultou = true
            return AUTORIZADA
          },
        },
        queue: f.queue,
        now: () => AGORA,
      },
      { companyId: EMPRESA, saleId: 'venda-1', checks: 0 },
    )
    expect(r).toBe('nada-a-fazer')
    expect(consultou).toBe(false)
  })
})

describe('a tela e o cancelamento — NR-241', () => {
  async function processando() {
    const g = guarda()
    await requestServiceInvoice(
      { nfse: g.repo, queue: fila().queue, cities: cidades() },
      contexto(),
      {
        saleId: 'venda-1',
      },
    )
    return g
  }

  it('processando: a visita consulta o provedor, mas nao mais que a cada 20 s', async () => {
    const g = await processando()
    let consultas = 0
    const issuer = {
      consult: async () => {
        consultas += 1
        return { status: 'processing' } as const
      },
    }
    await getSaleServiceInvoice({ nfse: g.repo, issuer }, contexto(), { saleId: 'venda-1' })
    await getSaleServiceInvoice(
      { nfse: g.repo, issuer },
      contexto({ now: new Date(AGORA.getTime() + 5_000) }),
      {
        saleId: 'venda-1',
      },
    )
    expect(consultas).toBe(1)

    const r = await getSaleServiceInvoice(
      { nfse: g.repo, issuer: { consult: async () => AUTORIZADA } },
      contexto({ now: new Date(AGORA.getTime() + 25_000) }),
      { saleId: 'venda-1' },
    )
    expect(r?.status).toBe('authorized')
    expect(r?.danfseUrl).toBe('https://nfse.invalid/x.pdf')
  })

  it('provedor fora do ar nao derruba a tela', async () => {
    const g = await processando()
    const r = await getSaleServiceInvoice(
      {
        nfse: g.repo,
        issuer: {
          consult: async () => {
            throw new ErroDeIntegracao('fora', {
              provedor: 'focusnfe',
              operacao: 'GET',
              status: 503,
            })
          },
        },
      },
      contexto(),
      { saleId: 'venda-1' },
    )
    expect(r?.status).toBe('processing')
  })

  it('venda sem NFS-e responde nulo', async () => {
    const g = guarda()
    expect(
      await getSaleServiceInvoice({ nfse: g.repo }, contexto(), { saleId: 'venda-1' }),
    ).toBeNull()
  })

  it('cancela a autorizada e registra na trilha', async () => {
    const g = await processando()
    await g.repo.record(EMPRESA, 'venda-1', AUTORIZADA, AGORA)
    const trilha = new InMemoryAuditTrail()

    const r = await cancelSaleServiceInvoice(
      {
        nfse: g.repo,
        issuer: { cancel: async () => ({ status: 'cancelled' }) },
        audit: trilha,
      },
      contexto(),
      { saleId: 'venda-1', reason: 'Servico lancado em duplicidade' },
    )

    expect(r.status).toBe('cancelled')
    expect(trilha.daEmpresa(EMPRESA)[0]).toMatchObject({
      entity: 'Sale',
      entityId: 'venda-1',
      after: { serviceInvoice: 'cancelled' },
    })
  })

  it('processando nao cancela; recusa do Ambiente Nacional vira erro com o motivo', async () => {
    const g = await processando()
    const deps = (
      cancel: () => Promise<
        | { status: 'rejected'; rejection: { code: string; message: string } }
        | { status: 'cancelled' }
      >,
    ) => ({
      nfse: g.repo,
      issuer: { cancel },
      audit: new InMemoryAuditTrail(),
    })
    const cedo = await pegaErro(() =>
      cancelSaleServiceInvoice(
        deps(async () => ({ status: 'cancelled' })),
        contexto(),
        {
          saleId: 'venda-1',
          reason: 'Motivo com mais de quinze',
        },
      ),
    )
    expect(isAppError(cedo) && cedo.code).toBe('CONFLICT')

    await g.repo.record(EMPRESA, 'venda-1', AUTORIZADA, AGORA)
    const recusa = await pegaErro(() =>
      cancelSaleServiceInvoice(
        deps(async () => ({
          status: 'rejected',
          rejection: { code: 'E1', message: 'Prazo encerrado.' },
        })),
        contexto(),
        { saleId: 'venda-1', reason: 'Motivo com mais de quinze' },
      ),
    )
    expect(isAppError(recusa) && recusa.message).toBe('Prazo encerrado.')
    expect(g.notas.get('venda-1')?.status).toBe('authorized')
  })
})
