# Implementation Plan: Confirmação de ação sensível, com expiração (NR-061)

**Branch**: `feat/NR-061-confirmacao-acao-sensivel` | **Date**: 2026-09-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-sensitive-action-confirm/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Fechar a NR-061: a máquina de confirmação já existente em `processMessage` (RF-103/104, TTL 5 min, ambíguo = não) passa a persistir na tabela `confirmations` com RLS, ligada a um **stub** de `conversations` (identidade da loja + canal + interlocutor). Reinício da API não apaga pendência válida. Loja B não lê/confirma a da loja A. `InMemoryConfirmations` fica só no teste unitário. HITL Mastra não entra. Histórico/anáfora = NR-062.

## Technical Context

**Language/Version**: TypeScript 5.x / Node (ESM), monorepo pnpm + Turborepo

**Primary Dependencies**: `@na-regua/core` (porta), `@na-regua/db` (Postgres + `withTenant`), `@na-regua/agent` (`processMessage` inalterado no diálogo), Fastify composition em `apps/api`

**Storage**: PostgreSQL existente — tabelas `conversations` + `confirmations` (baseline 0007, RLS). Migration `0018` só para índices únicos de identidade/abertura. Sem Redis, sem Memory/Storage Mastra

**Testing**: Vitest — unit em `packages/agent` (laço, fake in-memory); integração em `packages/db` (store + RLS + “reinício” = nova instância); composição/rota em `apps/api`. Sem OpenAI na CI

**Target Platform**: API Node (harness HTTP NR-060 + Studio NR-121). Produção: mesmo store quando o harness/canal existir; Meta fora (NR-046)

**Project Type**: library (`core` porta + `db` impl + `agent` laço) + composition HTTP (`apps/api`)

**Performance Goals**: ciclo “sim” → efeito ≤ 8 s no harness (RNF-006); persistir/ler pendência no mesmo request, sem hop extra de LLM

**Constraints**: `agent` não importa `db`; confirmação nossa (não `requireToolApproval`); uma aberta por conversa; HTTP `app` e Studio `wa` **não** cruzam chave (ADR-0016); agente não calcula; sem gravar `messages`

**Scale/Scope**: 1 porta, 1 repositório, 1 migration de índices, wiring em `buildAgentDeps`; catálogo de tools inalterado

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Princípio                   | Status | Como esta fatia cumpre                                                                                         |
| --------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| I. Um núcleo, dois canais   | PASS   | “Sim” ainda executa o caso de uso de `core`; HTTP e Studio continuam no mesmo `processMessage`                 |
| II. Hexágono                | PASS   | Porta em `core`; impl em `db`; `agent` sem `db`; só `composition.ts` instancia o store                         |
| III. Integridade financeira | PASS   | Zero efeito antes do aceite; replace da aberta não executa a anterior; idempotência da escrita segue em `core` |
| IV. RLS / tenant            | PASS   | `withTenant` em todo método; `companyId` na assinatura; teste loja B = ausência                                |
| V. Teste que prova          | PASS   | Laço sem banco (já existe) + store contra Postgres (restart + isolamento); CI sem OpenAI                       |
| Produto — confirmação       | PASS   | Consultar livre; mutação/envio confirmam; TTL 5 min; ambíguo = não; não é 2FA (ADR-0002)                       |
| Segurança — harness         | PASS   | Sem canal novo; porteiro NR-060/121 inalterado                                                                 |
| IA — teto                   | PASS   | Teto já impede execute no escuro; store não cria segundo contador                                              |

**Pós Phase 1:** sem violações. Stub de `conversations` **não** reabre a NR-062: não carrega histórico, não manda 12 msgs ao modelo, não expurga. Complexidade Tracking vazio.

## Project Structure

### Documentation (this feature)

```text
specs/004-sensitive-action-confirm/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── confirmation-store.md
│   └── conversation-identity.md
└── tasks.md                 # /speckit-tasks (ainda não)
```

### Source Code (repository root)

```text
packages/core/src/ports/confirmations.ts    # ConfirmationStore, PendingConfirmation
packages/core/src/index.ts                  # reexporta a porta

packages/db/src/
├── confirmation-repository.ts              # createConfirmationStore(sql)
├── confirmation-repository.test.ts         # Postgres: ciclo, replace, restart, RLS
└── migrations/0018_confirmations_identity.sql

packages/agent/src/
├── types.ts                                # reexporta porta de core; AgentRuntime.confirmations
├── confirmations.ts                        # InMemoryConfirmations (teste)
├── create-runtime.ts                       # injeta store; default in-memory nos testes
└── process-message.ts                      # laço inalterado; put carrega companyId

apps/api/src/composition.ts                 # buildAgentDeps → createConfirmationStore

packages/agent/README.md
docs/arquitetura/integracoes/mastra.md
docs/processo/task-ledger.md                # NR-061 → ✅ no PR
```

**Structure Decision**: manter o monorepo e o laço. NR-061 **não** cria servidor, rota HTTP, tool nem agent Mastra novos. Só troca o store in-memory pelo Postgres na composição e declara a porta no lugar certo (`core`).

## Complexity Tracking

> Sem violações a justificar.
