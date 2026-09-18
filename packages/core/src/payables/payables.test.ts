import type { CreatePayableInput } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ExecutionContext } from '../context.js'
import { createPayable } from './create-payable.js'
import { endRecurrence } from './end-recurrence.js'
import { InMemoryPayables } from './fakes.js'
import { listPayables } from './list-payables.js'

/** Hoje e 02/09/2026 para toda a suite. */
const AGORA = new Date('2026-09-02T12:00:00.000Z')

function contexto(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: 'empresa-1',
    userId: 'usuario-1',
    role: 'owner',
    channel: 'app',
    requestId: 'req-1',
    now: AGORA,
    ...over,
  }
}

function conta(over: Partial<CreatePayableInput> = {}): CreatePayableInput {
  return {
    supplier: 'Copel',
    description: 'Energia da loja',
    amountCents: 48_000,
    dueDate: '2026-09-10',
    ...over,
  }
}

/*
 * A trilha nasce primeiro e entra na unidade de trabalho: desde a NR-087 a
 * auditoria acontece DENTRO da transacao (ver `TransactionalAuditTrail`), e
 * duas instancias fariam o teste procurar na vazia.
 */
function deps(audit = new InMemoryAuditTrail(), pag = new InMemoryPayables(audit)) {
  return { uow: pag, ids: pag, audit, pag }
}

describe('lancar conta a pagar — RF-055', () => {
  it('grava fornecedor, valor e vencimento', async () => {
    const d = deps()

    const [gravada] = await createPayable(d, contexto(), conta())

    expect(gravada?.supplier).toBe('Copel')
    expect(gravada?.amountCents).toBe(48_000)
    expect(gravada?.dueDate).toBe('2026-09-10')
    expect(gravada?.status).toBe('open')
  })

  it('nasce sem nada baixado', async () => {
    const d = deps()

    const [gravada] = await createPayable(d, contexto(), conta())

    expect(gravada?.settledAmountCents).toBe(0)
  })

  it('guarda a chave do anexo, nao o arquivo', async () => {
    const d = deps()

    const [gravada] = await createPayable(
      d,
      contexto(),
      conta({ attachmentKey: 'empresa-1/contas/copel-set.pdf' }),
    )

    expect(gravada?.attachmentKey).toBe('empresa-1/contas/copel-set.pdf')
  })

  it('conta avulsa nao pertence a recorrencia nenhuma', async () => {
    const d = deps()

    const [gravada] = await createPayable(d, contexto(), conta())

    expect(gravada?.recurrenceId).toBeNull()
    expect(gravada?.occurrenceNumber).toBeNull()
  })
})

describe('recorrencia — RF-057', () => {
  it('gera uma linha por ocorrencia, nao uma regra', async () => {
    const d = deps()

    const geradas = await createPayable(
      d,
      contexto(),
      conta({ recurrence: { frequency: 'monthly', occurrences: 12 } }),
    )

    expect(geradas).toHaveLength(12)
  })

  /* O teto de 120 vive no dominio; aqui so se confirma que ele chega. */
  it('mantem o dia do vencimento nos meses curtos', async () => {
    const d = deps()

    const geradas = await createPayable(
      d,
      contexto(),
      conta({ dueDate: '2026-01-31', recurrence: { frequency: 'monthly', occurrences: 4 } }),
    )

    expect(geradas.map((g) => g.dueDate)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
  })

  it('numera as ocorrencias como a tela mostra — 3/12', async () => {
    const d = deps()

    const geradas = await createPayable(
      d,
      contexto(),
      conta({ recurrence: { frequency: 'monthly', occurrences: 12 } }),
    )

    expect(geradas[2]?.occurrenceNumber).toBe(3)
    expect(geradas[2]?.occurrenceCount).toBe(12)
  })

  it('todas as ocorrencias compartilham o mesmo id de serie', async () => {
    const d = deps()

    const geradas = await createPayable(
      d,
      contexto(),
      conta({ recurrence: { frequency: 'monthly', occurrences: 3 } }),
    )

    expect(new Set(geradas.map((g) => g.recurrenceId)).size).toBe(1)
    expect(geradas[0]?.recurrenceId).toBe('rec-1')
  })

  /* Metade de uma recorrencia gravada e pior que nenhuma: o lojista veria algo
     que existe pela metade sem saber ate quando vale. */
  it('falha no meio nao deixa recorrencia pela metade', async () => {
    const d = deps()
    d.pag.falharDepoisDeGravar = true

    await expect(
      createPayable(
        d,
        contexto(),
        conta({ recurrence: { frequency: 'monthly', occurrences: 12 } }),
      ),
    ).rejects.toThrow()

    expect(d.pag.todas('empresa-1')).toEqual([])
  })
})

describe('encerrar a recorrencia — RF-058', () => {
  async function serieDe12() {
    const d = deps()
    await createPayable(
      d,
      contexto(),
      conta({ dueDate: '2026-07-10', recurrence: { frequency: 'monthly', occurrences: 12 } }),
    )
    return d
  }

  /* Encerrar NAO e apagar a serie: o que ja venceu e divida que existe mesmo
     que o lojista nao queira mais repetir a conta. */
  it('cancela so o futuro e preserva o passado', async () => {
    const d = await serieDe12()

    const r = await endRecurrence(d, contexto(), { recurrenceId: 'rec-1' })

    /* Vencimentos 10/07 e 10/08 ficaram para tras de 02/09. */
    expect(r.kept).toBe(2)
    expect(r.cancelled).toBe(10)
  })

  it('as preservadas continuam em aberto', async () => {
    const d = await serieDe12()
    await endRecurrence(d, contexto(), { recurrenceId: 'rec-1' })

    const passadas = d.pag.todas('empresa-1').filter((c) => c.dueDate < '2026-09-02')
    expect(passadas.every((c) => c.status === 'open')).toBe(true)
  })

  it('recusa encerrar recorrencia que nao existe', async () => {
    const d = deps()

    try {
      await endRecurrence(d, contexto(), { recurrenceId: 'rec-inexistente' })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
    }
  })

  /* Dizer "pronto" faria o lojista achar que evitou uma cobranca futura que ja
     tinha acontecido. */
  it('recusa quando nao ha futuro para encerrar', async () => {
    const d = await serieDe12()
    await endRecurrence(d, contexto(), { recurrenceId: 'rec-1' })

    try {
      await endRecurrence(d, contexto(), { recurrenceId: 'rec-1' })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('CONFLICT')
    }
  })

  it('recorrencia de outra empresa responde NOT_FOUND', async () => {
    const d = await serieDe12()

    try {
      await endRecurrence(d, contexto({ companyId: 'empresa-2' }), { recurrenceId: 'rec-1' })
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
    }
  })
})

describe('agrupar por vencimento — RF-061, RF-062', () => {
  async function comContas(vencimentos: readonly string[]) {
    const d = deps()
    for (const dueDate of vencimentos) {
      await createPayable(d, contexto(), conta({ dueDate }))
    }
    return d
  }

  it('separa vencidas, hoje, semana e mes', async () => {
    const d = await comContas(['2026-08-20', '2026-09-02', '2026-09-05', '2026-09-25'])

    const r = await listPayables(d.pag, contexto())
    const tamanho = Object.fromEntries(r.grupos.map((g) => [g.faixa, g.payables.length]))

    expect(tamanho).toMatchObject({ overdue: 1, today: 1, week: 1, month: 1 })
  })

  it('destaca que ha conta vencida — RF-062', async () => {
    const vencida = await comContas(['2026-08-20'])
    const emDia = await comContas(['2026-09-25'])

    expect((await listPayables(vencida.pag, contexto())).temVencidas).toBe(true)
    expect((await listPayables(emDia.pag, contexto())).temVencidas).toBe(false)
  })

  it('dentro do grupo, o que vence antes vem antes', async () => {
    const d = await comContas(['2026-09-08', '2026-09-04', '2026-09-06'])

    const semana = (await listPayables(d.pag, contexto())).grupos.find((g) => g.faixa === 'week')

    expect(semana?.payables.map((p) => p.dueDate)).toEqual([
      '2026-09-04',
      '2026-09-06',
      '2026-09-08',
    ])
  })

  it('o total do grupo soma o valor de cada conta', async () => {
    const d = await comContas(['2026-09-04', '2026-09-06'])

    const semana = (await listPayables(d.pag, contexto())).grupos.find((g) => g.faixa === 'week')

    expect(semana?.totalCents).toBe(96_000)
  })

  it('grupo vazio aparece com total zero, em vez de sumir', async () => {
    const d = await comContas(['2026-09-04'])

    const r = await listPayables(d.pag, contexto())

    /* A tela mostra as cinco faixas sempre: uma que some faria o lojista achar
       que a consulta falhou. */
    expect(r.grupos).toHaveLength(5)
    expect(r.grupos.find((g) => g.faixa === 'overdue')?.totalCents).toBe(0)
  })

  it('conta cancelada nao aparece em grupo nenhum', async () => {
    const d = deps()
    /* Serie de 10/07, 10/08 e 10/09. Hoje e 02/09, entao encerrar cancela so a
       ultima — as duas do passado continuam em aberto e continuam na lista. */
    await createPayable(
      d,
      contexto(),
      conta({ dueDate: '2026-07-10', recurrence: { frequency: 'monthly', occurrences: 3 } }),
    )
    await endRecurrence(d, contexto(), { recurrenceId: 'rec-1' })

    const r = await listPayables(d.pag, contexto())

    expect(r.grupos.flatMap((g) => g.payables)).toHaveLength(2)
  })

  it('a lista de uma loja nao traz conta da outra', async () => {
    const d = deps()
    await createPayable(d, contexto(), conta())
    await createPayable(d, contexto({ companyId: 'empresa-2' }), conta())

    const r = await listPayables(d.pag, contexto())

    expect(r.grupos.flatMap((g) => g.payables)).toHaveLength(1)
  })

  it('agrupa contas depois do mes em later, com total proprio — NR-115', async () => {
    const d = await comContas([
      '2026-08-20',
      '2026-09-02',
      '2026-09-05',
      '2026-09-25',
      '2027-01-01',
    ])

    const r = await listPayables(d.pag, contexto())
    const later = r.grupos.find((g) => g.faixa === 'later')

    expect(later?.payables).toHaveLength(1)
    expect(later?.totalCents).toBe(48_000)
    expect(r.totalCents).toBe(240_000)
  })

  it('sem contas abertas devolve total zero e cinco grupos vazios — NR-115', async () => {
    const r = await listPayables(deps().pag, contexto())

    expect(r.totalCents).toBe(0)
    expect(r.temVencidas).toBe(false)
    expect(r.grupos).toHaveLength(5)
    expect(r.grupos.every((g) => g.payables.length === 0 && g.totalCents === 0)).toBe(true)
  })

  it('total do grupo soma so o valor em aberto — NR-115', async () => {
    const d = deps()
    const [gravada] = await createPayable(
      d,
      contexto(),
      conta({ dueDate: '2026-09-05', amountCents: 10_000 }),
    )
    const emMemoria = d.pag.todas('empresa-1')[0] as {
      settledAmountCents: number
      status: 'open' | 'partially_settled'
    }
    emMemoria.settledAmountCents = 3_000
    emMemoria.status = 'partially_settled'

    const semana = (await listPayables(d.pag, contexto())).grupos.find((g) => g.faixa === 'week')

    expect(gravada?.id).toBeTruthy()
    expect(semana?.totalCents).toBe(7_000)
  })
})

describe('autorizacao por papel', () => {
  it.each(['owner', 'staff'] as const)('%s lanca conta', async (role) => {
    const d = deps()

    const [gravada] = await createPayable(d, contexto({ role }), conta())

    expect(gravada?.id).toBeTruthy()
  })

  it('accountant nao lanca', async () => {
    const d = deps()

    try {
      await createPayable(d, contexto({ role: 'accountant' }), conta())
      expect.fail('deveria ter recusado')
    } catch (erro) {
      expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
    }
  })

  it('accountant nao encerra recorrencia', async () => {
    const d = deps()
    await createPayable(
      d,
      contexto(),
      conta({ recurrence: { frequency: 'monthly', occurrences: 3 } }),
    )

    await expect(
      endRecurrence(d, contexto({ role: 'accountant' }), { recurrenceId: 'rec-1' }),
    ).rejects.toThrow()
  })

  /* Somente leitura nao e sem acesso — e justamente quem mais consulta. */
  it('accountant CONSULTA a lista', async () => {
    const d = deps()
    await createPayable(d, contexto(), conta())

    const r = await listPayables(d.pag, contexto({ role: 'accountant' }))

    expect(r.grupos.flatMap((g) => g.payables)).toHaveLength(1)
  })
})

describe('trilha de auditoria — RF-123', () => {
  it('o lancamento deixa uma entrada, nao uma por ocorrencia', async () => {
    const audit = new InMemoryAuditTrail()
    const d = deps(audit)

    await createPayable(
      d,
      contexto(),
      conta({ recurrence: { frequency: 'monthly', occurrences: 12 } }),
    )

    /* Doze linhas identicas na trilha escondem as que importam. */
    expect(audit.total).toBe(1)
    expect(audit.daEmpresa('empresa-1')[0]?.after).toMatchObject({ occurrences: 12 })
  })

  it('encerrar a recorrencia tambem deixa rastro', async () => {
    const audit = new InMemoryAuditTrail()
    const d = deps(audit)
    await createPayable(
      d,
      contexto(),
      conta({ dueDate: '2026-07-10', recurrence: { frequency: 'monthly', occurrences: 12 } }),
    )

    await endRecurrence(d, contexto(), { recurrenceId: 'rec-1' })

    expect(audit.daEmpresa('empresa-1')[1]?.action).toBe('cancelled')
  })
})
