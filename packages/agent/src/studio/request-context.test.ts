import { describe, expect, it } from 'vitest'
import { FixturePeerDirectory } from './fixture-peer-directory.js'
import type { StudioPreset } from './presets.js'
import {
  resolverPeerDoStudio,
  studioRequestContextSchema,
  type StudioContextReader,
} from './request-context.js'

const UUID_A = '00000000-0000-4000-8000-000000000001'
const USER_A = '00000000-0000-4000-8000-000000000011'
const UUID_B = '00000000-0000-4000-8000-000000000002'
const USER_B = '00000000-0000-4000-8000-000000000012'

const PRESETS: readonly StudioPreset[] = [
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

const directory = new FixturePeerDirectory(PRESETS)

function ctx(values: Record<string, unknown>): StudioContextReader {
  return {
    get(key: string) {
      return values[key]
    },
  }
}

describe('resolverPeerDoStudio — US2 allowlist', () => {
  it('honra preset conhecido e devolve o peer do arquivo', async () => {
    expect(await resolverPeerDoStudio(directory, ctx({ preset: 'claudia-loja-1' }))).toBe(
      '5511999000001',
    )
  })

  it('honra peer sozinho (normalizado) quando o preset nao veio', async () => {
    expect(await resolverPeerDoStudio(directory, ctx({ peer: '+55 11 99900-0002' }))).toBe(
      '5511999000002',
    )
  })

  it('preset desconhecido cai no peer quando o peer e conhecido', async () => {
    expect(
      await resolverPeerDoStudio(directory, ctx({ preset: 'nao-existe', peer: '5511999000001' })),
    ).toBe('5511999000001')
  })

  it('ignora companyId, userId e role do cliente', async () => {
    expect(
      await resolverPeerDoStudio(
        directory,
        ctx({
          preset: 'claudia-loja-1',
          companyId: UUID_B,
          userId: USER_B,
          role: 'staff',
        }),
      ),
    ).toBe('5511999000001')
  })

  it('preset e peer contraditorios recusam', async () => {
    expect(
      await resolverPeerDoStudio(
        directory,
        ctx({ preset: 'claudia-loja-1', peer: '5511999000002' }),
      ),
    ).toBeUndefined()
  })

  it('preset desconhecido sem peer recusa', async () => {
    expect(
      await resolverPeerDoStudio(directory, ctx({ preset: 'nao-existe', companyId: UUID_A })),
    ).toBeUndefined()
  })

  it('peer desconhecido recusa', async () => {
    expect(await resolverPeerDoStudio(directory, ctx({ peer: '0000000000000' }))).toBeUndefined()
  })

  it('contexto ausente ou vazio recusa', async () => {
    expect(await resolverPeerDoStudio(directory, undefined)).toBeUndefined()
    expect(await resolverPeerDoStudio(directory, ctx({}))).toBeUndefined()
  })
})

describe('studioRequestContextSchema', () => {
  it('aceita preset ou peer e nao declara companyId', () => {
    expect(studioRequestContextSchema.parse({ preset: 'claudia-loja-1' })).toEqual({
      preset: 'claudia-loja-1',
    })
    expect(studioRequestContextSchema.parse({ peer: '5511999000001' }).peer).toBe('5511999000001')
    expect(studioRequestContextSchema.shape).not.toHaveProperty('companyId')
    expect(studioRequestContextSchema.shape).toHaveProperty('preset')
    expect(studioRequestContextSchema.shape).toHaveProperty('peer')
  })
})
