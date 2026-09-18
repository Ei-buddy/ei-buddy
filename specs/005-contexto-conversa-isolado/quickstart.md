# Quickstart: validar NR-062 (contexto isolado)

**Goal**: Desenvolvedor ancora um cliente no fio, diz “manda a cobrança pra ele” e o laço resolve **sem** repetir o nome; depois de 2 h o mesmo pronome **não** ancora; loja B não herda; corpos somem aos 30 dias — FakeLlm/stub, sem WhatsApp e sem chave.

## Prerequisites

- Repo instalado, Postgres do Compose no ar ([setup](../../docs/engenharia/setup.md))
- Branch `feat/NR-062-contexto-conversa-isolado`
- `AGENT_PROVIDER=fake` (default local)
- NR-060/121 no ar; identidade de conversa da NR-061 (tabela `conversations` + UNIQUE 0018)
- Fixture: duas empresas, cliente na loja 1 (id conhecido no stub)

## Setup

1. Subir Postgres + API em não-produção.
2. Criar duas fixtures (owner + cliente “João” só na loja 1).
3. Presets Studio: dois peers distintos, se for validar o painel.

## Smoke automatizado

```bash
pnpm --filter @na-regua/agent test
pnpm --filter @na-regua/core exec vitest run src/conversations
pnpm --filter @na-regua/db exec vitest run src/conversation-repository.test.ts
pnpm --filter @na-regua/api exec vitest run src/routes/agent.test.ts src/composition.test.ts
pnpm --filter @na-regua/worker exec vitest run src/consumers/conversation-purge.test.ts
```

Esperado: janela ≤ 12 e idle 2 h no laço (relógio injetado); stub de `LlmPort` ancora “ele” só com history; Postgres sobrevive a nova instância do store; loja B = ausência; DELETE de mensagens ≥ 30 d não mexe em venda; `conversation-purge` chama o caso de uso.

| #   | Smoke                                       | Teste                                                         |
| --- | ------------------------------------------- | ------------------------------------------------------------- |
| 1   | âncora + “ele” no fio ativo                 | `process-message.test.ts` (LlmPort stub + InMemory store)     |
| 2   | idle > 2 h → history vazio, stub não ancora | `process-message.test.ts`                                     |
| 3   | 13ª mensagem: `decide` recebe ≤ 12          | `process-message.test.ts` / `conversation-repository.test.ts` |
| 4   | put/append → nova instância ainda lê        | `conversation-repository.test.ts` (reinício)                  |
| 5   | loja B não lê o fio da A                    | `conversation-repository.test.ts` (RLS)                       |
| 6   | `app:` ≠ `wa:`                              | `conversation-repository.test.ts`                             |
| 7   | expurgo 30 d: corpos some, venda permanece  | `conversation-repository.test.ts` + caso de uso core          |
| 8   | composition injeta store Postgres           | `apps/api/src/composition.test.ts`                            |

A CI **não** chama OpenAI. “Ele” com `AGENT_PROVIDER=mastra` é smoke humano no harness.

## Smoke manual (DoD)

Relógio real de 2 h **não** se espera no painel: use os testes com `now` injetado para idle/30 d. No harness, o caminho feliz:

| #   | Ação                                                               | Esperado                                                                   |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 1   | HTTP ou Studio, loja 1: identificar o João (script/modelo)         | resposta ok; turno gravado                                                 |
| 2   | Mesmo fio, ainda ativo: `manda a cobrança pra ele`                 | proposta de cobrança **daquele** cliente; confirmação no laço já existente |
| 3   | Mesma frase na loja 2 / outro preset                               | **não** o João da loja 1; pede de novo ou sem âncora                       |
| 4   | Reiniciar a API, repetir o passo 2 no **mesmo** canal+interlocutor | ainda ancora (idle < 2 h)                                                  |
| 5   | Produção / harness off                                             | inalterado (503 / adapter ausente)                                         |

Contratos: [conversation-store.md](./contracts/conversation-store.md), [llm-history.md](./contracts/llm-history.md), [conversation-purge.md](./contracts/conversation-purge.md). Modelo: [data-model.md](./data-model.md). Identidade: [004](../004-sensitive-action-confirm/contracts/conversation-identity.md).

## Opcional — provedor real (anáfora com modelo)

Fora da CI. `AGENT_PROVIDER=mastra` + chave. Mesmo preset, dois turnos curtos (“cadastra/fala do João” → “manda a cobrança pra ele”). Conferir que a tool `send_charge` (ou a proposta) traz o cliente certo. Se o modelo errar com janela cheia, o remédio da ADR é pedir esclarecimento — não aumentar as 12.

## Não fazer nesta fatia

- `@mastra/memory` / Storage / RAG
- Unificar HTTP `app` com Studio `wa`
- Redesenhar TTL de confirmação (5 min)
- Webhook Meta / celular real (NR-046 / NR-113)
- Perfil de preferências ou treino

## Definition of Done (checklist rápido)

- [x] SC-001 anáfora no fio ativo (stub + harness)
- [x] SC-002 idle / ambíguo não aplica âncora em silêncio
- [x] SC-003 isolamento loja B
- [x] SC-004 teto 12 no `decide`
- [x] SC-005 expurgo 30 d, negócio intacto
- [x] SC-006 reinício na mesma identidade
- [x] Ledger NR-062 → ✅ no PR
- [x] README agent + `mastra.md` + esquema (`number_from`)
