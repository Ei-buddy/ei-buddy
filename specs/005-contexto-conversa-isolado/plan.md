# Implementation Plan: Contexto de conversa isolado por empresa (NR-062)

**Branch**: `feat/NR-062-contexto-conversa-isolado` | **Date**: 2026-09-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-contexto-conversa-isolado/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Fechar a NR-062: `processMessage` passa a gravar turnos em `messages` na **mesma** row de `conversations` que a NR-061 já usa como identidade, carregar no máximo **12** mensagens do fio ativo para o `LlmPort.decide`, cortar anáfora após **2 h** sem mensagem, e expurgar corpos com mais de **30 dias** por caso de uso + fila. Isolamento = RLS + `companyId` na porta. Memory/Storage Mastra continuam desligados. HTTP `app` e Studio `wa` **não** viram o mesmo fio.

## Technical Context

**Language/Version**: TypeScript 5.x / Node (ESM), monorepo pnpm + Turborepo

**Primary Dependencies**: `@na-regua/core` (porta + caso de uso de expurgo), `@na-regua/db` (Postgres + `withTenant`), `@na-regua/agent` (`processMessage`, `LlmPort`), BullMQ em `apps/worker`, Fastify composition em `apps/api`

**Storage**: PostgreSQL existente — `conversations` + `messages` (baseline 0007, RLS; identidade UNIQUE na 0018). Sem Redis como memória de conversa; sem Memory/Storage Mastra em `public`

**Testing**: Vitest — unit em `packages/agent` (janela, idle, append, `LlmPort` com histórico) e `packages/core` (expurgo com relógio injetado); Postgres em `packages/db` (round-trip, RLS, reinício, expurgo); composição em `apps/api` / consumidor em `apps/worker`. Sem OpenAI na CI

**Target Platform**: API Node (harness HTTP NR-060 + Studio NR-121) + worker. Produção: mesmo store quando o canal existir; Meta fora (NR-046)

**Project Type**: library (`core` porta + `db` impl + `agent` laço) + composition HTTP (`apps/api`) + job (`apps/worker`)

**Performance Goals**: consulta ≤ 5 s / “sim” ≤ 8 s (RNF-006) inalterados; load da janela no mesmo request (12 linhas), sem hop extra de LLM só para “lembrar”

**Constraints**: `agent` não importa `db`; agente não calcula; teto 12 / idle 2 h / retenção 30 dias (ADR-0016); HTTP `app` ≠ Studio `wa`; confirmação TTL 5 min independente; sem Memory Mastra; sem RAG (NR-120)

**Scale/Scope**: 1 porta de histórico, 1 repositório, 1 caso de uso de expurgo, 1 fila, wiring em `buildAgentDeps` + worker; catálogo de tools inalterado

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Princípio                   | Status | Como esta fatia cumpre                                                                                        |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| I. Um núcleo, dois canais   | PASS   | Histórico alimenta o mesmo `processMessage` → `core`; HTTP e Studio continuam no laço único                   |
| II. Hexágono                | PASS   | Porta em `core`; impl em `db`; `agent` sem `db`; só composition/worker instanciam                             |
| III. Integridade financeira | PASS   | Expurgar chat **não** apaga venda/cadastro/auditoria; anáfora não calcula centavo                             |
| IV. RLS / tenant            | PASS   | `withTenant` em todo método; loja B = ausência; UNIQUE de identidade já na 0018                               |
| V. Teste que prova          | PASS   | Relógio injetado (idle/30 d); Postgres real (RLS + reinício); CI sem OpenAI; stub de `LlmPort` prova a janela |
| Produto — confirmação       | PASS   | Idle 2 h **não** mexe no TTL de 5 min; “sim” continua a máquina da NR-061                                     |
| Segurança — harness         | PASS   | Sem canal novo; corpo de mensagem fora do log (RNF-034)                                                       |
| IA — teto / mínimo          | PASS   | No máximo 12 msgs ao modelo (RNF-075); teto de consumo já existente não é burlado                             |

**Pós Phase 1:** sem violações. Reusar o stub de `conversations` **não** reabre a NR-061: não muda aceite/recusa/TTL. Fila de expurgo **não** é quarto app — é consumidor no `apps/worker` já existente. Complexidade Tracking vazio.

## Project Structure

### Documentation (this feature)

```text
specs/005-contexto-conversa-isolado/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── conversation-store.md
│   ├── llm-history.md
│   └── conversation-purge.md
└── tasks.md                 # /speckit-tasks (ainda não)
```

Identidade da row: [004 conversation-identity](../004-sensitive-action-confirm/contracts/conversation-identity.md) — esta fatia **grava** `messages` nela.

### Source Code (repository root)

```text
packages/core/src/
├── ports/conversations.ts              # ConversationStore + purge
├── conversations/purge-history.ts      # caso de uso; relógio = ctx.now
└── index.ts

packages/db/src/
├── conversation-identity.ts            # upsert compartilhado com confirmação (number_from)
├── conversation-repository.ts          # createConversationStore(sql)
├── conversation-repository.test.ts     # Postgres: janela, idle via created_at, RLS, expurgo
└── migrations/0019_conversation_messages_idx.sql

packages/agent/src/
├── types.ts                            # LlmPort.decide(+history); AgentRuntime.conversations
├── conversations.ts                    # InMemoryConversationStore (teste)
├── process-message.ts                  # loadActive → decide → append
├── mastra-llm.ts                       # recorte no generate; sem @mastra/memory
├── fake-llm.ts                         # histórico opcional (teste injeta LlmPort)
├── create-runtime.ts                   # injeta store; default in-memory nos testes
└── process-message.test.ts

apps/api/src/composition.ts             # createConversationStore(sql) no runtime

apps/worker/src/
├── queues.ts                           # conversation-purge
└── consumers/conversation-purge.ts     # chama o caso de uso; payload irrelevante

docs/arquitetura/esquema-postgresql.md  # number_from (não “peer”)
docs/arquitetura/integracoes/mastra.md  # NR-062 ✅ no contrato de memória
packages/agent/README.md
docs/processo/task-ledger.md            # NR-062 → ✅
```

**Structure Decision**: manter o monorepo. NR-062 **não** cria pacote novo nem liga Memory Mastra. O histórico é porta + repositório no hexágono já usado pela confirmação; o expurgo é caso de uso em `core` disparado pelo worker, no mesmo molde de `charge-overdue`.

## Complexity Tracking

> Sem violações a justificar.
