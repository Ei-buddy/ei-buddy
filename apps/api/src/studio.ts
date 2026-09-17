import cors from '@fastify/cors'
import { MastraServer } from '@mastra/fastify'
import {
  createStudioMastra,
  mapaDeRequestContextPresets,
  type AgentRuntime,
  type FixturePeerDirectory,
} from '@na-regua/agent'
import type { FastifyInstance } from 'fastify'

/**
 * Origem do painel `pnpm studio` (SPA em outra porta). Adapter Fastify nao
 * herda o CORS do `mastra build` — a SPA em :3000 preflighta OPTIONS e, sem
 * isso, o browser relata Failed to fetch mesmo com GET /api/agents 200.
 *
 * So loopback: o adapter so monta em nao-producao. Sem `origin: '*'`.
 */
export function origemDoPainelStudio(origin: string | undefined): boolean {
  if (origin === undefined || origin === '') return false
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
}

export type StudioMountOptions = {
  readonly motivo: string | undefined
  readonly runtime: AgentRuntime | null
  readonly directory: FixturePeerDirectory | null
}

/**
 * Adapter Fastify do Mastra atras do porteiro da NR-060.
 *
 * So monta quando o harness pode servir E o arquivo de presets carregou.
 * Prefixo `/api`; unico agent `studio-harness`. Sem `mastra dev`.
 * O dropdown do Studio (`--request-context-presets`) usa o mapa gerado
 * pelo loader — so o slug, sem UUID.
 */
export async function montarStudio(
  app: FastifyInstance,
  opcoes: StudioMountOptions,
): Promise<boolean> {
  if (opcoes.motivo !== undefined) {
    app.log.warn({ motivo: opcoes.motivo }, 'studio mastra nao montado — porteiro')
    return false
  }

  if (opcoes.runtime === null || opcoes.directory === null) {
    app.log.warn('studio mastra nao montado — presets ausentes ou invalidos')
    return false
  }

  const mapa = mapaDeRequestContextPresets(opcoes.directory.peers())
  app.log.info({ presets: Object.keys(mapa) }, 'studio harness request-context presets')

  await app.register(cors, {
    origin: (origin, cb) => {
      cb(null, origemDoPainelStudio(origin))
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  const mastra = createStudioMastra({
    runtime: opcoes.runtime,
    directory: opcoes.directory,
    onTurn: (turno) => {
      // peer ja mascarado no rele; sem texto da mensagem (RNF-034)
      app.log.info(turno, 'agent.studio.turn')
    },
  })
  const server = new MastraServer({ app, mastra, prefix: '/api' })
  await server.init()
  return true
}
