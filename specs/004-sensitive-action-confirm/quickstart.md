# Quickstart: validar NR-061 (confirmação persistente)

**Goal**: Uma mutação pede confirmação e não grava; “sim” no prazo grava pelo mesmo caso de uso do app **depois de reiniciar a API**; ambíguo/expirado não gravam; loja B não vê a pendência da loja A.

## Prerequisites

- Repo instalado, Postgres do Compose no ar ([setup](../../docs/engenharia/setup.md))
- Branch `feat/NR-061-confirmacao-acao-sensivel`
- `AGENT_PROVIDER=fake` (default local)
- NR-060 + NR-121 no ar: `POST /agent/messages` e Studio (`pnpm studio`) já conversam com o laço
- Fixture owner + (opcional) segundo preset/empresa para isolamento

## Setup

1. Migrar até `0018` (`pnpm db:migrate` / fluxo do repo).
2. Subir a API em não-produção.
3. Autenticar como fixture (HTTP) e/ou preencher `presets.json` (Studio).

## Smoke automatizado

```bash
pnpm --filter @na-regua/agent test
pnpm --filter @na-regua/db exec vitest run src/confirmation-repository.test.ts
pnpm --filter @na-regua/api exec vitest run src/routes/agent.test.ts src/e2e/agent-confirmation-restart.test.ts
```

Esperado:

| #   | Smoke                                              | Onde                                                                  |
| --- | -------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | laço sim/não/ambíguo/TTL (já NR-060)               | `packages/agent/src/process-message.test.ts`                          |
| 2   | put → nova instância do store → getOpen ainda acha | `confirmation-repository.test.ts` (reinício)                          |
| 3   | loja B não lê/resolve a da A                       | `confirmation-repository.test.ts` (RLS)                               |
| 4   | put novo na mesma chave resolve a anterior         | `confirmation-repository.test.ts`                                     |
| 5   | HTTP confirmação → sim ainda chama `core`          | `apps/api` rota agent                                                 |
| 6   | HTTP proposta → mata Fastify → `sim` grava uma vez | `apps/api/src/e2e/agent-confirmation-restart.test.ts` (FR-008 / T041) |

A CI **não** chama OpenAI e **não** exige a SPA do Studio.

## Smoke manual (DoD)

### A — mesmo ingresso, com reinício (FR-008)

Com sessão da fixture:

```http
POST /agent/messages
{ "text": "cadastra o João, 11 98888-7777" }
```

Esperado: `kind: confirmation`, cliente **não** criado.

1. Reiniciar o processo da API (mata o Node; sobe de novo).
2. Ainda no prazo (5 min): `POST /agent/messages` `{ "text": "sim" }`.
3. Esperado: cliente criado; segundo `sim` não duplica.

O equivalente automatizado (CI, `DATABASE_URL`, FakeLlm roteirizado no pedido — o reconhecedor local não interpreta cadastro) é `apps/api/src/e2e/agent-confirmation-restart.test.ts`: fecha o Fastify, sobe outra instância com store novo no mesmo Postgres, manda `sim` no canal `app`. Sessão sobrevive porque está no banco (NR-083).

Repetir o mesmo ciclo no Studio (preset 1, `channel` whatsapp): proposta → restart → `sim`. **Não** cruzar o `sim` HTTP com a proposta do Studio (chaves diferentes — [research §4](./research.md)). O T041 do merge cobre o ciclo HTTP; o Studio continua smoke opcional do harness.

### B — expiração e ambiguidade (RF-104)

| #   | Ação                              | Esperado                                    |
| --- | --------------------------------- | ------------------------------------------- |
| 1   | Proposta + `talvez depois`        | cancelou; nada gravado; pendência encerrada |
| 2   | Proposta + relógio +5 min + `sim` | “expirou”; nada gravado                     |
| 3   | Expirada + `quanto vendi hoje?`   | consulta livre, sem confirmar               |

TTL nos testes usa `now` injetado; no manual, `confirmationTtlMs` de teste ou esperar só se estiver validando o relógio de parede.

### C — isolamento

Duas fixtures. Proposta na loja A. Sessão/preset da loja B manda `sim`. Esperado: zero efeito na A; B não recebe o resumo da A.

Contratos: [confirmation-store.md](./contracts/confirmation-store.md), [conversation-identity.md](./contracts/conversation-identity.md). Modelo: [data-model.md](./data-model.md).

## Opcional — RNF-006 (fora da CI)

Com provedor real, o `durationMs` do turno do `sim` no Studio continua ≤ 8 s (já NR-121). Persistência não deve somar um `generate` extra.

## Não fazer nesta fatia

- `requireToolApproval` / `approveToolCall` no Agent de negócio
- Gravar `messages` / anáfora (NR-062)
- Unificar chave HTTP `app` com Studio `wa`
- WhatsApp Meta / celular real (NR-113, NR-046)
- Tools novas (estoque, baixas, cancelar venda)

## Definition of Done (checklist rápido)

- [x] SC-001 zero efeito antes do sim
- [x] SC-002 ambíguo e expirado = zero efeito
- [x] SC-003 restart + sim no prazo = um efeito; centavos = app
- [x] SC-004 loja B = ausência
- [x] SC-005 consulta sem confirmação
- [ ] SC-007 P1 nos dois harnesses (cada um na sua chave) — HTTP coberto; Studio continua manual
- [x] Ledger NR-061 → ✅ no PR
- [x] README agent + `mastra.md` (in-memory → tabela)
