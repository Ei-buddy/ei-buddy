# Research: Harness Studio de engenharia (NR-121)

**Date**: 2026-09-17  
**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Ambiguidades de produto já fecharam na spec. Aqui fecham escolhas técnicas, conferidas na documentação atual do Mastra (Studio, request context, Fastify adapter, traces) e no código da NR-060.

---

## 1. Onde o Studio vive

**Decision**: Montar o servidor Mastra **no mesmo Fastify de `apps/api`**, via [`@mastra/fastify`](https://mastra.ai/reference/server/fastify-adapter.md), **só quando o harness está ligado** (`motivoDoAgenteIndisponivel() === undefined`). A UI do Studio (`mastra studio`) conecta nessa API (`API_URL`, prefixo `/api`). Não há processo `mastra dev` separado nem porta 4111 como runtime.

**Rationale**:

- A [visão geral](../../docs/arquitetura/visao-geral.md#o-runtime-do-agente-mora-na-api) e o princípio I exigem **uma** composição: o mesmo `AgentRuntime` de `buildAgentDeps()`, as mesmas portas de `core`, o mesmo store de confirmação.
- A ADR-0010 **proíbe** o servidor Mastra como plataforma do lojista; a revisão **permite** Studio + servidor de **desenvolvimento**. Adapter no Fastify já existente, atrás do porteiro da NR-060, é isso — não um segundo deploy.
- Dois processos (`mastra dev` + API) duplicariam `InMemoryConfirmations`, `AiUsageCounter` e o wiring de `core`. É exatamente a “segunda composição” que a arquitetura existe para impedir.

**Alternatives considered**:

- `mastra dev` na porta 4111 importando o runtime — rejeitado (segunda composição; confirmação volátil não atravessa processo).
- SPA própria no `web` — rejeitado (a tarefa é o Studio do framework; presets e traces já existem lá).
- Studio Cloud / `mastra build --studio` em produção — rejeitado (FR-009, ADR-0010).

---

## 2. Agente-relé, não o Agent de negócio

**Decision**: A instância `Mastra` registrada no adapter expõe **um** agent (`studio-harness`). A única tool é `process_message`. O `execute` dela chama `processMessage` do pacote `agent` com `channel: 'whatsapp'` e `peer` resolvido no servidor. O Agent interno de `createMastraLlm` (`erp-agent`, tools com `execute` identidade) **não** é registrado no servidor — continua só atrás de `LlmPort.decide()` dentro do laço.

**Rationale**: Se o Studio chamar `POST /api/agents/erp-agent/generate`, o modelo dispara as tools de negócio (identidade) e responde **sem** confirmação nem catálogo. Isso é o caminho paralelo que a spec e o [contrato Mastra](../../docs/arquitetura/integracoes/mastra.md) proíbem. Relé = Studio conversa; interpretação, confirmação e `core` ficam em `processMessage`.

**Alternatives considered**:

- Registrar `erp-agent` e “pedir para o modelo não executar” — rejeitado (Studio sempre chama `generate`; `maxSteps` não restaura a máquina de confirmação).
- HITL `requireApproval` do Mastra — rejeitado (ADR-0010: confirmação é nossa; NR-061).
- Custom route só, sem agent no Studio — rejeitado (o painel de chat do Studio fala com agents).

---

## 3. Zero hop extra de LLM (FakeLlm e RNF-006)

**Decision**: O model do agent `studio-harness` é um **relé determinístico**: sempre emite uma tool call `process_message` com o texto do usuário. Não chama OpenAI. O LLM de verdade (FakeLlm ou `gpt-4o-mini`) continua **somente** em `processMessage`. Assim o painel funciona com `AGENT_PROVIDER=fake` (FR-010) e a duração do turno ≈ duração do laço (RNF-006), sem um segundo `generate`.

**Rationale**: Um `gpt-4o-mini` só para “decidir” chamar o relé somaria latência ao teto de 5 s e quebraria o DoD sem chave. Documentação atual do Studio: o chat bate em `/api/agents/:id/generate`. O generate precisa de um model; o model pode ser um adapter local (LanguageModel do AI SDK / implementação mínima no pacote `agent`), não uma string `openai/…`.

**Risco de implementação**: a API de model custom do `@mastra/core` ^1.66 muda. Se o adapter de model for hostil, o fallback é interceptar o generate do `studio-harness` (wrapper na tool + `Agent.generate` nosso) **desde que** o contrato HTTP que o Studio usa continue devolvendo a resposta do relé — nunca cair no `erp-agent`. Verificar embedded docs na implementação; não adivinhar a assinatura.

**Alternatives considered**:

- Chat do Studio só com `AGENT_PROVIDER=mastra` — rejeitado (FR-010).
- Tool playground em vez de chat — aceitável como extra, insuficiente como único caminho (US-1 é conversar).

---

## 4. Preset e número forjado

**Decision**:

1. Arquivo JSON de presets (caminho `AGENT_STUDIO_PRESETS`, default `packages/agent/studio/presets.json`). Exemplo versionado: `presets.example.json`. IDs reais de fixture **não** entram no git.
2. Cada preset: `id`, `peer` (E.164 forjado), `companyId`, `userId`, `role` (`owner`).
3. `FixturePeerDirectory` implementa `PeerDirectory`: `resolve(peer)` → `LinkedPeer | null`. `createAgentRuntime({ peers })` passa a receber isso em `buildAgentDeps`.
4. Request context do Studio honra só `preset` (nome) e/ou `peer`. **`companyId` / `userId` / `role` no context do cliente são ignorados** (FR-003).
5. Peer duplicado em dois presets → falha ao **carregar** o diretório (não sobe o adapter; API segue; log claro). Peer desconhecido → `processMessage` devolve `ignored`; o relé traduz para texto genérico sem vazar outra empresa.

**Rationale**: `processMessage` já resolve WhatsApp por `PeerDirectory` (teste RF-095). NR-113 fará o diretório real; esta fatia é o mapa de fixture. Request context do Mastra é JSON que o browser manda — tratar como input não confiável, igual body HTTP.

**Alternatives considered**:

- `companyId` no request context “porque é engenharia” — rejeitado (mesmo furo que a spec fecha; CI de isolamento).
- Variáveis soltas `STUDIO_PEER` + `STUDIO_COMPANY_ID` (um preset só) — insuficiente (FR-006 pede dois presets).
- Lookup no banco por slug — adiado (fixture já cria UUIDs; o arquivo é o contrato do desenvolvedor).

---

## 5. Observabilidade do turno (RNF-006)

**Decision**: O `execute` do relé mede `durationMs` (envio → `processMessage` retornou) e devolve `{ kind, text, confirmationId?, durationMs }` no resultado da tool. Log estruturado na API (`agent.studio.turn`, `companyId`, `peer` mascarado, `durationMs`, `kind`). Sem `@mastra/observability` + DuckDB/LibSQL, sem Mastra Cloud, sem tabela em `public`.

SC-003 (5 s / 8 s com provedor real) é **smoke manual**, no mesmo espírito do SC-006 da NR-060: CI não chama OpenAI. CI prova que `durationMs` existe e que o relé chama o laço.

**Rationale**: Spec SC-006 pede “uma inspeção no próprio harness”. O painel do Studio mostra o output da tool. Métricas OLAP exigem store que a spec tirou de escopo. Traces Mastra completos são bônus se o adapter já emitir span do generate; não são DoD.

**Alternatives considered**:

- `@mastra/observability` + DuckDB local — rejeitado nesta fatia (deps novas, OLAP, fora do recorte).
- Só log, sem `durationMs` na resposta — rejeitado (SC-006: inspeção no harness, não no terminal).

---

## 6. Porteiro

**Decision**: Reusar `motivoDoAgenteIndisponivel()`. Se houver motivo, **não** chamar `MastraServer.init()` — rotas `/api/agents/*` simplesmente não existem (404), além do `POST /agent/messages` já em 503. Produção: `fake` continua barrado; `mastra` sem `AGENT_HARNESS=1` continua barrado. Lojista em produção não alcança Studio porque o adapter não monta.

Local: Studio sem auth Mastra (default do framework). Aceitável — localhost, fixture, não é produto. Auth EE / RBAC do Studio **não** entram.

**Rationale**: FR-009. Não inventar segundo flag. `AGENT_HARNESS` já existe em `packages/env`.

**Alternatives considered**:

- Header secreto no Studio — adiado (localhost + porteiro de ambiente bastam).
- SimpleAuth Mastra — complexidade sem requisito.

---

## 7. Contrato HTTP da NR-060

**Decision**: `POST /agent/messages` permanece estrito (`text` só, sessão fixture, `channel: 'app'`). Studio **não** altera esse schema. O caminho de número forjado é só o relé (`channel: 'whatsapp'`).

**Rationale**: FR-013. Misturar `peer` no body do POST reabre o contrato que a NR-060 fechou.

---

## 8. Dependências e scripts

**Decision**:

| Peça | Onde |
| ---- | ---- |
| `@mastra/fastify` | `apps/api` (adapter) |
| `mastra` (CLI, Studio SPA) | devDependency de `apps/api` ou do root — script `pnpm studio` |
| Relé, presets, `FixturePeerDirectory`, timer | `packages/agent` (testável sem Fastify) |

Não adicionar `@mastra/memory`, `@mastra/rag`, `@mastra/observability`, `@mastra/pg` nesta fatia.

**Rationale**: Hexágono: `agent` não importa `db` nem o adapter HTTP. API monta. CLI do Studio é ferramenta de engenharia, não runtime de prod.

---

## 9. Docs e ledger no mesmo PR

**Decision**: Atualizar `packages/agent/README.md`, `docs/arquitetura/integracoes/mastra.md`, `docs/engenharia/ambientes.md`, `.env.example`, contrato 002 (tirar “Rotas Studio” de fora de escopo), ledger NR-121 → ✅. `AGENT_STUDIO_PRESETS` e o script `studio` entram na matriz de ambiente.

**Rationale**: DoD da constitution; harness muda o contrato do módulo.
