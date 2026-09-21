import { describe, expect, it } from 'vitest'
import type { PeerDirectory, VinculoDoCanal } from '../ports/peer-directory.js'
import { abrirCanal, normalizarTelefoneDoCanal } from './abrir-canal.js'

const EMPRESA = '11111111-1111-4111-8111-111111111111'
const DONA = '22222222-2222-4222-8222-222222222222'
const AGORA = new Date('2026-09-21T10:00:00.000Z')

function diretorio(por: Record<string, VinculoDoCanal>) {
  const consultados: string[] = []
  const peers: PeerDirectory = {
    porTelefone: async (phone) => {
      consultados.push(phone)
      return por[phone]
    },
  }
  return { peers, consultados }
}

const abrir = (peers: PeerDirectory, telefone: string) =>
  abrirCanal({ peers }, { telefone, requestId: 'req-1', agora: AGORA })

describe('o telefone do provedor vira o do cadastro', () => {
  it('tira o DDI do Brasil', () => {
    /* A Meta entrega `5541999998888`; `users.phone` guarda sem o 55. */
    expect(normalizarTelefoneDoCanal('5541999998888')).toBe('41999998888')
  })

  it('tira mascara', () => {
    expect(normalizarTelefoneDoCanal('+55 (41) 99999-8888')).toBe('41999998888')
  })

  it('nao tira o 55 de um numero que nao tem DDI', () => {
    /* `5599998888` e DDD 55 (MS) com oito digitos. Cortar dois na frente
       transformaria o numero de um lojista no de outro. */
    expect(normalizarTelefoneDoCanal('5599998888')).toBe('5599998888')
  })

  it('texto sem digito vira vazio', () => {
    expect(normalizarTelefoneDoCanal('sem numero')).toBe('')
  })
})

describe('a barragem — RF-094, RF-095', () => {
  it('numero vinculado abre o canal na empresa dele', async () => {
    const d = diretorio({ '41999998888': { companyId: EMPRESA, userId: DONA } })

    const r = await abrir(d.peers, '5541999998888')

    if (r.status !== 'autorizado') throw new Error('esperava autorizado')
    expect([r.ctx.companyId, r.ctx.userId]).toEqual([EMPRESA, DONA])
  })

  it('o contexto sai com papel de owner e canal whatsapp', async () => {
    const d = diretorio({ '41999998888': { companyId: EMPRESA, userId: DONA } })

    const r = await abrir(d.peers, '41999998888')

    if (r.status !== 'autorizado') throw new Error('esperava autorizado')
    /* O papel decide o que as tools deixam fazer; o canal e o que a auditoria
       registra. Dizer `app` aqui faria a trilha mentir sobre a origem. */
    expect([r.ctx.role, r.ctx.channel]).toEqual(['owner', 'whatsapp'])
  })

  it('numero sem vinculo responde SILENCIO', async () => {
    const d = diretorio({})

    const r = await abrir(d.peers, '5541988887777')

    expect(r.status).toBe('silencio')
  })

  it('mensagem sem telefone nem chega a consultar', async () => {
    const d = diretorio({})

    const r = await abrir(d.peers, '')

    expect(r.status).toBe('silencio')
    expect(d.consultados).toEqual([])
  })

  it('a consulta usa o numero JA normalizado', async () => {
    const d = diretorio({})

    await abrir(d.peers, '+55 (41) 99999-8888')

    /* Se o diretorio recebesse o formato do provedor, o cadastro nunca
       casaria — e todo lojista cairia no silencio. */
    expect(d.consultados).toEqual(['41999998888'])
  })
})
