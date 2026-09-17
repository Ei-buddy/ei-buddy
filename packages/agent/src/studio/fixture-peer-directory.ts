import type { LinkedPeer, PeerDirectory } from '../types.js'
import { normalizarPeer } from './normalize-peer.js'
import type { StudioPreset } from './presets.js'

export { normalizarPeer }

export type StudioPeerRef = {
  readonly id: string
  readonly peer: string
}

/**
 * Mapa estatico de fixture. Nao e o PeerDirectory de producao (NR-113).
 */
export class FixturePeerDirectory implements PeerDirectory {
  private readonly porPeer: ReadonlyMap<string, LinkedPeer>
  private readonly porId: ReadonlyMap<string, StudioPreset>
  private readonly lista: readonly StudioPeerRef[]

  constructor(presets: readonly StudioPreset[]) {
    const porPeer = new Map<string, LinkedPeer>()
    const porId = new Map<string, StudioPreset>()
    const lista: StudioPeerRef[] = []
    for (const preset of presets) {
      const peer = normalizarPeer(preset.peer)
      porPeer.set(peer, {
        companyId: preset.companyId,
        userId: preset.userId,
        role: preset.role,
      })
      porId.set(preset.id, { ...preset, peer })
      lista.push({ id: preset.id, peer })
    }
    this.porPeer = porPeer
    this.porId = porId
    this.lista = lista
  }

  async resolve(peer: string): Promise<LinkedPeer | null> {
    return this.porPeer.get(normalizarPeer(peer)) ?? null
  }

  byId(id: string): StudioPreset | null {
    return this.porId.get(id) ?? null
  }

  peers(): readonly StudioPeerRef[] {
    return this.lista
  }
}
