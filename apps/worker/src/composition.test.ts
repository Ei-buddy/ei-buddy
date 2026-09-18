import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Wiring do expurgo — T056.
 *
 * O consumidor injeta `listTenantIds` e por isso nao pega o SELECT cru que
 * lancava sob RLS. Aqui a composicao e quem precisa provar que nao usa mais
 * `SELECT id FROM companies` em `withPlatformScope`.
 */

const listCompanyIds = vi.hoisted(() => vi.fn(async () => ['empresa-a', 'empresa-b']))
const getClient = vi.hoisted(() => vi.fn(() => ({ mockSql: true })))
const createConversationPurgeRepository = vi.hoisted(() =>
  vi.fn(() => ({
    deleteMessagesOlderThan: async () => 0,
    closeConversationsWithoutMessages: async () => 0,
  })),
)

vi.mock('@na-regua/db', () => ({
  listCompanyIds,
  getClient,
  createConversationPurgeRepository,
  createFiscalCredentials: vi.fn(),
  createInvoiceStore: vi.fn(),
  lerChaveDeSegredo: vi.fn(),
  withPlatformScope: vi.fn(async () => {
    throw new Error('composition nao deve usar withPlatformScope para listar empresas')
  }),
}))

vi.mock('@na-regua/fiscal', () => ({
  createFakeInvoiceIssuer: () => ({ emit: async () => ({}) }),
  criarEmissorFocusNfe: vi.fn(),
}))

vi.mock('@na-regua/whatsapp', () => ({
  createFakeMessageSender: () => ({ send: async () => ({}) }),
}))

const AMBIENTE = {
  NODE_ENV: 'test',
  REDIS_URL: 'redis://localhost:6379',
  DATABASE_URL: 'postgresql://app:app@localhost:5432/naregua',
  FISCAL_PROVIDER: 'fake',
}

async function carregar(over: Record<string, string> = {}) {
  vi.resetModules()
  vi.unstubAllEnvs()
  for (const [chave, valor] of Object.entries({ ...AMBIENTE, ...over })) {
    vi.stubEnv(chave, valor)
  }
  return import('./composition.js')
}

describe('composicao do expurgo — T056', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('listTenantIds chama listCompanyIds, nao SELECT cru em companies', async () => {
    const { montarDeps } = await carregar()
    const deps = montarDeps(new Map())

    const ids = await deps.listTenantIds()

    expect(listCompanyIds).toHaveBeenCalledTimes(1)
    expect(listCompanyIds).toHaveBeenCalledWith({ mockSql: true })
    expect(ids).toEqual(['empresa-a', 'empresa-b'])
  })
})
