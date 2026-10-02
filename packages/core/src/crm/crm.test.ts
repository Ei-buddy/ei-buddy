import type { Role } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import { isAppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import { commentOnCrmCard, createCrmCard, listCrmBoard, listTeam, moveCrmCard } from './crm.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import { InMemoryCrm, InMemoryTeam } from './fakes.js'

/**
 * O quadro de CRM — NR-109.
 *
 * Modulo inteiro novo: nao havia porta, caso de uso nem tela real. A tela
 * montava o quadro a partir de `mock-data`, e criar card, mover coluna e
 * comentar eram `await delay(...)` seguidos de sucesso — nada era gravado.
 */

const AGORA = new Date('2026-09-11T13:00:00.000Z')

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

const cardValido = {
  title: 'Retomar contato com quem sumiu',
  kind: 'contact' as const,
  dueOn: '2026-09-15',
}

describe('trilha do CRM — RF-123', () => {
  it('criar e mover o card entram na trilha', async () => {
    const crm = new InMemoryCrm()
    const audit = new InMemoryAuditTrail()

    const card = await createCrmCard({ crm, audit }, contexto(), cardValido)
    await moveCrmCard({ crm, audit }, contexto(), card.id, 'done')

    expect(audit.daEmpresa(contexto().companyId).map((e) => [e.entity, e.action, e.after])).toEqual(
      [
        ['CrmCard', 'created', { title: card.title, column: 'todo' }],
        ['CrmCard', 'updated', { column: 'done', from: 'todo' }],
      ],
    )
  })
})

describe('createCrmCard', () => {
  it('cria com o minimo e nasce na coluna todo', async () => {
    const crm = new InMemoryCrm()

    const card = await createCrmCard({ crm }, contexto(), cardValido)

    expect(card.column).toBe('todo')
    expect(card.customerId).toBeNull()
    expect(card.assigneeUserId).toBeNull()
  })

  it('traz o nome do cliente e do responsavel junto — sem segunda chamada', async () => {
    const crm = new InMemoryCrm()
    crm.clientes.set('cli-1', 'Joana Ribeiro')
    crm.usuarios.set('usr-2', 'Marina Alves')

    const card = await createCrmCard({ crm }, contexto(), {
      ...cardValido,
      customerId: 'cli-1',
      assigneeUserId: 'usr-2',
    })

    expect(card.customerName).toBe('Joana Ribeiro')
    expect(card.assigneeName).toBe('Marina Alves')
  })

  it('recusa escrita de quem so pode ler', async () => {
    const crm = new InMemoryCrm()

    await expect(
      createCrmCard({ crm }, contexto({ role: 'accountant' as Role }), cardValido),
    ).rejects.toThrow(/somente de leitura/i)
  })
})

describe('listCrmBoard', () => {
  it('devolve so os cards da propria empresa, do mais recente para o mais antigo', async () => {
    const crm = new InMemoryCrm()
    await createCrmCard({ crm }, contexto({ companyId: 'emp-1', now: new Date('2026-09-01') }), {
      ...cardValido,
      title: 'Mais antigo',
    })
    await createCrmCard({ crm }, contexto({ companyId: 'emp-1', now: new Date('2026-09-10') }), {
      ...cardValido,
      title: 'Mais novo',
    })
    await createCrmCard({ crm }, contexto({ companyId: 'emp-2' }), {
      ...cardValido,
      title: 'De outra loja',
    })

    const r = await listCrmBoard({ crm }, contexto({ companyId: 'emp-1' }))

    expect(r.cards.map((c) => c.title)).toEqual(['Mais novo', 'Mais antigo'])
  })

  it('accountant consulta — e leitura de negocio', async () => {
    const crm = new InMemoryCrm()
    await createCrmCard({ crm }, contexto(), cardValido)

    const r = await listCrmBoard({ crm }, contexto({ role: 'accountant' as Role }))

    expect(r.cards).toHaveLength(1)
  })
})

describe('moveCrmCard', () => {
  it('move para outra coluna', async () => {
    const crm = new InMemoryCrm()
    const criado = await createCrmCard({ crm }, contexto(), cardValido)

    const movido = await moveCrmCard({ crm }, contexto(), criado.id, 'done')

    expect(movido.column).toBe('done')
  })

  /* "Concluir" e so mover para `done` — nao ha um segundo verbo. */
  it('mover para done e como a tela representa "concluir"', async () => {
    const crm = new InMemoryCrm()
    const criado = await createCrmCard({ crm }, contexto(), cardValido)

    const concluido = await moveCrmCard({ crm }, contexto(), criado.id, 'done')

    expect(concluido.column).toBe('done')
  })

  it('card de outra empresa responde NOT_FOUND, e nao FORBIDDEN', async () => {
    const crm = new InMemoryCrm()
    const criado = await createCrmCard({ crm }, contexto({ companyId: 'emp-1' }), cardValido)

    /* FORBIDDEN confirmaria que o id existe em alguma loja. */
    const erro = await moveCrmCard(
      { crm },
      contexto({ companyId: 'emp-2' }),
      criado.id,
      'done',
    ).catch((e: unknown) => e)

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })

  it('id inexistente responde NOT_FOUND', async () => {
    const crm = new InMemoryCrm()

    const erro = await moveCrmCard({ crm }, contexto(), 'crm-fantasma', 'done').catch(
      (e: unknown) => e,
    )

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })

  it('accountant nao move — e escrita', async () => {
    const crm = new InMemoryCrm()
    const criado = await createCrmCard({ crm }, contexto(), cardValido)

    await expect(
      moveCrmCard({ crm }, contexto({ role: 'accountant' as Role }), criado.id, 'done'),
    ).rejects.toThrow(/somente de leitura/i)
  })
})

describe('commentOnCrmCard', () => {
  it('adiciona o comentario e ele aparece na leitura do card', async () => {
    const crm = new InMemoryCrm()
    crm.usuarios.set('usr-1', 'Marina Alves')
    const criado = await createCrmCard({ crm }, contexto(), cardValido)

    await commentOnCrmCard({ crm }, contexto(), criado.id, 'Mandei o catalogo de setembro.')

    const lido = await crm.findById('emp-1', criado.id)
    expect(lido?.comments).toHaveLength(1)
    expect(lido?.comments[0]).toMatchObject({
      text: 'Mandei o catalogo de setembro.',
      authorName: 'Marina Alves',
    })
  })

  /*
   * Sem `assertCanWrite`: comentar e registrar acompanhamento, e travar isso
   * para quem so tem papel de leitura contradiria o proprio motivo de existir
   * do comentario.
   */
  it('accountant tambem comenta', async () => {
    const crm = new InMemoryCrm()
    const criado = await createCrmCard({ crm }, contexto(), cardValido)

    await expect(
      commentOnCrmCard({ crm }, contexto({ role: 'accountant' as Role }), criado.id, 'Ok.'),
    ).resolves.toBeTruthy()
  })

  it('card de outra empresa responde NOT_FOUND', async () => {
    const crm = new InMemoryCrm()
    const criado = await createCrmCard({ crm }, contexto({ companyId: 'emp-1' }), cardValido)

    const erro = await commentOnCrmCard(
      { crm },
      contexto({ companyId: 'emp-2' }),
      criado.id,
      'Ok.',
    ).catch((e: unknown) => e)

    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })
})

describe('listTeam', () => {
  it('devolve so a equipe da propria empresa', async () => {
    const team = new InMemoryTeam()
    team.adicionar('emp-1', { id: 'usr-1', name: 'Marina Alves' })
    team.adicionar('emp-2', { id: 'usr-9', name: 'De outra loja' })

    const r = await listTeam({ team }, contexto({ companyId: 'emp-1' }))

    expect(r.members).toEqual([{ id: 'usr-1', name: 'Marina Alves' }])
  })
})
