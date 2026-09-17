#!/usr/bin/env node
/**
 * Sobe a SPA do Mastra Studio apontando para a API Fastify (NR-121).
 *
 * Nao e `mastra dev`: o runtime continua em `apps/api`. Este processo so
 * serve o painel contra `API_URL` no prefixo `/api`.
 *
 *   pnpm studio
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadStudioPresets, mapaDeRequestContextPresets } from '@na-regua/agent'
import { DEFAULT_AGENT_STUDIO_PRESETS } from '@na-regua/env'

const DEFAULT_API_URL = 'http://localhost:3333'
const PREFIX = '/api'

function resolverAlvo(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    console.error(`API_URL invalida (${raw}). Use uma URL absoluta, ex.: ${DEFAULT_API_URL}`)
    process.exit(1)
  }
  const protocol = url.protocol.replace(/:$/, '') || 'http'
  const host = url.hostname || 'localhost'
  const port = url.port || (protocol === 'https' ? '443' : '3333')
  return { protocol, host, port }
}

function arquivoDoDropdown() {
  const caminho = process.env.AGENT_STUDIO_PRESETS?.trim() || DEFAULT_AGENT_STUDIO_PRESETS
  try {
    const arquivo = loadStudioPresets(caminho)
    const mapa = mapaDeRequestContextPresets(arquivo.presets)
    const dir = mkdtempSync(join(tmpdir(), 'studio-rcp-'))
    const saida = join(dir, 'request-context-presets.json')
    writeFileSync(saida, `${JSON.stringify(mapa, null, 2)}\n`)
    return { saida, dir }
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro)
    console.warn(`Studio dropdown: presets nao carregados (${motivo}). Editor JSON manual.`)
    return undefined
  }
}

const apiUrl = process.env.API_URL?.trim() || DEFAULT_API_URL
const { protocol, host, port } = resolverAlvo(apiUrl)
const dropdown = arquivoDoDropdown()

console.log(`Studio → ${protocol}://${host}:${port}${PREFIX}  (agent lista em /api/agents)`)
if (dropdown !== undefined) {
  console.log(`Request-context presets → ${dropdown.saida}`)
}

const args = [
  'studio',
  '--server-protocol',
  protocol,
  '--server-host',
  host,
  '--server-port',
  port,
  '--server-api-prefix',
  PREFIX,
]
if (dropdown !== undefined) {
  args.push('--request-context-presets', dropdown.saida)
}

const child = spawn('mastra', args, { stdio: 'inherit', shell: true, env: process.env })

function limpar() {
  if (dropdown !== undefined) {
    rmSync(dropdown.dir, { recursive: true, force: true })
  }
}

child.on('exit', (code, signal) => {
  limpar()
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
