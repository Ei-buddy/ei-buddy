# Quickstart: validar NR-121 (harness Studio)

**Goal**: Desenvolvedor abre o Studio, escolhe um preset de fixture, conversa pelo painel, vê a mesma resposta do `POST /agent/messages` e a duração do turno — sem WhatsApp e sem chave (FakeLlm).

## Prerequisites

- Repo instalado, Postgres do Compose no ar ([setup](../../docs/engenharia/setup.md))
- Branch `feat/NR-121-harness-studio`
- `AGENT_PROVIDER=fake` (default local)
- NR-060 no ar: `POST /agent/messages` com fixture já funciona
- Copiar `packages/agent/studio/presets.example.json` → `presets.json` (ou `AGENT_STUDIO_PRESETS`) e **preencher** `companyId` / `userId` da fixture criada

## Setup

1. Subir a API em não-produção (`pnpm --filter api dev` / fluxo do repo).
2. Criar duas empresas de fixture (owner + 1 venda do dia em cada), se for validar isolamento.
3. Preencher dois presets com peers distintos (`5511999000001`, `5511999000002`).
4. Subir o Studio apontando para a API (`pnpm studio` ou equivalente do README). Abrir o painel; agent visível: **só** `studio-harness`.
5. Selecionar o preset `claudia-loja-1` no dropdown de request context.

## Smoke automatizado

```bash
pnpm --filter @na-regua/agent test
pnpm --filter @na-regua/api exec vitest run src/studio.test.ts src/routes/agent.test.ts
```

Esperado: `FixturePeerDirectory` (hit, miss, duplicata no load); relé chama `processMessage` com `channel: 'whatsapp'`; `durationMs` presente; `companyId` no context do cliente ignorado; dois presets isolam vendas (FakeLlm); produção/harness desligado **não** monta `/api/agents`; `POST /agent/messages` inalterado.

A CI **não** sobe a SPA. Com `AGENT_PROVIDER=fake` e dois presets
(`claudia-loja-1` / `claudia-loja-2` em `presets.example.json`), o smoke
manual que não exige o painel está coberto assim:

| # | Smoke | Teste |
| - | ----- | ----- |
| 1 | consulta preset 1 = HTTP (centavos/`kind`) | `packages/agent/src/studio/relay-agent.test.ts` |
| 2 | mesma frase no preset 2 → outra empresa | `relay-agent.test.ts` (isolamento) |
| 3 | `companyId` do cliente ignorado | `request-context.test.ts` + isolamento no relé |
| 4 | peer / preset desconhecido | `relay-agent.test.ts` (recusa genérica) |
| 5 | `create_customer` → `sim` no fio `wa:` | `relay-agent.test.ts` |
| 6 | `talvez` / sem `sim` | `relay-agent.test.ts` (não grava) |
| 7 | produção / harness off | `apps/api/src/studio.test.ts` (`/api/agents` 404) |

`durationMs` ≥ 0: US3 em `relay-agent.test.ts`. O painel visual (`pnpm studio`)
continua smoke humano — não rode na Actions.

## Smoke manual (DoD)

| # | Ação | Esperado |
| - | ---- | -------- |
| 1 | Chat: `quanto vendi hoje?` no preset 1 | `answer` + centavos = HTTP `/agent/messages` da mesma empresa; `durationMs` visível no output da tool |
| 2 | Mesma frase no preset 2 | Totais da **outra** empresa; não os do preset 1 |
| 3 | Context `{ "companyId": "<uuid da loja 2>" }` com preset 1 | Continua a loja 1 (campo ignorado) |
| 4 | Peer / preset desconhecido | Recusa genérica; zero venda/cadastro |
| 5 | `cadastra o João, 11 98888-7777` → `sim` | Confirmação no mesmo fio; cliente criado via `core` |
| 6 | Sem `sim` / TTL | Nada gravado |
| 7 | Produção / harness off | Studio/`/api/agents` ausente; HTTP 503 como NR-060 |

Contratos: [studio-harness.md](./contracts/studio-harness.md), [presets.md](./contracts/presets.md). Modelo: [data-model.md](./data-model.md). HTTP antigo: [002 agent-messages](../002-agent-mastra-runtime/contracts/agent-messages.md).

## Opcional — provedor real (SC-003 / RNF-006, fora da CI)

Smoke **manual**. A CI não chama OpenAI: ela só prova que `durationMs` existe
no envelope da tool. Conferir tetos no painel, no output de `process_message`
(não no relógio de pulso).

```bash
AGENT_PROVIDER=mastra OPENAI_API_KEY=… AGENT_MODEL=openai/gpt-4o-mini
```

1. Subir a API em não-produção e `pnpm studio`. Preset de fixture (número
   forjado; nunca celular real).
2. Chat: `quanto vendi hoje?` — `durationMs` ≤ **5000**.
3. `cadastra o João, 11 98888-7777` → proposta → `sim` — `durationMs` do
   turno do `sim` ≤ **8000**.
4. Estouro: o valor acima do teto permanece visível no output da tool.
   Log `agent.studio.turn` correlaciona o mesmo turno (`companyId`, `peer`
   mascarado, `durationMs`, `kind`, `requestId`).

O generate do Studio **ainda** não deve chamar o modelo — só o laço interno.

## Não fazer nesta fatia

- Registrar `erp-agent` no `/api/agents`
- Memory / RAG / Workflow Mastra
- Webhook Meta (NR-046)
- Confirmação em banco (NR-061)
- Celular real de owner (NR-113)

## Definition of Done (checklist rápido)

Cobertura FakeLlm (dois presets) = smoke automatizado acima. Painel visual
(`pnpm studio`) e tetos SC-003 com provedor real continuam manuais.

- [ ] SC-001 fake no painel
- [ ] SC-002 centavos = app = HTTP
- [ ] SC-004 recusas (preset/prod/lojista)
- [ ] SC-005 confirmação
- [ ] SC-006 `durationMs` visível
- [ ] Ledger NR-121 → ✅ no PR
- [ ] README agent + `ambientes.md` + `.env.example`
