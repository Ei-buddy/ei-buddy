import { describe, expect, it } from 'vitest'
import { FixturePeerDirectory, normalizarPeer } from './fixture-peer-directory.js'
import type { StudioPreset } from './presets.js'

const UUID_A = '00000000-0000-4000-8000-000000000001'
const USER_A = '00000000-0000-4000-8000-000000000011'
const UUID_B = '00000000-0000-4000-8000-000000000002'
const USER_B = '00000000-0000-4000-8000-000000000012'

const presets: readonly StudioPreset[] = [
  {
    id: 'claudia-loja-1',
    peer: '5511999000001',
    companyId: UUID_A,
    userId: USER_A,
    role: 'owner',
  },
  {
    id: 'claudia-loja-2',
    peer: '5511999000002',
    companyId: UUID_B,
    userId: USER_B,
    role: 'owner',
  },
]

describe('normalizarPeer', () => {
  it('trata +55 11 99900-0001 como 5511999000001', () => {
    expect(normalizarPeer('+55 11 99900-0001')).toBe('5511999000001')
  })
})

describe('FixturePeerDirectory', () => {
  it('resolve hit pelo numero normalizado', async () => {
    const dir = new FixturePeerDirectory(presets)
    const ligado = await dir.resolve('+55 11 99900-0001')
    expect(ligado).toEqual({ companyId: UUID_A, userId: USER_A, role: 'owner' })
  })

  it('resolve miss devolve null', async () => {
    const dir = new FixturePeerDirectory(presets)
    expect(await dir.resolve('5511999000999')).toBeNull()
  })

  it('byId encontra o slug e miss devolve null', () => {
    const dir = new FixturePeerDirectory(presets)
    expect(dir.byId('claudia-loja-2')?.peer).toBe('5511999000002')
    expect(dir.byId('nao-existe')).toBeNull()
  })

  it('peers lista id e peer sem vazar userId', () => {
    const dir = new FixturePeerDirectory(presets)
    expect(dir.peers()).toEqual([
      { id: 'claudia-loja-1', peer: '5511999000001' },
      { id: 'claudia-loja-2', peer: '5511999000002' },
    ])
  })
})
