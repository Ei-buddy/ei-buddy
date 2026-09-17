import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { normalizarPeer } from './normalize-peer.js'

const SLUG = /^[a-z0-9-]+$/

const studioPresetSchema = z
  .object({
    id: z.string().regex(SLUG, 'id do preset precisa ser slug [a-z0-9-]+.'),
    peer: z.string().min(1, 'peer do preset e obrigatorio.'),
    companyId: z.uuid('companyId do preset precisa ser UUID.'),
    userId: z.uuid('userId do preset precisa ser UUID.'),
    role: z.literal('owner'),
  })
  .strict()

const studioPresetsFileSchema = z
  .object({
    presets: z.array(studioPresetSchema),
  })
  .strict()

export type StudioPreset = {
  readonly id: string
  readonly peer: string
  readonly companyId: string
  readonly userId: string
  readonly role: 'owner'
}

export type StudioPresetsFile = {
  readonly presets: readonly StudioPreset[]
}

export class StudioPresetsError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StudioPresetsError'
  }
}

/**
 * Raiz do repo: `packages/agent/src/studio/presets.ts` sobe quatro niveis.
 * Caminhos relativos do env sao relativos a essa raiz, nao a `apps/api`.
 */
function raizDoRepo(): string {
  return fileURLToPath(new URL('../../../../', import.meta.url))
}

export function resolverCaminhoDosPresets(caminho: string): string {
  if (isAbsolute(caminho)) return caminho
  const noCwd = resolve(process.cwd(), caminho)
  if (existsSync(noCwd)) return noCwd
  return resolve(raizDoRepo(), caminho)
}

/**
 * Le e valida o arquivo de presets do harness. Recusa o load inteiro se o
 * JSON for invalido, se faltar o arquivo, se houver chave extra, role
 * diferente de `owner`, id/peer duplicado ou peer vazio apos normalizar.
 */
export function loadStudioPresets(caminho: string): StudioPresetsFile {
  const absoluto = resolverCaminhoDosPresets(caminho)
  if (!existsSync(absoluto)) {
    throw new StudioPresetsError(`arquivo de presets ausente: ${absoluto}`)
  }

  let bruto: unknown
  try {
    bruto = JSON.parse(readFileSync(absoluto, 'utf8')) as unknown
  } catch (erro) {
    throw new StudioPresetsError(`JSON de presets invalido: ${absoluto}`, { cause: erro })
  }

  const parsed = studioPresetsFileSchema.safeParse(bruto)
  if (!parsed.success) {
    const detalhe = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('; ')
    throw new StudioPresetsError(`presets recusados: ${detalhe}`)
  }

  const ids = new Set<string>()
  const peers = new Set<string>()
  const presets: StudioPreset[] = []

  for (const brutoPreset of parsed.data.presets) {
    if (ids.has(brutoPreset.id)) {
      throw new StudioPresetsError(`id de preset duplicado: ${brutoPreset.id}`)
    }
    const peer = normalizarPeer(brutoPreset.peer)
    if (peer === '') {
      throw new StudioPresetsError(`peer do preset ${brutoPreset.id} nao tem digitos`)
    }
    if (peers.has(peer)) {
      throw new StudioPresetsError(`peer duplicado apos normalizar: ${peer}`)
    }
    ids.add(brutoPreset.id)
    peers.add(peer)
    presets.push({
      id: brutoPreset.id,
      peer,
      companyId: brutoPreset.companyId,
      userId: brutoPreset.userId,
      role: 'owner',
    })
  }

  return { presets }
}

/**
 * Mapa no formato `--request-context-presets` do Mastra Studio:
 * `id` → `{ "preset": "<id>" }`. Sem UUID — o dropdown so escolhe o slug.
 */
export type StudioRequestContextPresetMap = {
  readonly [id: string]: { readonly preset: string }
}

export function mapaDeRequestContextPresets(
  presets: readonly { readonly id: string }[],
): StudioRequestContextPresetMap {
  const mapa: Record<string, { readonly preset: string }> = {}
  for (const preset of presets) {
    mapa[preset.id] = { preset: preset.id }
  }
  return mapa
}
