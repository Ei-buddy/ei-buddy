import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadStudioPresets, mapaDeRequestContextPresets, StudioPresetsError } from './presets.js'

const UUID_A = '00000000-0000-4000-8000-000000000001'
const UUID_B = '00000000-0000-4000-8000-000000000002'
const USER_A = '00000000-0000-4000-8000-000000000011'
const USER_B = '00000000-0000-4000-8000-000000000012'

const ok = {
  presets: [
    {
      id: 'claudia-loja-1',
      peer: '5511999000001',
      companyId: UUID_A,
      userId: USER_A,
      role: 'owner' as const,
    },
    {
      id: 'claudia-loja-2',
      peer: '5511999000002',
      companyId: UUID_B,
      userId: USER_B,
      role: 'owner' as const,
    },
  ],
}

const dirs: string[] = []

function gravar(json: unknown, nome = 'presets.json'): string {
  const dir = mkdtempSync(join(tmpdir(), 'studio-presets-'))
  dirs.push(dir)
  const caminho = join(dir, nome)
  writeFileSync(caminho, typeof json === 'string' ? json : JSON.stringify(json))
  return caminho
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe('loadStudioPresets', () => {
  it('carrega dois presets validos e normaliza o peer', () => {
    const caminho = gravar({
      presets: [{ ...ok.presets[0], peer: '+55 11 99900-0001' }, ok.presets[1]],
    })
    const arquivo = loadStudioPresets(caminho)
    expect(arquivo.presets).toHaveLength(2)
    expect(arquivo.presets[0]?.id).toBe('claudia-loja-1')
    expect(arquivo.presets[0]?.peer).toBe('5511999000001')
    expect(arquivo.presets[0]?.role).toBe('owner')
  })

  it('recusa chave extra — schema .strict()', () => {
    const caminho = gravar({
      presets: [{ ...ok.presets[0], extra: true }],
    })
    expect(() => loadStudioPresets(caminho)).toThrow(StudioPresetsError)
    expect(() => loadStudioPresets(caminho)).toThrow(/recusados|unrecognized|extra/i)
  })

  it('recusa peer duplicado apos normalizar', () => {
    const caminho = gravar({
      presets: [ok.presets[0], { ...ok.presets[1], peer: '+55 11 99900-0001' }],
    })
    expect(() => loadStudioPresets(caminho)).toThrow(StudioPresetsError)
    expect(() => loadStudioPresets(caminho)).toThrow(/peer duplicado/)
  })

  it('recusa role diferente de owner', () => {
    const caminho = gravar({
      presets: [{ ...ok.presets[0], role: 'staff' }],
    })
    expect(() => loadStudioPresets(caminho)).toThrow(StudioPresetsError)
  })

  it('recusa arquivo ausente', () => {
    expect(() => loadStudioPresets(join(tmpdir(), 'nao-existe-studio-presets.json'))).toThrow(
      StudioPresetsError,
    )
    expect(() => loadStudioPresets(join(tmpdir(), 'nao-existe-studio-presets.json'))).toThrow(
      /ausente/,
    )
  })

  it('recusa id fora do slug [a-z0-9-]+', () => {
    const caminho = gravar({
      presets: [{ ...ok.presets[0], id: 'Claudia_Loja' }],
    })
    expect(() => loadStudioPresets(caminho)).toThrow(StudioPresetsError)
  })
})

describe('mapaDeRequestContextPresets', () => {
  it('gera o dropdown do Studio so com o slug, sem UUID', () => {
    const arquivo = loadStudioPresets(gravar(ok))
    expect(mapaDeRequestContextPresets(arquivo.presets)).toEqual({
      'claudia-loja-1': { preset: 'claudia-loja-1' },
      'claudia-loja-2': { preset: 'claudia-loja-2' },
    })
    const serializado = JSON.stringify(mapaDeRequestContextPresets(arquivo.presets))
    expect(serializado).not.toContain(UUID_A)
    expect(serializado).not.toContain(USER_A)
    expect(serializado).not.toContain('5511999000001')
  })
})
