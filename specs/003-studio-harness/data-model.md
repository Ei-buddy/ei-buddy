# Data Model: Harness Studio de engenharia (NR-121)

**Date**: 2026-09-17  
**Spec**: [spec.md](./spec.md)

Nesta fatia **não há migração Postgres**. Presets são arquivo de engenharia. Confirmações e teto de IA continuam voláteis (NR-060). Entidades abaixo são o modelo do harness.

---

## StudioPreset

Configuração nomeada, só servidor.

| Campo     | Tipo      | Regras                                                                 |
| --------- | --------- | ---------------------------------------------------------------------- |
| id        | string    | slug estável (`claudia-loja-1`); chave do arquivo e do request context |
| peer      | string    | E.164 forjado (`5511…`); único no arquivo inteiro                      |
| companyId | UUID      | empresa de **fixture**; nunca de produção                              |
| userId    | UUID      | owner da fixture                                                       |
| role      | `'owner'` | único papel desta fatia                                                |

**Validação no load**:

- JSON inválido / arquivo ausente com Studio ligado → adapter **não** monta; log; API segue.
- `peer` duplicado → recusa o load (FR-005 ambiguidade).
- Campos vazios ou `role !== 'owner'` → recusa o load.
- IDs de produção / dado pessoal real MUST NOT aparecer (RNF-034); o exemplo versionado usa placeholders.

**Não é** o `PeerDirectory` de produção (NR-113). É um mapa estático que implementa a mesma porta.

---

## FixturePeerDirectory

Implementação de `PeerDirectory` (`packages/agent`).

| Operação        | Entrada                          | Saída                                         |
| --------------- | -------------------------------- | --------------------------------------------- |
| `resolve(peer)` | string (normalizado, só dígitos) | `LinkedPeer` ou `null`                        |
| `byId(id)`      | slug do preset                   | preset ou `null`                              |
| `peers()`       | —                                | lista de `id` + `peer` (sem vazar outros IDs) |

`LinkedPeer` já existe: `{ companyId, userId, role }`.

Normalização de `peer`: dígitos apenas; `+` e espaços caem fora. Dois writings do mesmo número viram a mesma chave.

---

## StudioRequestContext

O que o painel pode mandar (JSON do Studio). **Não confiável.**

| Campo       | Honrado? | Regras                                                           |
| ----------- | :------: | ---------------------------------------------------------------- |
| `preset`    |   sim    | slug; resolve o peer no servidor                                 |
| `peer`      |   sim    | se `preset` também veio, MUST coincidir; senão resolve só o peer |
| `companyId` | **não**  | ignorado                                                         |
| `userId`    | **não**  | ignorado                                                         |
| `role`      | **não**  | ignorado                                                         |
| outros      | **não**  | ignorados                                                        |

Resolução efetiva:

1. Se `preset` presente e conhecido → peer e LinkedPeer do arquivo.
2. Senão, se `peer` presente → `directory.resolve(peer)`.
3. Senão, ou miss → recusa (relé não chama `core`).

---

## StudioTurn

Um ciclo envio → resposta no painel.

| Campo      | Tipo       | Regras                                          |
| ---------- | ---------- | ----------------------------------------------- |
| requestId  | string     | do Fastify / gerado no relé                     |
| peer       | string     | forjado resolvido                               |
| companyId  | UUID       | do diretório, não do cliente                    |
| text       | string     | 1–4000, mesmo teto de `agentMessageInputSchema` |
| startedAt  | Date       | injetável nos testes                            |
| durationMs | number ≥ 0 | `now - startedAt` após `processMessage`         |
| reply      | AgentReply | contrato já existente da NR-060                 |

`AgentReply` não muda: `kind`, `text`, `confirmationId?`. O relé **acrescenta** `durationMs` no envelope da tool, não no schema HTTP `/agent/messages`.

---

## RelayTool (`process_message`)

| Campo        | Tipo                         | Regras                                   |
| ------------ | ---------------------------- | ---------------------------------------- |
| id           | `'process_message'`          | único no Mastra instance do harness      |
| input        | `{ text: string }`           | mesmo recorte 1–4000                     |
| execute      | → `StudioTurn` resumido      | chama `processMessage`; não chama `core` |
| mutatesValue | n/a (não é tool de catálogo) | confirmação continua dentro do laço      |

O agent Mastra `studio-harness` **não** carrega as tools de negócio (`list_sales`, `create_sale`, …).

---

## IncomingMessage (reuso)

Já definido na NR-060. Caminho Studio:

| Campo     | Valor nesta fatia                          |
| --------- | ------------------------------------------ |
| channel   | `'whatsapp'`                               |
| peer      | número forjado resolvido                   |
| ctx       | ausente (resolverContexto usa o diretório) |
| text      | texto do painel                            |
| requestId | do turno                                   |
| now       | injetado                                   |

Caminho HTTP NR-060 permanece `channel: 'app'` + `ctx` de sessão.

---

## Estado persistido

Nenhuma tabela nova. Consumo das tools continua o mesmo da NR-060 (Company/User de fixture, Sale, etc.).

Confirmação: `InMemoryConfirmations` chaveada por `wa:${companyId}:${peer}` (`chaveDaConversa`). Dois presets = duas chaves. HTTP `app` e Studio `whatsapp` **não** compartilham a pendente — esperado (canais distintos).

---

## Validation rules (resumo)

- Preset file: parse estrito; peer único; fail-closed no adapter.
- Context do Studio: allowlist `preset` \| `peer`.
- Texto: `agentMessageInputSchema` (trim, 1–4000).
- Peer desconhecido: zero execute de catálogo; texto genérico.
- Tenant: `ExecutionContext.companyId` só do diretório; tools de negócio ainda não aceitam `companyId` no input.
