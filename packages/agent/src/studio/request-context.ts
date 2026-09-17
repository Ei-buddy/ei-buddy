import { z } from 'zod'
import type { FixturePeerDirectory } from './fixture-peer-directory.js'
import { normalizarPeer } from './fixture-peer-directory.js'

/** Campos do JSON do Studio que NUNCA viram ExecutionContext. */
const IGNORADOS = ['companyId', 'userId', 'role'] as const

/**
 * Schema que o Studio 1.30 usa para mostrar o editor de Request Context no
 * chat do agent. Sem isso o botao some (`s?.requestContextSchema && …`).
 * O item de sidebar `/request-context` e so Mastra Platform, nao o Fastify local.
 *
 * `companyId` / `userId` / `role` ficam de fora de proposito — o form nao
 * convite a forjar tenant. Resolve no servidor via preset ou peer.
 */
export const studioRequestContextSchema = z.object({
  preset: z.string().min(1).optional(),
  peer: z.string().min(1).optional(),
})

export type StudioContextReader = {
  get(key: string): unknown
}

/**
 * Resolve o peer forjado a partir do request context do painel.
 *
 * Ordem (data-model): preset conhecido → peer do arquivo; senao peer do
 * diretorio; senao recusa. `companyId` / `userId` / `role` sao lidos e
 * descartados — o cliente nao escolhe a empresa. Preset+peer contraditorios
 * recusam (FR-005).
 */
export async function resolverPeerDoStudio(
  directory: FixturePeerDirectory,
  requestContext: StudioContextReader | undefined,
): Promise<string | undefined> {
  if (requestContext === undefined) return undefined

  for (const chave of IGNORADOS) {
    requestContext.get(chave)
  }

  const preset = requestContext.get('preset')
  const peerBruto = requestContext.get('peer')
  const peerInformado = typeof peerBruto === 'string' && peerBruto !== '' ? peerBruto : undefined

  if (typeof preset === 'string' && preset !== '') {
    const conhecido = directory.byId(preset)
    if (conhecido !== null) {
      if (peerInformado !== undefined && normalizarPeer(peerInformado) !== conhecido.peer) {
        return undefined
      }
      return conhecido.peer
    }
  }

  if (peerInformado === undefined) return undefined

  const ligado = await directory.resolve(peerInformado)
  if (ligado === null) return undefined
  return normalizarPeer(peerInformado)
}
