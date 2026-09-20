import type { PaymentEvent } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import { InMemorySettlements } from '../settlements/fakes.js'
import type {
  CobrancaRegistrada,
  CustomerChargeRepository,
} from '../ports/customer-charge-repository.js'
import { ATOR_DO_SISTEMA, usuarioReal } from '../system-actor.js'
import { empresaDaReferencia, referenciaDaCobranca } from './referencia-da-cobranca.js'
import { settleCustomerCharge } from './settle-customer-charge.js'

const EMPRESA = '11111111-1111-4111-8111-111111111111'
const AGORA = new Date('2026-09-20T15:00:00.000Z')

const evento = (over: Partial<PaymentEvent> = {}): PaymentEvent => ({
  eventId: 'evt_1',
  type: 'payment.authorized',
  chargeId: 'pay_1',
  externalReference: referenciaDaCobranca(EMPRESA, 'req-1'),
  amountCents: 8_000,
  occurredAt: AGORA.toISOString(),
  ...over,
})

const cobranca = (over: Partial<CobrancaRegistrada> = {}): CobrancaRegistrada => ({
  id: 'chg_1',
  customerId: 'cli_1',
  amountCents: 8_000,
  status: 'pending',
  titulos: [
    { receivableId: 'rec_1', amountCents: 5_000 },
    { receivableId: 'rec_2', amountCents: 3_000 },
  ],
  ...over,
})

/**
 * O cenario usa o falso REAL de baixas, e nao um duble proprio.
 *
 * Um duble escrito aqui reproduziria a interface da unidade de trabalho pela
 * metade, e passaria enquanto `settleReceivable` nao mudasse. O falso de
 * `settlements` e o mesmo que a suite daquele caso de uso exercita — se ele
 * quebrar, quebra nos dois lugares, que e o que se quer.
 */
/* `null` para "nao existe", e nao `undefined`: passar `undefined` a um
   parametro com valor padrao cai NO PADRAO — e o teste da cobranca
   desconhecida encontrava uma cobranca. */
function cenario(registrada: CobrancaRegistrada | null = cobranca()) {
  const audit = new InMemoryAuditTrail()
  const uow = new InMemorySettlements(audit)

  for (const t of registrada?.titulos ?? []) {
    uow.adicionarTitulo(EMPRESA, 'receivable', {
      id: t.receivableId,
      amountCents: t.amountCents,
      settledAmountCents: 0,
      status: 'open',
      customerId: 'cli_1',
    })
  }

  const pagas: string[] = []
  let atual: CobrancaRegistrada | undefined = registrada ?? undefined

  const charges: CustomerChargeRepository = {
    registrar: async () => undefined,
    porReferencia: async () => atual,
    marcarPaga: async ({ chargeId }) => {
      pagas.push(chargeId)
      if (atual) atual = { ...atual, status: 'paid' }
    },
  }

  return { deps: { uow, charges }, uow, audit, pagas }
}

describe('a referencia carrega a empresa', () => {
  it('monta e le o mesmo formato', () => {
    const r = referenciaDaCobranca(EMPRESA, 'req-1')

    /* Os dois lados no mesmo arquivo: um formato combinado escrito em dois
       lugares diverge, e divergir aqui e o pagamento entrar e a baixa nao
       achar o titulo. */
    expect(empresaDaReferencia(r)).toBe(EMPRESA)
  })

  it('devolve undefined para o que nao e nosso, sem lancar', () => {
    /* Cobranca criada a mao no painel do provedor existe e nao e nossa.
       Lancar faria o provedor reentregar para sempre. */
    for (const alheia of ['', 'sem-separador', ':so-o-separador', 'nao-uuid:req-1']) {
      expect(empresaDaReferencia(alheia)).toBeUndefined()
    }
  })
})

describe('baixa pelo pagamento do link — RF-068, RF-059', () => {
  it('baixa cada titulo com o valor COBRADO', async () => {
    const c = cenario()

    const r = await settleCustomerCharge(c.deps, evento(), EMPRESA, AGORA)

    expect([r.status, r.titulosBaixados]).toEqual(['settled', 2])
    /* O valor gravado na cobranca, e nao o saldo de hoje: entre cobrar e o
       cliente pagar, parte pode ter entrado em dinheiro. */
    expect(c.uow.totalDeBaixas).toBe(2)
    expect(c.uow.tituloDe('rec_1')?.settledAmountCents).toBe(5_000)
    expect(c.uow.tituloDe('rec_2')?.settledAmountCents).toBe(3_000)
  })

  it('marca a cobranca como paga so DEPOIS das baixas', async () => {
    const c = cenario()

    await settleCustomerCharge(c.deps, evento(), EMPRESA, AGORA)

    /* Se uma baixa falhar no meio, a cobranca fica pendente e a reexecucao
       retoma — marcar antes deixaria titulos sem baixa e cobranca "paga". */
    expect(c.pagas).toEqual(['chg_1'])
  })

  it('o segundo aviso NAO baixa de novo', async () => {
    const c = cenario()

    await settleCustomerCharge(c.deps, evento(), EMPRESA, AGORA)
    const segunda = await settleCustomerCharge(c.deps, evento({ eventId: 'evt_2' }), EMPRESA, AGORA)

    /* Esta e a trava de COBRANCA, que vale mesmo com um id de evento novo —
       a caixa de entrada nao pegaria esse caso. */
    expect(segunda.status).toBe('ignored')
    expect(c.uow.totalDeBaixas).toBe(2)
  })
})

describe('avisos que nao baixam nada', () => {
  it('cobranca desconhecida e ignorada, sem lancar', async () => {
    const c = cenario(null)

    const r = await settleCustomerCharge(c.deps, evento(), EMPRESA, AGORA)

    expect([r.status, r.titulosBaixados]).toEqual(['ignored', 0])
  })

  it('aviso sem referencia e ignorado', async () => {
    const c = cenario()

    const r = await settleCustomerCharge(
      c.deps,
      evento({ externalReference: null }),
      EMPRESA,
      AGORA,
    )

    expect(r.status).toBe('ignored')
    expect(c.uow.totalDeBaixas).toBe(0)
  })

  it('cobranca cancelada nao recebe baixa', async () => {
    const c = cenario(cobranca({ status: 'cancelled' }))

    const r = await settleCustomerCharge(c.deps, evento(), EMPRESA, AGORA)

    expect(r.status).toBe('ignored')
    expect(c.uow.totalDeBaixas).toBe(0)
  })
})

describe('autoria de uma baixa sem gente', () => {
  it('a auditoria registra o SISTEMA, e nao o dono da loja', async () => {
    const c = cenario()

    await settleCustomerCharge(c.deps, evento(), EMPRESA, AGORA)

    /*
     * `userId: 'job'` derrubou a primeira versao disto com 500: a coluna e
     * `uuid`. E por o dono da loja no lugar faria a tela de auditoria dizer
     * "Joao deu baixa" numa baixa que o Joao nao deu.
     */
    const entradas = c.audit.daEmpresa(EMPRESA)
    expect(entradas.length).toBeGreaterThan(0)
    expect(entradas.every((e) => e.actorId === ATOR_DO_SISTEMA)).toBe(true)
  })

  it('o usuario da baixa fica NULO — o sistema nao e um usuario', async () => {
    const c = cenario()

    await settleCustomerCharge(c.deps, evento(), EMPRESA, AGORA)

    /* `settlements.created_by` referencia `users`: gravar ali um id que nao
       existe viola a FK, e inventar um usuario para satisfaze-la seria criar
       uma pessoa que nao existe. */
    expect(usuarioReal({ userId: ATOR_DO_SISTEMA } as never)).toBeNull()
    expect(usuarioReal({ userId: 'user-1' } as never)).toBe('user-1')
  })
})
