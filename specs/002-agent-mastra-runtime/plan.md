# Implementation Plan: Assistente — runtime mínimo (NR-060)

**Branch**: `feat/NR-060-runtime-agente` | **Date**: 2026-09-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-agent-mastra-runtime/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Fechar a NR-060: runtime Mastra (já esboçado em `packages/agent`) operacional como **harness de engenharia** — fixture de loja + `AGENT_PROVIDER=fake|mastra`, tools tipadas de `contracts` → `core`, confirmação volátil — cobrindo US-047–049, US-052, US-053/RF-108 e recusas RF-149–151. Lacunas principais vs. código atual: resumo de período via DRE (não só faturamento), tool de cobrança, tools/rotas de recusa, porteiro do harness alinhado às clarificações, medição/teto de IA, e FakeLlm/roteiros para o DoD sem OpenAI. RF-109 fica dívida explícita.

## Technical Context

**Language/Version**: TypeScript 5.x / Node (ESM), monorepo pnpm + Turborepo

**Primary Dependencies**: `@mastra/core` ^1.66 (`Agent`, `createTool`), Zod via `@na-regua/contracts`, Fastify em `apps/api`, OpenAI via model router `openai/gpt-4o-mini` quando `AGENT_PROVIDER=mastra`

**Storage**: Postgres + RLS existente (sem novas tabelas nesta fatia; confirmações in-memory; sem Memory Mastra / sem RAG)

**Testing**: Vitest — unit em `packages/agent`; integração rota em `apps/api`; FakeLlm + fixture; sem adapter OpenAI na CI

**Target Platform**: API Node no monorepo (local/dev/staging harness); produção: rota desligada ou só Mastra real (já barrado `fake` em prod)

**Project Type**: library (`packages/agent`) + composition/HTTP harness (`apps/api`)

**Performance Goals**: consulta ≤ 5 s, ação com confirmação ≤ 8 s após o “sim” (RNF-006) no canal de teste

**Constraints**: agente NÃO calcula (RF-101); tools = schemas de `contracts`; confirmação antes de mutação/envio; harness só não-produção ou flag; sem Studio (NR-121); sem WhatsApp Meta (NR-046); sem persistência de confirmação (NR-061); sem memória multi-turno (NR-062)

**Scale/Scope**: 1 runtime, ~8–10 tools no catálogo mínimo, 1 endpoint `POST /agent/messages`, DoD = cenários P1 + cobrança + RF-108

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Princípio                   | Status | Como esta fatia cumpre                                                                       |
| --------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| I. Um núcleo, dois canais   | PASS   | Tools só chamam casos de uso de `core`; HTTP e futuro WhatsApp compartilham `processMessage` |
| II. Hexágono                | PASS   | `agent` não importa `db`/`domain`; composição em `apps/api`; schemas em `contracts`          |
| III. Integridade financeira | PASS   | Venda/cadastro/cobrança via `core`; LLM não soma; confirmação antes de gravar                |
| IV. RLS / tenant            | PASS   | `ExecutionContext` da sessão fixture; sem `companyId` no body                                |
| V. Teste que prova          | PASS   | FakeLlm + testes de centavos iguais ao app; recusas sem efeito; CI sem OpenAI                |
| Produto — confirmação       | PASS   | `mutatesValue` + InMemoryConfirmations (persistência = NR-061)                               |
| Segurança — harness         | PASS   | Não-prod/flag; fixture; produção sem `fake`; sem liberar a lojista real                      |
| IA — teto                   | PASS   | Medir por empresa + `AGENT_MONTHLY_BUDGET_CENTS` com degradação avisada                      |

**Pós Phase 1:** sem violações. Complexidade Tracking vazio.

## Project Structure

### Documentation (this feature)

```text
specs/002-agent-mastra-runtime/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── agent-messages.md
│   └── tool-catalog.md
└── tasks.md                 # /speckit-tasks (ainda não)
```

### Source Code (repository root)

```text
packages/agent/
├── src/
│   ├── catalog.ts              # tools + textoDasCapacidades
│   ├── create-runtime.ts
│   ├── process-message.ts
│   ├── confirmations.ts        # InMemory (NR-061 depois)
│   ├── define-tool.ts
│   ├── fake-llm.ts
│   ├── mastra-llm.ts
│   ├── format.ts
│   ├── types.ts
│   └── index.ts
└── README.md

packages/contracts/src/
├── agent/message.ts            # agentMessageInput / AgentReply
├── accounting/                 # dre* → RF-108
└── …                           # createSale, createCustomer, …

packages/core/src/
├── sales/register-sale.ts
├── registration/register-customer.ts
├── receivables/
├── accounting/build-dre.ts     # RF-108
└── …                           # sendCustomerCharge (a criar se ausente)

apps/api/src/
├── routes/agent.ts             # POST /agent/messages + porteiro
├── composition.ts              # buildAgentDeps, motivoDoAgenteIndisponivel
└── …
```

**Structure Decision**: manter o layout atual do monorepo. NR-060 completa e endurece `packages/agent` + composition/rota na API; não cria app nem processo Mastra Server. Studio (porta 4111) fica NR-121.

## Complexity Tracking

> Sem violações a justificar.
