# Implementation Plan: Harness Studio de engenharia (NR-121)

**Branch**: `feat/NR-121-harness-studio` | **Date**: 2026-09-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-studio-harness/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Fechar a NR-121: Mastra Studio como harness de engenharia no Fastify da API, com um agent-relé (`studio-harness` / tool `process_message`) que chama o **mesmo** `processMessage` da NR-060. Identidade = preset + número forjado (`FixturePeerDirectory`, `channel: 'whatsapp'`). Observabilidade = `durationMs` no output da tool (RNF-006). `POST /agent/messages` permanece. Produção e lojista não montam o adapter. Sem Memory/RAG/Cloud; sem segundo LLM no painel.

## Technical Context

**Language/Version**: TypeScript 5.x / Node (ESM), monorepo pnpm + Turborepo

**Primary Dependencies**: `@mastra/core` ^1.66 (já no `agent`); `@mastra/fastify` em `apps/api`; CLI `mastra` (dev) para a SPA do Studio; Zod / `@na-regua/contracts`

**Storage**: Postgres + RLS existente (dados da fixture). Presets em arquivo JSON. Sem tabela nova; sem Memory/Storage Mastra em `public`

**Testing**: Vitest — unit em `packages/agent` (diretório, load de preset, relé, `durationMs`, ignore de `companyId` no context); integração em `apps/api` (adapter monta/não monta; generate → laço; `/agent/messages` intacto). Sem OpenAI na CI

**Target Platform**: API Node local/staging harness; Studio SPA contra `API_URL`. Produção: adapter ausente

**Project Type**: library (`packages/agent`) + composition HTTP (`apps/api`) + UI de engenharia (Studio)

**Performance Goals**: consulta ≤ 5 s, ação com confirmação ≤ 8 s após o “sim” (RNF-006), medido como `durationMs` do relé — smoke manual com provedor real; CI só prova que a métrica existe

**Constraints**: relé NÃO interpreta (zero hop extra de LLM); tools de negócio NÃO no `/api/agents`; `companyId` nunca do JSON do Studio; agente NÃO calcula; sem WhatsApp Meta (NR-046); sem persistência de confirmação (NR-061); sem memória multi-turno (NR-062)

**Scale/Scope**: 1 agent Mastra (`studio-harness`), 1 tool (`process_message`), arquivo de N presets (DoD com 2), 1 SPA Studio, porteiro já existente

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Princípio                   | Status | Como esta fatia cumpre                                                                                          |
| --------------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| I. Um núcleo, dois canais   | PASS   | Studio só relé → `processMessage` → `core`; HTTP de teste intacto; futuro webhook na mesma função               |
| II. Hexágono                | PASS   | Relé/diretório em `agent` (sem `db`/`domain`); `@mastra/fastify` só em `apps/api`; schemas de mensagem reusados |
| III. Integridade financeira | PASS   | Nenhuma tool de negócio no servidor Mastra; mutação ainda passa pela confirmação do laço                        |
| IV. RLS / tenant            | PASS   | `ExecutionContext` do `FixturePeerDirectory`; `companyId` no request context ignorado; teste de dois presets    |
| V. Teste que prova          | PASS   | FakeLlm no laço; CI sem OpenAI; recusa de peer/prod prova zero efeito; centavos = HTTP                          |
| Produto — confirmação       | PASS   | Inalterada (`InMemoryConfirmations`, chave `wa:…`)                                                              |
| Segurança — harness         | PASS   | Mesmo porteiro NR-060; adapter nem monta em prod; Studio não é URL de produto                                   |
| IA — teto                   | PASS   | Relé não cria contador paralelo; `processMessage` já registra                                                   |

**Pós Phase 1:** sem violações. O adapter Fastify **não** reabre a ADR-0010: é servidor de desenvolvimento atrás do porteiro, não canal do lojista. Complexidade Tracking vazio.

## Project Structure

### Documentation (this feature)

```text
specs/003-studio-harness/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── studio-harness.md
│   └── presets.md
└── tasks.md                 # /speckit-tasks (ainda não)
```

### Source Code (repository root)

```text
packages/agent/
├── src/
│   ├── process-message.ts          # existente; WhatsApp + PeerDirectory
│   ├── create-runtime.ts           # passar peers do diretório de fixture
│   ├── studio/
│   │   ├── presets.ts              # load + validação + peer único
│   │   ├── fixture-peer-directory.ts
│   │   ├── relay-agent.ts          # agent studio-harness + tool process_message
│   │   └── relay-model.ts          # model determinístico (sem OpenAI)
│   └── …
├── studio/
│   ├── presets.example.json
│   └── presets.json                # local; não versionar IDs reais
└── README.md

apps/api/src/
├── composition.ts                  # buildAgentDeps + peers; createStudioMastra
├── studio.ts                       # MastraServer.init() se harness ligado
├── index.ts                        # monta adapter
└── routes/agent.ts                 # POST /agent/messages inalterado

packages/env/src/api.ts             # AGENT_STUDIO_PRESETS (opcional)

docs/arquitetura/integracoes/mastra.md
docs/engenharia/ambientes.md
.env.example
```

**Structure Decision**: manter o monorepo. NR-121 acrescenta o **relé** em `packages/agent` e o **adapter Fastify** em `apps/api` (mesmo processo, mesma composição). Não cria `apps/studio`, não cria `src/mastra` greenfield, não sobe `mastra dev` como segundo runtime. A SPA do Studio é a CLI oficial apontada para a API.

## Complexity Tracking

> Sem violações a justificar.
