import type { CreateReceivableInput, Role } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ExecutionContext } from '../context.js'
import { createReceivable } from './create-receivable.js'
import { InMemoryManualReceivables, InMemoryReceivables } from './fakes.js'
import { listReceivables } from './list-receivables.js'

/**
 * A lista de contas a receber — RF-064, RF-066.
 *
 * A rota faltava inteira: a baixa de recebivel existe desde a NR-029, mas nao
 * havia como LISTAR o que baixar. A tela do mobile e a do web mostravam
 * recebiveis de exemplo, e o botao de baixa apontava para ids que nao existiam
 * no banco.
 */

/* O dia de referencia dos testes. Quarta-feira, para as faixas de "semana" e
   "mes" nao caírem em fim de mes e mudarem de grupo. */
const AGORA = new Date('2026-09-09T12:00:00.000Z')

function contexto(sobrescreve: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: 'emp-1',
    userId: 'usr-1',
    role: 'owner' as Role,
    channel: 'app',
    requestId: 'req-1',
    now: AGORA,
    ...sobrescreve,
  }
}

const doGrupo = (r: Awaited<ReturnType<typeof listReceivables>>, faixa: string) =>
  r.grupos.find((g) => g.faixa === faixa)!

describe('pendencias de UM cliente — RF-072', () => {
  it('traz so as dele, e deixa de fora parcela de cartao, que quem deve e a operadora', async () => {
    const receivables = new InMemoryReceivables()
    receivables.adicionar('emp-1', {
      dueDate: '2026-09-20',
      customerId: 'cli-1',
      description: 'Fiado',
    })
    receivables.adicionar('emp-1', {
      dueDate: '2026-10-09',
      customerId: 'cli-1',
      description: 'Cartao de credito 1/3',
    })
    receivables.adicionar('emp-1', {
      dueDate: '2026-09-20',
      customerId: 'cli-2',
      description: 'Fiado',
    })

    const r = await listReceivables({ receivables }, contexto(), { customerId: 'cli-1' })

    expect(r.grupos.flatMap((g) => g.receivables.map((x) => x.description))).toEqual(['Fiado'])
  })

  it('a lista geral da loja continua com o cartao: e dinheiro a entrar', async () => {
    const receivables = new InMemoryReceivables()
    receivables.adicionar('emp-1', { dueDate: '2026-10-09', description: 'Cartao de credito 1/3' })

    const r = await listReceivables({ receivables }, contexto())

    expect(r.totalCents).toBe(10_000)
  })
})

describe('agrupar por vencimento — RF-064, RF-066', () => {
  it('separa vencido, hoje e futuro', async () => {
    const receivables = new InMemoryReceivables()
    receivables.adicionar('emp-1', { dueDate: '2026-09-01', description: 'Atrasado' })
    receivables.adicionar('emp-1', { dueDate: '2026-09-09', description: 'Hoje' })
    receivables.adicionar('emp-1', { dueDate: '2026-12-01', description: 'Longe' })

    const r = await listReceivables({ receivables }, contexto())

    expect(doGrupo(r, 'overdue').receivables.map((x) => x.description)).toEqual(['Atrasado'])
    expect(doGrupo(r, 'today').receivables.map((x) => x.description)).toEqual(['Hoje'])
    expect(doGrupo(r, 'later').receivables.map((x) => x.description)).toEqual(['Longe'])
  })

  /* Campo proprio, e nao "procure o grupo overdue": a tela de abertura
     pergunta uma coisa so, e obriga-la a percorrer a estrutura convida cada
     tela a responder de um jeito. */
  it('diz se ha vencido, sem obrigar a tela a procurar', async () => {
    const receivables = new InMemoryReceivables()
    receivables.adicionar('emp-1', { dueDate: '2026-09-01' })

    expect((await listReceivables({ receivables }, contexto())).temVencidas).toBe(true)
  })

  it('sem nada vencido, temVencidas e falso', async () => {
    const receivables = new InMemoryReceivables()
    receivables.adicionar('emp-1', { dueDate: '2026-12-01' })

    expect((await listReceivables({ receivables }, contexto())).temVencidas).toBe(false)
  })

  it('dentro do grupo, o que vence antes vem antes', async () => {
    const receivables = new InMemoryReceivables()
    receivables.adicionar('emp-1', { dueDate: '2026-09-03', description: 'Depois' })
    receivables.adicionar('emp-1', { dueDate: '2026-09-01', description: 'Antes' })

    const r = await listReceivables({ receivables }, contexto())

    expect(doGrupo(r, 'overdue').receivables.map((x) => x.description)).toEqual(['Antes', 'Depois'])
  })
})

describe('o total e o que FALTA receber', () => {
  /*
   * Num recebivel de mil reais com seiscentos ja recebidos, o total tem de
   * dizer quatrocentos — e o numero que responde "quanto ainda entra", que e a
   * pergunta que faz alguem abrir esta tela.
   */
  it('desconta o que ja foi baixado', async () => {
    const receivables = new InMemoryReceivables()
    receivables.adicionar('emp-1', {
      dueDate: '2026-09-09',
      amountCents: 100_000,
      settledAmountCents: 60_000,
      status: 'partially_settled',
    })

    const r = await listReceivables({ receivables }, contexto())

    expect(r.totalCents).toBe(40_000)
  })

  /*
   * Sobre o BRUTO, e nao o liquido. A baixa abate do que o cliente deve, e e
   * esse valor que ele paga; o liquido e o que sobra depois da tarifa da
   * adquirente. Somar o liquido faria a conta de mil parecer quitada com
   * novecentos e setenta recebidos.
   */
  it('soma o bruto, e nao o liquido previsto', async () => {
    const receivables = new InMemoryReceivables()
    receivables.adicionar('emp-1', {
      dueDate: '2026-09-09',
      amountCents: 100_000,
      netAmountCents: 97_000,
    })

    expect((await listReceivables({ receivables }, contexto())).totalCents).toBe(100_000)
  })

  it('o total geral e a soma dos grupos', async () => {
    const receivables = new InMemoryReceivables()
    receivables.adicionar('emp-1', { dueDate: '2026-09-01', amountCents: 30_000 })
    receivables.adicionar('emp-1', { dueDate: '2026-12-01', amountCents: 20_000 })

    const r = await listReceivables({ receivables }, contexto())

    expect(r.totalCents).toBe(50_000)
    expect(r.grupos.reduce((s, g) => s + g.totalCents, 0)).toBe(50_000)
  })
})

describe('so o que esta em aberto', () => {
  it.each(['settled', 'cancelled'] as const)('%s fica de fora', async (status) => {
    const receivables = new InMemoryReceivables()
    receivables.adicionar('emp-1', { dueDate: '2026-09-01', status })

    const r = await listReceivables({ receivables }, contexto())

    /* Recebivel ja recebido nao pertence a "o que entra esta semana", e
       cancelado nao pertence a lugar nenhum. */
    expect(r.totalCents).toBe(0)
    expect(r.temVencidas).toBe(false)
  })

  it('parcialmente baixado CONTINUA na lista', async () => {
    const receivables = new InMemoryReceivables()
    receivables.adicionar('emp-1', {
      dueDate: '2026-09-01',
      status: 'partially_settled',
      settledAmountCents: 5_000,
    })

    /* O que sobrou ainda e devido, e some-lo e o ponto da tela. */
    expect((await listReceivables({ receivables }, contexto())).totalCents).toBe(5_000)
  })
})

describe('isolamento por empresa', () => {
  it('recebivel de outra loja nao aparece', async () => {
    const receivables = new InMemoryReceivables()
    receivables.adicionar('emp-2', { dueDate: '2026-09-01', amountCents: 99_999 })

    const r = await listReceivables({ receivables }, contexto({ companyId: 'emp-1' }))

    expect(r.totalCents).toBe(0)

    /* Controle: a linha EXISTE — o zero acima vem do isolamento, e nao de um
       repositorio vazio. */
    const naDela = await listReceivables({ receivables }, contexto({ companyId: 'emp-2' }))
    expect(naDela.totalCents).toBe(99_999)
  })
})

describe('quem pode ver', () => {
  /* `accountant` e somente leitura, e e quem mais consulta esta lista. */
  it('accountant consulta', async () => {
    const receivables = new InMemoryReceivables()
    receivables.adicionar('emp-1', { dueDate: '2026-09-09' })

    const r = await listReceivables({ receivables }, contexto({ role: 'accountant' as Role }))

    expect(r.totalCents).toBe(10_000)
  })
})

describe('venda sem cliente identificado', () => {
  /* Caminho normal no balcao (RF-009). O nome nulo nao pode fazer o recebivel
     sumir da lista — seria dinheiro a receber que a tela nao mostra. */
  it('entra na lista, com o nome nulo', async () => {
    const receivables = new InMemoryReceivables()
    receivables.adicionar('emp-1', { dueDate: '2026-09-09', customerId: null })

    const r = await listReceivables({ receivables }, contexto())

    expect(doGrupo(r, 'today').receivables).toHaveLength(1)
    expect(doGrupo(r, 'today').receivables[0]?.customerName).toBeNull()
  })
})

function recebivel(over: Partial<CreateReceivableInput> = {}): CreateReceivableInput {
  return {
    description: 'Aluguel de sala comercial',
    amountCents: 80_000,
    dueDate: '2026-09-15',
    ...over,
  }
}

/*
 * A trilha nasce primeiro e entra na unidade de trabalho: desde a NR-087 a
 * auditoria acontece DENTRO da transacao, e duas instancias fariam o teste
 * procurar na vazia.
 */
function depsManual(audit = new InMemoryAuditTrail(), rec = new InMemoryManualReceivables(audit)) {
  return { uow: rec, audit, rec }
}

describe('lancar recebivel avulso — RF-065', () => {
  it('grava descricao, valor e vencimento', async () => {
    const d = depsManual()

    const gravado = await createReceivable(d, contexto(), recebivel())

    expect(gravado.description).toBe('Aluguel de sala comercial')
    expect(gravado.amountCents).toBe(80_000)
    expect(gravado.dueDate).toBe('2026-09-15')
    expect(gravado.status).toBe('open')
  })

  it('liquido e bruto sao o mesmo valor — nao ha tarifa de adquirente', async () => {
    const d = depsManual()

    const gravado = await createReceivable(d, contexto(), recebivel({ amountCents: 50_000 }))

    expect(gravado.netAmountCents).toBe(50_000)
  })

  it('nasce sem nada baixado, e sem venda nem parcela', async () => {
    const d = depsManual()

    const gravado = await createReceivable(d, contexto(), recebivel())

    expect(gravado.settledAmountCents).toBe(0)
    expect(gravado.saleId).toBeNull()
    expect(gravado.installmentNumber).toBe(1)
    expect(gravado.installmentCount).toBe(1)
  })

  it('sem cliente identificado, o nome fica nulo', async () => {
    const d = depsManual()

    const gravado = await createReceivable(d, contexto(), recebivel())

    expect(gravado.customerId).toBeNull()
  })

  it('com cliente, guarda o id', async () => {
    const d = depsManual()

    const gravado = await createReceivable(d, contexto(), recebivel({ customerId: 'cli-1' }))

    expect(gravado.customerId).toBe('cli-1')
  })
})

describe('autorizacao por papel — recebivel avulso', () => {
  it.each(['owner', 'staff'] as const)('%s lanca recebivel', async (role) => {
    const d = depsManual()

    const gravado = await createReceivable(d, contexto({ role }), recebivel())

    expect(gravado.id).toBeTruthy()
  })

  it('accountant nao lanca', async () => {
    const d = depsManual()

    try {
      await createReceivable(d, contexto({ role: 'accountant' as Role }), recebivel())
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
    }
  })
})

describe('trilha de auditoria do recebivel avulso — RF-123', () => {
  it('o lancamento deixa uma entrada', async () => {
    const audit = new InMemoryAuditTrail()
    const d = depsManual(audit)

    await createReceivable(d, contexto(), recebivel())

    expect(audit.total).toBe(1)
    expect(audit.daEmpresa('emp-1')[0]?.after).toMatchObject({ amountCents: 80_000 })
  })
})
