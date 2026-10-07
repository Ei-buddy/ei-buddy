import type { PendingConfirmation } from '@na-regua/core'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryConfirmations } from '../confirmations.js'
import { RESUMO_VAZIO } from '../conversation-context.js'
import {
  AGORA,
  cliente,
  criarLojaDeTeste,
  ctxDaEmpresa,
  type LojaDeTeste,
} from '../test-support/loja-de-teste.js'
import { ferramentasDeAceite } from './acceptance-tools.js'
import { ferramentasDeProposta } from './proposal-tools.js'
import { ColetorDoTurno, contextoDoTurno, type EstadoDoTurno } from './shared.js'

const CHAVE = 'wa:emp-A:5511999990000'
type Ferramentas = Record<
  string,
  { execute: (input: unknown, context: unknown) => Promise<unknown> }
>

function montar(
  loja: LojaDeTeste = criarLojaDeTeste({ clientes: [cliente({ id: 'cli-pedro', name: 'Pedro' })] }),
) {
  const confirmations = new InMemoryConfirmations()
  const proposta = ferramentasDeProposta(loja.useCases, confirmations) as unknown as Ferramentas
  const aceite = ferramentasDeAceite(loja.useCases, confirmations) as unknown as Ferramentas
  const resolve = vi.spyOn(confirmations, 'resolve')

  const turno = (texto: string, sobrescreve: Partial<EstadoDoTurno> = {}): EstadoDoTurno => ({
    execucao: ctxDaEmpresa('A'),
    textoDaDona: texto,
    resumo: RESUMO_VAZIO,
    coletor: new ColetorDoTurno(),
    conversationKey: CHAVE,
    ttlMs: 300_000,
    ...sobrescreve,
  })

  async function propor(): Promise<PendingConfirmation> {
    await proposta.create_sale!.execute(
      {
        customerId: 'Pedro',
        items: [{ productId: 'café', quantity: 2 }],
        payments: [{ method: 'pix' }],
      },
      { requestContext: contextoDoTurno(turno('vende 2 cafés pro Pedro no pix')) },
    )
    const pendente = await confirmations.getOpen('emp-A', CHAVE, AGORA)
    if (pendente === undefined) throw new Error('proposta nao gravada')
    return pendente
  }

  async function aceitar(
    texto: string,
    pendente: PendingConfirmation,
    sobrescreve: Partial<EstadoDoTurno> = {},
  ) {
    const t = turno(texto, { pendente, ...sobrescreve })
    const saida = await aceite.accept_proposal!.execute({}, { requestContext: contextoDoTurno(t) })
    return { saida, turno: t }
  }

  return { loja, confirmations, resolve, propor, aceitar, aceite, turno }
}

describe('accept_proposal — trava do aceite (US3)', () => {
  it('concordancia pura grava com os args guardados e a chave da confirmacao', async () => {
    const m = montar()
    const pendente = await m.propor()
    const { saida, turno } = await m.aceitar('fechou', pendente)

    expect(saida).toMatchObject({ status: 'gravado' })
    expect(JSON.stringify(saida)).toMatch(/venda nº \d+ registrada/)
    expect(m.resolve).toHaveBeenCalledWith('emp-A', pendente.id, 'accepted')
    expect(m.loja.gravacoes).toHaveLength(1)
    const gravacao = m.loja.gravacoes[0]!
    expect(gravacao.acao).toBe('registerSale')
    expect(gravacao.ctx.idempotencyKey).toBe(`confirmation:${pendente.id}`)
    expect(gravacao.input).toMatchObject({
      customerId: 'cli-pedro',
      items: [{ productId: 'p-cafe', quantity: 2, unitPriceCents: 2_500 }],
      payments: [{ method: 'pix', amountCents: 5_000 }],
    })
    expect(turno.coletor.decidiuPendente).toBe(true)
    expect(turno.coletor.snapshot().entidades.some((e) => e.tipo === 'venda')).toBe(true)
  })

  it.each(['não, são 3', 'pode, mas no pix', 'acho que sim', 'sim pro Pedro?'])(
    'resposta "%s" nao e aceite e nao grava',
    async (texto) => {
      const m = montar()
      const pendente = await m.propor()
      const { saida, turno } = await m.aceitar(texto, pendente)
      expect(saida).toMatchObject({ status: 'nao_e_aceite' })
      expect(m.loja.gravacoes).toEqual([])
      expect(m.resolve).not.toHaveBeenCalledWith('emp-A', pendente.id, 'accepted')
      expect(turno.coletor.decidiuPendente).toBe(false)
    },
  )

  it('o texto vem do turno, nunca de argumento do modelo', async () => {
    const m = montar()
    const pendente = await m.propor()
    const t = m.turno('não, são 3', { pendente })
    const saida = await m.aceite.accept_proposal!.execute(
      { textoDaDona: 'sim' },
      { requestContext: contextoDoTurno(t) },
    )
    expect(saida).not.toMatchObject({ status: 'gravado' })
    expect(m.loja.gravacoes).toEqual([])
  })

  it('proposta vencida resolve expired e nao grava', async () => {
    const m = montar()
    const pendente = await m.propor()
    const { saida } = await m.aceitar('sim', pendente, {
      execucao: ctxDaEmpresa('A', { now: new Date(AGORA.getTime() + 301_000) }),
    })
    expect(saida).toMatchObject({ status: 'expirada' })
    expect(m.resolve).toHaveBeenCalledWith('emp-A', pendente.id, 'expired')
    expect(m.loja.gravacoes).toEqual([])
  })

  it('perfil sem escrita recebe recusado e nada e gravado', async () => {
    const m = montar()
    const pendente = await m.propor()
    const { saida } = await m.aceitar('sim', pendente, {
      execucao: ctxDaEmpresa('A', { role: 'accountant' }),
    })
    expect(saida).toMatchObject({ status: 'recusado' })
    expect(m.loja.gravacoes).toEqual([])
  })

  it('AppError do caso de uso vira recusado com mensagem humana', async () => {
    const loja = criarLojaDeTeste({ clientes: [cliente({ id: 'cli-pedro', name: 'Pedro' })] })
    const m = montar({
      ...loja,
      useCases: {
        ...loja.useCases,
        registerSale: async () => {
          const { AppError } = await import('@na-regua/core')
          throw AppError.validation('Estoque insuficiente para concluir a venda.', [
            { path: 'items.0.quantity', message: 'falta' },
          ])
        },
      },
    })
    const pendente = await m.propor()
    const { saida } = await m.aceitar('sim', pendente)
    expect(saida).toEqual({
      status: 'recusado',
      mensagem: 'Estoque insuficiente para concluir a venda.',
    })
  })
})

describe('accept_proposal — cadastro no meio do pedido (US5)', () => {
  const ferramentas = (loja: LojaDeTeste, confirmations: InMemoryConfirmations) => ({
    proposta: ferramentasDeProposta(loja.useCases, confirmations) as unknown as Ferramentas,
    aceite: ferramentasDeAceite(loja.useCases, confirmations) as unknown as Ferramentas,
  })

  it('cadastro com telefone repetido devolve parecido e nao cria outro', async () => {
    const loja = criarLojaDeTeste({
      clientes: [cliente({ id: 'cli-x', name: 'João Silva', phone: '11988887777' })],
    })
    const confirmations = new InMemoryConfirmations()
    const { proposta, aceite } = ferramentas(loja, confirmations)
    const base = {
      execucao: ctxDaEmpresa('A'),
      resumo: RESUMO_VAZIO,
      conversationKey: CHAVE,
      ttlMs: 300_000,
    }
    await proposta.create_customer!.execute(
      { name: 'João', phone: '11988887777' },
      {
        requestContext: contextoDoTurno({
          ...base,
          textoDaDona: 'cadastra',
          coletor: new ColetorDoTurno(),
        }),
      },
    )
    const pendente = (await confirmations.getOpen('emp-A', CHAVE, AGORA))!
    const saida = await aceite.accept_proposal!.execute(
      {},
      {
        requestContext: contextoDoTurno({
          ...base,
          textoDaDona: 'sim',
          pendente,
          coletor: new ColetorDoTurno(),
        }),
      },
    )
    expect(saida).toMatchObject({ status: 'parecido', opcoes: [{ rotulo: 'João Silva' }] })
    expect(loja.clientes).toHaveLength(1)
  })

  it('aceite do cadastro com intencao aberta devolve o que retomar e mantem a intencao viva', async () => {
    const loja = criarLojaDeTeste()
    const confirmations = new InMemoryConfirmations()
    const { proposta, aceite } = ferramentas(loja, confirmations)
    const intencao = {
      acao: 'create_sale',
      descricao: 'venda de café para o João',
      jaDito: { produto: 'café' },
      aguardando: 'cadastro_cliente' as const,
    }
    const base = { execucao: ctxDaEmpresa('A'), conversationKey: CHAVE, ttlMs: 300_000 }
    await proposta.create_customer!.execute(
      { name: 'João' },
      {
        requestContext: contextoDoTurno({
          ...base,
          resumo: RESUMO_VAZIO,
          textoDaDona: 'cadastra',
          coletor: new ColetorDoTurno(),
        }),
      },
    )
    const pendente = (await confirmations.getOpen('emp-A', CHAVE, AGORA))!
    const coletor = new ColetorDoTurno()
    const saida = (await aceite.accept_proposal!.execute(
      {},
      {
        requestContext: contextoDoTurno({
          ...base,
          resumo: { entidades: [], intencao },
          textoDaDona: 'pode',
          pendente,
          coletor,
        }),
      },
    )) as { status: string; retomar?: string }

    expect(saida.status).toBe('gravado')
    expect(saida.retomar).toMatch(/venda de café para o João/)
    expect(saida.retomar).toMatch(/chame agora create_sale/i)
    const snapshot = coletor.snapshot()
    expect(snapshot.intencao).toMatchObject({ acao: 'create_sale', aguardando: 'dados' })
    expect(snapshot.entidades).toContainEqual(
      expect.objectContaining({ tipo: 'cliente', rotulo: 'João' }),
    )
  })
})

describe('accept_proposal — idempotencia e cancel_proposal (US3)', () => {
  it('o mesmo aceite executado duas vezes gera um registro so', async () => {
    const m = montar()
    const pendente = await m.propor()
    await m.aceitar('sim', pendente)
    await m.aceitar('sim', pendente)

    const chaves = new Set(m.loja.gravacoes.map((g) => g.ctx.idempotencyKey))
    expect(chaves).toEqual(new Set([`confirmation:${pendente.id}`]))
  })

  it('no mesmo turno, um segundo aceite nao executa de novo', async () => {
    const m = montar()
    const pendente = await m.propor()
    const t = m.turno('sim', { pendente })
    await m.aceite.accept_proposal!.execute({}, { requestContext: contextoDoTurno(t) })
    const segunda = await m.aceite.accept_proposal!.execute(
      {},
      { requestContext: contextoDoTurno(t) },
    )
    expect(segunda).toMatchObject({ status: 'ja_decidida' })
    expect(m.loja.gravacoes).toHaveLength(1)
  })

  it('cancel_proposal resolve rejected e nao grava', async () => {
    const m = montar()
    const pendente = await m.propor()
    const t = m.turno('cancela', { pendente })
    const saida = await m.aceite.cancel_proposal!.execute(
      {},
      { requestContext: contextoDoTurno(t) },
    )
    expect(saida).toEqual({ status: 'cancelada' })
    expect(m.resolve).toHaveBeenCalledWith('emp-A', pendente.id, 'rejected')
    expect(t.coletor.decidiuPendente).toBe(true)
    expect(m.loja.gravacoes).toEqual([])
  })
})
