---
description: 'Task list for NR-121 Mastra Studio engineering harness'
---

# Tasks: Harness Studio de engenharia (NR-121)

**Input**: Design documents from `/specs/003-studio-harness/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Incluídos — constitution V, SC da spec e `plan.md` (Vitest + FakeLlm; sem OpenAI na CI). SC-003 (5 s / 8 s com provedor real) é smoke manual, não tarefa de CI.

**Organization**: Por user story da spec (US1–US3). Código NR-060 já existe — tarefas acrescentam relé + adapter.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem depender de tarefa incompleta)
- **[Story]**: US1…US3 mapeiam as jornadas da spec
- Todo item tem caminho de arquivo

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependências, arquivos de preset e variável de ambiente — sem lógica de laço ainda

- [x] T001 Adicionar `@mastra/fastify` em `apps/api/package.json` e CLI `mastra` como devDependency (API ou root `package.json`); conferir `@mastra/core` ^1.66 em `packages/agent/package.json`
- [x] T002 [P] Criar `packages/agent/studio/presets.example.json` no schema de `specs/003-studio-harness/contracts/presets.md` (`id` slug `[a-z0-9-]+` único, `peer` único, `role` literal `owner`, placeholders UUID)
- [x] T003 [P] Ignorar IDs reais: adicionar `packages/agent/studio/presets.json` em `.gitignore`
- [x] T004 [P] Adicionar `AGENT_STUDIO_PRESETS` opcional (path; ausente/vazio = default `packages/agent/studio/presets.json`) em `packages/env/src/api.ts` e parse/default em `packages/env/src/api.test.ts`
- [x] T005 [P] Script `studio` em `apps/api/package.json` (e/ou root `package.json`) que sobe a SPA do Studio contra `API_URL` / prefixo `/api`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Loader de preset, diretório de peer, agent-relé, adapter Fastify atrás do porteiro — **bloqueia** todas as stories

**⚠️ CRITICAL**: Nenhuma user story começa antes deste checkpoint

- [x] T006 Implementar load/validação em `packages/agent/src/studio/presets.ts`: JSON `.strict()` por preset; `id` `[a-z0-9-]+` único; `peer` único após normalizar só dígitos; `role` literal `owner`; `companyId`/`userId` UUID; peer duplicado ou chave extra recusa o load (não mistura empresas)
- [x] T007 Testes de load (ok, `.strict()`, peer duplicado, role inválido, arquivo ausente) em `packages/agent/src/studio/presets.test.ts`
- [x] T008 Implementar `FixturePeerDirectory` (`resolve` / `byId` / `peers`) em `packages/agent/src/studio/fixture-peer-directory.ts` — `resolve(peer)` normaliza só dígitos; miss → `null`
- [x] T009 Testes hit/miss/normalização (`+55 11 99900-0001` = `5511999000001`) em `packages/agent/src/studio/fixture-peer-directory.test.ts`
- [x] T010 Model determinístico do relé (sempre tool call `process_message` com o texto do usuário; **zero** OpenAI) em `packages/agent/src/studio/relay-model.ts` — conferir API atual em `node_modules/@mastra/core` (skill Mastra); se a assinatura de model custom falhar, wrapper de `generate` no mesmo arquivo, nunca cair no `erp-agent`
- [x] T011 Agent `studio-harness` + única tool `process_message` (`input.text` trim 1–4000, mesmo recorte de `agentMessageInputSchema`) em `packages/agent/src/studio/relay-agent.ts`: `execute` chama `processMessage` com `channel: 'whatsapp'` e `peer` do diretório; **não** registra tools de negócio
- [x] T012 Exportar loader, diretório e factory do relé em `packages/agent/src/index.ts`
- [x] T013 Passar `peers` do `FixturePeerDirectory` em `createAgentRuntime` via `buildAgentDeps` em `apps/api/src/composition.ts` (arquivo ausente/inválido → runtime HTTP segue, Studio não monta)
- [x] T014 Montar `MastraServer` (`@mastra/fastify`) só quando `motivoDoAgenteIndisponivel() === undefined` **e** presets carregaram, em `apps/api/src/studio.ts`; prefixo `/api`; único agent `studio-harness`
- [x] T015 Chamar o mount a partir de `apps/api/src/index.ts` (mesmo Fastify; sem processo `mastra dev`)
- [x] T016 Testes de porteiro em `apps/api/src/studio.test.ts`: produção/`fake`/harness off → `/api/agents` **404** (adapter não monta); com harness local → lista **só** `studio-harness` (sem `erp-agent`)
- [x] T017 Garantir que `POST /agent/messages` permanece estrito (`text` só, `channel: 'app'`) — regressão em `apps/api/src/routes/agent.test.ts`

**Checkpoint**: Adapter gated; relé existe; HTTP NR-060 intacto — stories podem começar

---

## Phase 3: User Story 1 — Conversar no harness como no canal de mensagem (Priority: P1) 🎯 MVP

**Goal**: Dev com fixture + FakeLlm envia texto no agent `studio-harness` e recebe a mesma resposta (centavos e `kind`) que `POST /agent/messages`; pergunta fora do catálogo lista só capacidades atuais; sem chave paga

**Independent Test**: `AGENT_PROVIDER=fake`, preset válido, `quanto vendi hoje?` no relé = HTTP da mesma empresa; nonsense → capacidades; OpenAI não é chamado no generate do Studio

### Tests for User Story 1

> Escrever primeiro; devem **falhar** até o relé estar no laço certo

- [x] T018 [P] [US1] Teste: mesma frase no relé e em `processMessage` (`channel: 'app'` vs relé `whatsapp` na **mesma** fixture) devolve os mesmos centavos/`kind` em `packages/agent/src/studio/relay-agent.test.ts`
- [x] T019 [P] [US1] Teste: frase fora do catálogo → `unknown` + `textoDasCapacidades` (sem inventar estoque) em `packages/agent/src/studio/relay-agent.test.ts`
- [x] T020 [US1] Teste de integração Fastify: generate/chat do `studio-harness` com FakeLlm em `apps/api/src/studio.test.ts` (path real do `@mastra/fastify`, não inventar URL)

### Implementation for User Story 1

- [x] T021 [US1] Fechar o relé em `packages/agent/src/studio/relay-agent.ts` / `relay-model.ts` para o generate do Studio **não** acrescentar hop de LLM (FakeLlm só dentro de `processMessage`)
- [x] T022 [US1] Mapear contexto do preset selecionado (slug → peer do arquivo) em `packages/agent/src/studio/request-context.ts` — nesta story basta `preset` válido; `companyId` no JSON ainda pode ser ignorado de forma explícita (US2 endurece)
- [x] T023 [US1] Documentar no `packages/agent/README.md` o fluxo mínimo: copiar example → preencher UUIDs → `pnpm studio` → agent `studio-harness`

**Checkpoint**: MVP — conversa no painel sem OpenAI, equivalente ao HTTP de teste

---

## Phase 4: User Story 2 — Identidade forjada no lugar do WhatsApp (Priority: P1)

**Goal**: Preset + número forjado resolvem `ExecutionContext` no servidor; `companyId`/`userId`/`role` no request context do cliente são ignorados; peer desconhecido recusa sem vazar; dois presets isolam dados; mutação pede confirmação no fio `wa:${companyId}:${peer}`

**Independent Test**: dois presets → vendas de A não aparecem em B; context com UUID da loja B + preset A continua A; peer/preset miss → recusa genérica; cadastro só grava após `sim`

### Tests for User Story 2

- [x] T024 [P] [US2] Testes de allowlist em `packages/agent/src/studio/request-context.test.ts`: honra `preset` e/ou `peer`; ignora `companyId`/`userId`/`role`; preset+peer contraditórios recusam; miss recusa
- [x] T025 [P] [US2] Teste de isolamento (dois diretórios/presets, duas empresas) em `packages/agent/src/studio/relay-agent.test.ts`
- [x] T026 [US2] Teste: `processMessage` `ignored` + texto vazio vira recusa **genérica** não vazia no envelope da tool (sem revelar outra empresa) em `packages/agent/src/studio/relay-agent.test.ts`
- [x] T027 [US2] Teste: `create_customer` (FakeLlm `script`) → `confirmation` → `sim` no canal `whatsapp` grava; `talvez` não grava — `packages/agent/src/studio/relay-agent.test.ts` (chave `wa:…` em `packages/agent/src/format.ts`)

### Implementation for User Story 2

- [x] T028 [US2] Completar `packages/agent/src/studio/request-context.ts` conforme `specs/003-studio-harness/data-model.md` (ordem: preset conhecido → peer; senão peer; senão recusa)
- [x] T029 [US2] Traduzir `kind: 'ignored'` para texto genérico de “não vinculado” em `packages/agent/src/studio/relay-agent.ts` (FR-005)
- [x] T030 [US2] Gerar mapa de dropdown no formato request-context presets do Mastra a partir do loader em `packages/agent/src/studio/presets.ts` e ligar em `apps/api/src/studio.ts` / script `studio`

**Checkpoint**: Número forjado substitui Zap em engenharia; tenant não vaza pelo JSON do Studio

---

## Phase 5: User Story 3 — Ver se o turno cabe no RNF-006 (Priority: P2)

**Goal**: Cada turno do relé devolve `durationMs` (envio → `processMessage` retornou) visível no output da tool; log estruturado; tetos 5 s / 8 s medidos em smoke manual com provedor real

**Independent Test**: consulta FakeLlm inclui `durationMs` ≥ 0 no envelope; log `agent.studio.turn`; README descreve conferência manual ≤ 5000 / ≤ 8000 com `AGENT_PROVIDER=mastra`

### Tests for User Story 3

- [x] T031 [US3] Teste: envelope da tool sempre tem `durationMs` number ≥ 0 após consulta e após `sim` em `packages/agent/src/studio/relay-agent.test.ts`

### Implementation for User Story 3

- [x] T032 [US3] Medir `startedAt`/`durationMs` no `execute` de `process_message` em `packages/agent/src/studio/relay-agent.ts`; relógio injetável nos testes
- [x] T033 [US3] Log estruturado `agent.studio.turn` (`companyId`, `peer` mascarado, `durationMs`, `kind`, `requestId`) em `apps/api/src/studio.ts` ou no relé — sem dado pessoal em claro (RNF-034)
- [x] T034 [P] [US3] Notas de smoke SC-003 (fora da CI) em `packages/agent/README.md` e `specs/003-studio-harness/quickstart.md`

**Checkpoint**: RNF-006 inspecionável no harness; CI não chama OpenAI

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Ledger, docs permanentes, fronteiras, quickstart

- [x] T035 [P] Marcar NR-121 ✅ no mesmo PR em `docs/processo/task-ledger.md` (e CSV se o check exigir)
- [x] T036 [P] Atualizar `docs/arquitetura/integracoes/mastra.md`: Studio = relé → `processMessage`; sem `/api/agents` de negócio; presets; `durationMs`
- [x] T037 [P] Matriz `AGENT_STUDIO_PRESETS` + `AGENT_HARNESS` em `docs/engenharia/ambientes.md` e `.env.example`
- [x] T038 [P] Tirar “Rotas Studio Mastra” de fora de escopo em `specs/002-agent-mastra-runtime/contracts/agent-messages.md` (apontar para `specs/003-studio-harness/contracts/studio-harness.md`)
- [x] T039 Rodar `pnpm boundaries` e corrigir import novo (`agent` ↛ `db`/`domain`; `@mastra/fastify` só em `apps/api`)
- [x] T040 Rodar `pnpm --filter @na-regua/agent test` e `pnpm --filter api test -- agent` / `studio`
- [x] T041 Executar checklist de `specs/003-studio-harness/quickstart.md` com dois presets e FakeLlm
- [x] T042 [P] Confirmar que confirmação continua in-memory (NR-061), Memory/RAG/Meta fora — nota no `packages/agent/README.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)**: começa já
- **Foundational (2)**: depois do Setup — **BLOCKS** US1–US3
- **US1 (3)**: depois da Phase 2 — MVP
- **US2 (4)**: depois da Phase 2; na prática depois da US1 (relé conversando)
- **US3 (5)**: depois da US1 (precisa do `execute` do relé); pode paralelizar com US2 se o envelope já existir
- **Polish (6)**: depois das stories desejadas (DoD = US1+US2+US3)

### User Story Dependencies

| Story             | Depende de                | Notas                          |
| ----------------- | ------------------------- | ------------------------------ |
| US1 Painel = HTTP | Phase 2                   | MVP; FakeLlm                   |
| US2 Peer forjado  | Phase 2 + relé da US1     | Isolamento e confirmação `wa:` |
| US3 `durationMs`  | `process_message` execute | P2; smoke real fora da CI      |

### Parallel Opportunities

- T002 ∥ T003 ∥ T004 ∥ T005 (depois de T001 se o script não precisar do Fastify ainda; T005 pode esperar T001)
- T018 ∥ T019 (testes US1)
- T024 ∥ T025 (testes US2)
- T034 ∥ T035 ∥ T036 ∥ T037 ∥ T038 ∥ T042 (docs)
- Depois da Phase 2, com duas pessoas: A fecha US1, B prepara testes US2 no request-context

---

## Parallel Example: Setup

```bash
Task: "presets.example.json em packages/agent/studio/presets.example.json"
Task: "gitignore packages/agent/studio/presets.json em .gitignore"
Task: "AGENT_STUDIO_PRESETS em packages/env/src/api.ts"
```

## Parallel Example: User Story 2 tests

```bash
Task: "allowlist request-context.test.ts"
Task: "isolamento dois presets em relay-agent.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup
2. Phase 2 Foundational (porteiro + relé + mount)
3. Phase 3 US1
4. **STOP** — validar quickstart linha 1 (consulta FakeLlm no Studio = HTTP)

### Incremental Delivery (DoD do merge)

1. US2 identidade forjada + isolamento + confirmação
2. US3 `durationMs` + log + nota RNF-006
3. Polish: ledger ✅, docs, boundaries, quickstart

### Suggested MVP scope

**US1 só** para o primeiro demo. **DoD de merge** = US1 + US2 + US3 (RNF-006 visível) + Polish.

---

## Notes

- Não registrar `erp-agent` em `/api/agents`
- Não ligar Memory / Workflow / RAG / DuckDB / Mastra Cloud
- Não mudar o schema de `POST /agent/messages`
- Não usar celular de lojista real nos presets (RNF-034)
- Confirmação persiste in-memory até NR-061
- PeerDirectory de produção é NR-113 — esta fatia é só fixture
- Webhook Meta é NR-046
- Refs: NR-121 no rodapé do commit / PR
- Verificar API Mastra na implementação (embedded docs); não confiar em memória do modelo
