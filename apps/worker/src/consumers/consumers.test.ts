import { createFakeInvoiceIssuer } from '@na-regua/fiscal'
import { createFakeMessageSender } from '@na-regua/whatsapp'
import { describe, expect, it } from 'vitest'
import { QUEUES } from '../queues.js'
import { ehPermanente } from '../retry.js'
import { consumirCobranca } from './charge-overdue.js'
import { consumidorDe, filasSemConsumidor } from './index.js'
import { consumirEmissao } from './invoice-issue.js'
import type { ConsumerDeps, RecebivelVencido } from './types.js'
import { consumirEnvio, mascarar } from './whatsapp-send.js'

const AGORA = new Date('2026-09-02T12:00:00.000Z')

type Enfileirado = { readonly queue: string; readonly payload: unknown }

function deps(over: Partial<ConsumerDeps> = {}) {
  const enfileirados: Enfileirado[] = []
  const d: ConsumerDeps = {
    invoices: createFakeInvoiceIssuer(),
    messages: createFakeMessageSender(),
    overdue: { listOverdue: async () => [] },
    enqueue: { add: async (queue, payload) => void enfileirados.push({ queue, payload }) },
    now: () => AGORA,
    conversations: {
      deleteMessagesOlderThan: async () => 0,
      closeConversationsWithoutMessages: async () => 0,
    },
    listTenantIds: async () => [],
    ...over,
  }
  return { d, enfileirados }
}

const pedidoDeEmissao = {
  companyId: 'empresa-1',
  saleId: 'venda-1',
  series: 1,
  items: [
    {
      productId: 'prod-cafe',
      description: 'Cafe 500g',
      quantity: 1,
      unitPriceCents: 1990,
      unitOfMeasure: 'un',
      ncm: '09011110',
      cfop: '5102',
      taxSituationCode: '102',
    },
  ],
  payments: [{ method: 'cash', amountCents: 1990 }],
  requestedAt: AGORA.toISOString(),
}

describe('emissao fiscal — RNF-004', () => {
  it('nota autorizada conclui o job com a chave', async () => {
    const { d } = deps()

    const r = await consumirEmissao(d, pedidoDeEmissao)

    expect(r.outcome).toBe('authorized')
    expect(r.detalhes?.accessKey).toBeTruthy()
  })

  /**
   * O ponto da tarefa. Retentar uma rejeicao reenviaria o mesmo XML invalido
   * cinco vezes, com espera crescente, para receber cinco vezes a mesma
   * recusa — escondendo do lojista por quarenta segundos que a nota nao saiu.
   * O que resolve e alguem corrigir o cadastro.
   */
  it('rejeicao CONCLUI o job em vez de lancar', async () => {
    const { d } = deps({
      invoices: createFakeInvoiceIssuer({
        rejeitarCom: { code: '539', message: 'Duplicidade de NF-e' },
      }),
    })

    const r = await consumirEmissao(d, pedidoDeEmissao)

    expect(r.outcome).toBe('rejected')
  })

  /* Contingencia e desfecho valido (RF-052): retentar geraria uma SEGUNDA nota
     para a mesma venda, e nota duplicada e problema fiscal. */
  it('contingencia CONCLUI o job em vez de lancar', async () => {
    const { d } = deps({ invoices: createFakeInvoiceIssuer({ sefazDisponivel: false }) })

    const r = await consumirEmissao(d, pedidoDeEmissao)

    expect(r.outcome).toBe('contingency')
  })

  /* Falha de infraestrutura DEVE subir: engolir aqui transformaria uma SEFAZ
     fora do ar em nota que nunca sai e ninguem procura. */
  it('falha de infraestrutura sobe, para o BullMQ retentar', async () => {
    const { d } = deps({
      invoices: {
        issue: async () => {
          throw new Error('ECONNRESET')
        },
        /* Este consumidor so emite: cancelar e consultar nao passam por ele, e
           lancar deixa isso explicito em vez de devolver um valor plausivel. */
        cancel: async () => {
          throw new Error('nao usado')
        },
        consult: async () => {
          throw new Error('nao usado')
        },
      },
    })

    await expect(consumirEmissao(d, pedidoDeEmissao)).rejects.toThrow('ECONNRESET')
  })

  /* Payload malformado nao melhora na quinta tentativa: quem enfileirou errou. */
  it('payload invalido e falha PERMANENTE, sem retentar', async () => {
    const { d } = deps()

    try {
      await consumirEmissao(d, { saleId: 'venda-1' })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(ehPermanente(erro)).toBe(true)
    }
  })
})

describe('envio de mensagem', () => {
  const envio = {
    companyId: 'empresa-1',
    to: '5541999990000',
    body: 'Ola!',
    consent: { basis: 'own_user' as const },
    idempotencyKey: 'msg-1',
    requestedAt: AGORA.toISOString(),
  }

  it('envio bem-sucedido conclui com o id do provedor', async () => {
    const { d } = deps()

    const r = await consumirEnvio(d, envio)

    expect(r.outcome).toBe('sent')
    expect(r.detalhes?.messageId).toBeTruthy()
  })

  /**
   * Aqui o motivo de nao retentar e legal, nao tecnico: se o provedor recusou
   * por falta de consentimento (RF-016), cada nova tentativa e outra tentativa
   * de contatar quem nao quer ser contatado.
   */
  it('recusa CONCLUI o job — insistir automaticamente seria o defeito', async () => {
    const { d } = deps({
      messages: createFakeMessageSender({
        recusas: { '5541999990000': 'blocked_by_recipient' },
      }),
    })

    const r = await consumirEnvio(d, envio)

    expect(r.outcome).toBe('rejected')
  })

  it('payload invalido e falha permanente', async () => {
    const { d } = deps()

    try {
      await consumirEnvio(d, { ...envio, body: '' })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(ehPermanente(erro)).toBe(true)
    }
  })

  /* Log de fila e agregado e fica retido: numero inteiro ali vira lista de
     contatos num lugar que ninguem trata como dado pessoal. */
  it('o telefone sai mascarado no resultado', async () => {
    const { d } = deps()

    const r = await consumirEnvio(d, envio)

    expect(r.detalhes?.to).toBe('****0000')
    expect(String(r.detalhes?.to)).not.toContain('554199999')
  })

  it.each([
    ['5541999990000', '****0000'],
    ['+55 (41) 99999-1234', '****1234'],
    ['123', '****'],
  ])('mascara %s como %s', (entrada, esperado) => {
    expect(mascarar(entrada)).toBe(esperado)
  })
})

describe('varredura de cobranca', () => {
  const vencido = (over: Partial<RecebivelVencido> = {}): RecebivelVencido => ({
    companyId: 'empresa-1',
    receivableId: 'rec-1',
    customerName: 'Dona Marta',
    phone: '5541999990000',
    amountCents: 5_000,
    dueDate: '2026-08-20',
    ...over,
  })

  /**
   * Um job por mensagem, e nao trezentos envios dentro de um. Se o job falhasse
   * no envio 280, retentar reenviaria os 279 primeiros — e quem ja recebeu a
   * cobranca receberia de novo.
   */
  it('enfileira um envio por vencido, em vez de enviar direto', async () => {
    const { d, enfileirados } = deps({
      overdue: {
        listOverdue: async () => [
          vencido({ receivableId: 'rec-1' }),
          vencido({ receivableId: 'rec-2' }),
        ],
      },
    })

    const r = await consumirCobranca(d)

    expect(enfileirados).toHaveLength(2)
    expect(enfileirados[0]?.queue).toBe(QUEUES.whatsappSend)
    expect(r.detalhes?.enfileirados).toBe(2)
  })

  it('usa a data de hoje do contexto, nao o relogio real', async () => {
    let recebido = ''
    const { d } = deps({
      overdue: {
        listOverdue: async (hoje) => {
          recebido = hoje
          return []
        },
      },
    })

    await consumirCobranca(d)

    expect(recebido).toBe('2026-09-02')
  })

  /* Parar no primeiro erro deixaria os demais sem cobranca por causa de um. */
  it('uma falha ao enfileirar nao derruba as outras', async () => {
    let chamadas = 0
    const { d } = deps({
      overdue: {
        listOverdue: async () => [
          vencido({ receivableId: 'rec-1' }),
          vencido({ receivableId: 'rec-2' }),
          vencido({ receivableId: 'rec-3' }),
        ],
      },
      enqueue: {
        add: async () => {
          chamadas += 1
          if (chamadas === 2) throw new Error('Redis instavel')
        },
      },
    })

    const r = await consumirCobranca(d)

    expect(r.detalhes?.enfileirados).toBe(2)
    expect(r.detalhes?.falhas).toEqual(['rec-2'])
  })

  /* "Varredura concluida" sem numero nao distingue trezentas cobrancas de zero. */
  it('sem vencidos, o resultado diz zero em vez de so "ok"', async () => {
    const { d } = deps()

    const r = await consumirCobranca(d)

    expect(r.detalhes).toMatchObject({ vencidos: 0, enfileirados: 0 })
  })

  it('a mensagem traz o nome do cliente e o dia do vencimento', async () => {
    const { d, enfileirados } = deps({ overdue: { listOverdue: async () => [vencido()] } })

    await consumirCobranca(d)

    const corpo = String((enfileirados[0]?.payload as { body: string }).body)
    expect(corpo).toContain('Dona Marta')
    expect(corpo).toContain('20/08')
  })
})

describe('registro de consumidores', () => {
  it.each([
    QUEUES.invoiceIssue,
    QUEUES.whatsappSend,
    QUEUES.chargeOverdue,
    QUEUES.conversationPurge,
  ])('%s tem consumidor', (fila) => {
    expect(consumidorDe(fila)).toBeDefined()
  })

  /* O tipo diz que faltam, em vez de esconder num default que trata tudo igual
     — senao o dia em que alguem cria fila e esquece o consumidor e um dia em
     que jobs somem em silencio. */
  it('as filas sem consumidor sao declaradas, nao escondidas', () => {
    expect(filasSemConsumidor()).toEqual([QUEUES.bankSync, QUEUES.webhookProcess])
  })
})
