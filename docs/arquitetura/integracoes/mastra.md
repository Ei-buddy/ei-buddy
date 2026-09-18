# Mastra + OpenAI — o runtime do assistente

O lojista manda uma mensagem. O Mastra interpreta a intenção e escolhe uma
_tool_. A tool chama um caso de uso de `core`. `domain` calcula. O lojista
recebe um número que é o mesmo do relatório.

Este texto diz **o que o Mastra faz aqui**, **como o laço gira** e **o que ele
está proibido de fazer**. Não substitui a
[documentação do Mastra](https://mastra.ai/docs). Versão de referência no
código: `@mastra/core` ^1.66.

Decisão: [ADR-0010](../../decisoes/adr/0010-mastra-e-gpt-4o-mini.md)
([DEC-007](../../decisoes/README.md#dec-007)). Origem das regras de negócio:
[RF-096 a RF-109](../../produto/requisitos-funcionais.md), README de
[`packages/agent`](../../../packages/agent/README.md).

---

## Em uma frase

**O Mastra é biblioteca dentro de `packages/agent`, não é um serviço.** Usamos
**Agent** + **tools** (`createTool`), chamados por `processMessage()`. O
modelo inicial é `openai/gpt-4o-mini`. **RAG entra** como recuperação auxiliar
([ADR-0017](../../decisoes/adr/0017-rag-com-tools-e-rls.md)): achar candidatos
e trechos; **totais e efeitos em dinheiro** continuam só via tool → `core` →
`domain`. **Memory** e **Workflow** do Mastra **não** entram. **Studio** e um
servidor Mastra de **desenvolvimento** entram só como harness de engenharia
([NR-121](../../processo/task-ledger.md)): substituto do WhatsApp no teste,
sempre atrás do mesmo `processMessage` — **não** como canal do lojista.

```mermaid
flowchart LR
  L["Lojista"] -->|"mensagem"| API["apps/api"]
  API --> PM["processMessage"]
  PM -->|"decide"| AG["Agent.generate<br/>maxSteps: 1"]
  AG -->|"prompt mínimo + tools"| OAI["OpenAI<br/>gpt-4o-mini"]
  OAI -->|"tool call"| AG
  AG -->|"args validados"| PM
  PM -->|"se mutatesValue"| CONF["confirmação<br/>nossa"]
  CONF -->|"sim"| C["core"]
  PM -->|"leitura"| C
  C --> D["domain calcula"]
  C --> DB[("Postgres + RLS")]
  PM -->|"resposta"| L
```

## Laço de execução (o que o código faz)

O dono do fluxo **não** é o Mastra. É `processMessage` em `packages/agent`:

1. Resolve `ExecutionContext` (app: sessão; WhatsApp: `PeerDirectory` pelo
   celular do owner — [ADR-0012](../../decisoes/adr/0012-identidade-do-canal-whatsapp.md)).
2. Se há confirmação aberta, trata sim/não/ambiguidade/expiração
   ([RF-103](../../produto/requisitos-funcionais.md),
   [RF-104](../../produto/requisitos-funcionais.md)) — **máquina nossa**, não
   `requireApproval` do Mastra.
3. Chama `LlmPort.decide()` — implementação real: `Agent` + `agent.generate(text, { maxSteps: 1 })`.
4. Valida os args com o mesmo schema Zod de `contracts`.
5. Se a tool `mutatesValue`, grava proposta e pede confirmação; só no "sim"
   executa.
6. Execução real chama o caso de uso de `core` via catálogo em `catalog.ts`.

Detalhe deliberado: nas tools registradas no `Agent` do Mastra, `execute`
**só devolve os argumentos**. Quem grava valor é o catálogo nosso, depois da
confirmação. Assim o `generate` não tem efeito colateral financeiro mesmo se o
modelo disparar a tool.

```
contracts (Zod)  ──→  createTool (Mastra)     → só escolhe intenção + args
                 ──→  defineTool (catálogo)   → executa core após confirmação
                 ──→  rota HTTP               → mesmo schema
```

Porta `LlmPort`: `AGENT_PROVIDER=fake` (local, default) ou `mastra` (OpenAI).
Sem chave, sobe no falso. FakeLlm reconhece consultas, recusas e “resumo do
mês”; mutações (cadastro, venda, cobrança) entram por `script()` nos testes.

## Catálogo mínimo (NR-060)

Tools em [`packages/agent/src/catalog.ts`](../../../packages/agent/src/catalog.ts).
Input = schema de `contracts`. Nas tools do `Agent` Mastra, `execute` continua
**identidade** — efeito só no catálogo, depois da confirmação quando mexe em
valor.

**Leituras**

| Tool               | Caso de uso           | Notas                                                                                                  |
| ------------------ | --------------------- | ------------------------------------------------------------------------------------------------------ |
| `list_sales`       | `listSales`           | “quanto vendi hoje?”                                                                                   |
| `list_receivables` | `listReceivables`     | “quem está me devendo?”                                                                                |
| `search_products`  | `searchProducts`      | desambiguação (RF-102)                                                                                 |
| `period_summary`   | `buildDre`            | RF-108: faturamento, custo, despesas, resultado; texto truncado (4096). RF-109 (arquivo/link) é dívida |
| `revenue_by_month` | `buildRevenueByMonth` | opcional; **não** é o caminho de “resumo do mês”                                                       |

**Mutações / envio** (`mutatesValue`; confirmação nossa antes de executar)

| Tool              | Caso de uso          | Notas                                                             |
| ----------------- | -------------------- | ----------------------------------------------------------------- |
| `create_customer` | `registerCustomer`   | duplicata pelo `core`                                             |
| `create_sale`     | `registerSale`       | centavos do app; NFC-e só como efeito da venda                    |
| `send_charge`     | `sendCustomerCharge` | `MessageSender` falso no harness; sem dívida, informa e não envia |

**Recusas** (input vazio, `execute` sem efeito, texto aponta o app)

| Tool                     | RF     | Recusa                             |
| ------------------------ | ------ | ---------------------------------- |
| `refuse_certificate`     | RF-149 | certificado A1, senha, emitente    |
| `refuse_banking`         | RF-150 | OFX/CSV, Open Finance, conciliação |
| `refuse_invoice_command` | RF-151 | emitir/cancelar nota avulsa        |

Estoque / contas a pagar / saldo de carteira **não** têm tool nesta fatia
(NR-115): a resposta é RF-097 — só as capacidades atuais, sem roadmap.

## Harness (NR-060)

`POST /agent/messages` é canal de **desenvolvedor**, não produto do lojista.
A sessão é de **fixture** (criar usuário/empresa de teste, popular dados,
autenticar); `companyId` nunca vem no body. Serve em não-produção; em staging,
`AGENT_HARNESS=1`. Produção: `POST /agent/messages` desligado até NR-113;
o Studio (NR-121) é só harness de engenharia e **não** monta o adapter.
`AGENT_PROVIDER=fake` é barrado mesmo com a flag. Teto de IA:
`AGENT_MONTHLY_BUDGET_CENTS` (degradação avisada; não executa tool que muta
valor). Smoke FakeLlm:
[quickstart](../../../specs/002-agent-mastra-runtime/quickstart.md).
Studio: [quickstart NR-121](../../../specs/003-studio-harness/quickstart.md).

## Primitivos Mastra: o que entra e o que não

| Entra no produto                                                                                              | Não entra — e por quê                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Agent` de `@mastra/core/agent`                                                                               | Rotas `/api/agents` do Mastra como **canal do lojista** (segunda composição de deps)                                                                                    |
| `createTool` de `@mastra/core/tools` com `inputSchema` de `contracts`                                         | Tool escrita à mão, paralela à rota HTTP                                                                                                                                |
| `agent.generate(..., { maxSteps: 1 })` atrás de `processMessage()`                                            | Studio / `mastra dev` como **runtime de produção** do lojista                                                                                                           |
| Harness Studio de eng. ([NR-121](../../processo/task-ledger.md)) → mesmo `processMessage`                     | Studio que desvie do laço (confirmação/memória/`core` paralelos)                                                                                                        |
| Modelo `openai/gpt-4o-mini` via `AGENT_MODEL` (`provedor/modelo`)                                             | Usar chunk do RAG como saldo, faturamento ou estoque (RF-101)                                                                                                           |
| RAG sobre store **nosso** com `company_id` + RLS ([ADR-0017](../../decisoes/adr/0017-rag-com-tools-e-rls.md)) | Índice vetorial sem tenant; Memory/Storage padrão do Mastra em `public`                                                                                                 |
| `AGENT_PROVIDER=fake` no local                                                                                | Chave da OpenAI obrigatória para `pnpm dev`                                                                                                                             |
| Confirmação na tabela/store `confirmations` (hoje in-memory, NR-061)                                          | HITL do Mastra (`requireApproval` / `approveToolCall`) — não isola por empresa nem expira como RF-103 pede                                                              |
| —                                                                                                             | **Workflow** Mastra — canal e confirmação não são pipeline do framework ([ADR-0012](../../decisoes/adr/0012-identidade-do-canal-whatsapp.md))                           |
| —                                                                                                             | **Memory / Storage** do Mastra em `public` — fechado na [ADR-0016](../../decisoes/adr/0016-memoria-da-conversa-tabelas-nossas.md): histórico de turnos é tabelas nossas |
| —                                                                                                             | **Channels** / `@chat-adapter/whatsapp` / `MastraAuthBetterAuth`                                                                                                        |
| —                                                                                                             | **Mastra Factory** — plano operacional de projetos de agente; fora do caminho do lojista (ver abaixo)                                                                   |

Agent vs Workflow (conceitos do framework): o assistente do lojista é tarefa
aberta (interpretar português → escolher tool) → **Agent**. Sequências fixas
(emitir nota, cobrar, lembrete) ficam em `apps/worker` + `core`, não em
Workflow Mastra.

## Fronteira com o resto do sistema

O runtime mora em `apps/api` — ver
[visão geral](../visao-geral.md#o-runtime-do-agente-mora-na-api). Motivo: o
mesmo `ExecutionContext`, a mesma autenticação, as mesmas portas. Um servidor
Mastra ao lado criaria uma segunda composição, e os dois canais (app e
WhatsApp) começariam a divergir.

`packages/agent` importa `core`, `contracts` e `money`. **Não** importa `db`
nem `domain`. O Mastra não fura essa matriz.

O agente **nunca calcula**. Se alguém ligar uma tool de calculadora, ou deixar
o modelo "somar os itens", isso viola [RF-101](../../produto/requisitos-funcionais.md)
e a linha mais importante de [`seguranca.md`](../seguranca.md#segurança-do-assistente).

Isolamento cruzado é `ExecutionContext` + tools sem id de terceiro + RLS — não
processor Mastra.

## Modelo

| Variável                     | Valor inicial                        | Notas                                                                    |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| `AGENT_PROVIDER`             | `fake` no local, `mastra` com chave  | Sem chave, o sistema sobe no falso; prod não serve `fake`                |
| `AGENT_MODEL`                | `openai/gpt-4o-mini`                 | Formato Mastra `provedor/modelo`                                         |
| `AGENT_HARNESS`              | ausente                              | `1` libera HTTP + Studio fora do `development` (staging). Mesmo porteiro |
| `AGENT_STUDIO_PRESETS`       | `packages/agent/studio/presets.json` | Path do JSON de presets (NR-121). Ausente/vazio = esse default           |
| `AGENT_MONTHLY_BUDGET_CENTS` | vazio = sem teto                     | Teto de IA por empresa/mês (RNF-073)                                     |
| `OPENAI_API_KEY`             | vazia no local                       | Obrigatória só com `AGENT_PROVIDER=mastra`                               |

Trocar o modelo (tamanho ou provedor que o Mastra roteie) é configuração. Trocar
o framework reabre a [ADR-0010](../../decisoes/adr/0010-mastra-e-gpt-4o-mini.md).

## Memória

[NR-062](../../processo/task-ledger.md) **feita**. Fechada na
[ADR-0016](../../decisoes/adr/0016-memoria-da-conversa-tabelas-nossas.md)
([DEC-011](../../decisoes/README.md#dec-011)):

| Regra              | Valor                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Onde               | `conversations` / `messages` / `confirmations` com `company_id` + RLS                    |
| Mastra Memory      | **desligado** (sem `@mastra/memory`; sem Storage padrão em `public`)                     |
| Identidade SQL     | coluna `number_from` — o “peer” da prosa é o interlocutor WhatsApp, não o nome da coluna |
| Chave              | `wa:{companyId}:{peer}` (Studio) e `app:{companyId}:{userId}` (HTTP) — chaves distintas  |
| Prompt             | no máximo **12** mensagens da conversa ativa                                             |
| Idle (RF-106)      | **2 h** sem mensagem → não aplicar anáfora antiga a ação nova                            |
| Retenção (RNF-035) | corpos de mensagem **30 dias**, depois expurgo verificável                               |
| Aprendizado        | só contexto por empresa — **sem** treino de modelo                                       |

Confirmação sensível continua máquina nossa (NR-061). O precedente de schema
isolado do Better Auth (`identidade`) **não** se aplica aqui: as tabelas do
assistente já nascem no domínio com RLS.

## RAG

Fechado na [ADR-0017](../../decisoes/adr/0017-rag-com-tools-e-rls.md)
(revisa o ponto 3 da [ADR-0010](../../decisoes/adr/0010-mastra-e-gpt-4o-mini.md)):

| Regra            | Valor                                                                  |
| ---------------- | ---------------------------------------------------------------------- |
| Papel            | Recuperar candidatos / trechos (catálogo, FAQ, opcionalmente chat)     |
| Verdade de valor | Só tool → `core` → `domain` — chunk **não** vira saldo nem total       |
| Store            | Nosso, com `company_id` + RLS; API de RAG do Mastra só se apontar nele |
| Prompt           | top‑k do tenant atual, teto de tokens (RNF-075)                        |
| Fora             | Memory Mastra como índice; RAG cross-tenant; preço “lido” do chunk     |

Implementação: [NR-120](../../processo/task-ledger.md).

## Mastra Factory — fora do caminho do produto

[Mastra Factory](https://mastra.ai) é o plano de controle operacional de
**projetos de agente** no ecossistema Mastra (`mastra api factory`: projects,
work items, stages, decisions, attention, supervisor). Serve para filas de
trabalho de desenvolvimento/automação de agentes — Intake → Triage → Planning →
execução com sessões duráveis, aprovações e métricas.

**No Na Régua isso não é runtime do lojista.** Conversas do assistente não
viram work item Factory; confirmação de venda não é `decision approve` do
Factory; o webhook WhatsApp não passa por `/web/*`.

O que existe no repositório:

| Peça                               | Papel                                                              |
| ---------------------------------- | ------------------------------------------------------------------ |
| `@mastra/core` em `packages/agent` | Biblioteca de Agent/tools no produto                               |
| `.agents/skills/mastra`            | Skill para agentes de código seguirem a API atual do framework     |
| `.agents/skills/mastra-factory`    | Skill para supervisionar Factory **quando** houver projeto Factory |

Se no futuro a equipe usar Factory para construir ou operar um agente na
plataforma Mastra, isso é processo de engenharia — não muda a composição em
`apps/api` nem a ADR-0010.

## Dado que viaja para a OpenAI

[RNF-075](../../produto/requisitos-nao-funcionais.md): o contexto enviado é o
mínimo necessário. Na prática:

- a tool devolve o resultado já calculado por `core` / `domain`;
- o RAG manda só top‑k chunks do tenant (não extrato, não XML, não lista
  inteira de clientes);
- consumo medido por empresa desde o primeiro dia
  ([RNF-073](../../produto/requisitos-nao-funcionais.md)), inclusive embedding.

A OpenAI é subprocessador. Declarar isso na política é a [DEC-016](../../decisoes/README.md#dec-016).

## Canal e harness Studio

O provedor WhatsApp é a Cloud API
([ADR-0014](../../decisoes/adr/0014-meta-cloud-api.md)).
A identidade do canal fechou na [ADR-0012](../../decisoes/adr/0012-identidade-do-canal-whatsapp.md):
não há Workflow Mastra, Channel adapter nem auth Mastra no webhook. Sem o
adapter real o runtime se exercita pelo `POST /agent/messages` (sessão de
fixture, `AGENT_PROVIDER=fake`, porteiro FR-001b) e pelo **Mastra Studio**
([NR-121](../../processo/task-ledger.md)) como substituto do Zap em
engenharia. O webhook Meta (NR-046), depois do E11 + RAG + PeerDirectory
(NR-113), entra atrás da mesma `processMessage`.

### Studio = relé → `processMessage`

O adapter [`@mastra/fastify`](https://mastra.ai/reference/server/fastify-adapter.md)
monta no **mesmo** Fastify de `apps/api`, prefixo `/api`, **só** quando o
porteiro libera (`motivoDoAgenteIndisponivel() === undefined`) **e** o
arquivo de presets carregou. Produção e lojista: adapter **não** monta
(`/api/agents` = 404).

A instância Mastra do harness registra **um** agent, `studio-harness`. A
única tool é `process_message`. O `execute` chama `processMessage` com
`channel: 'whatsapp'` e o peer forjado resolvido no servidor. O generate do
Studio **não** chama OpenAI: o model do relé só encaminha o texto. FakeLlm
(ou `gpt-4o-mini`) vive **só** dentro do laço.

**Não há `/api/agents` de negócio.** O `erp-agent` (tools de catálogo com
`execute` identidade) continua atrás de `LlmPort.decide()` — não aparece na
lista do Studio. Registrar tools de venda/cadastro no adapter furaria a
confirmação e o `core`.

```
Studio chat → POST /api/agents/studio-harness/generate
           → relé (tool process_message)
           → processMessage({ channel: 'whatsapp', peer })
           → LlmPort → catálogo → core
```

Envelope da tool (visível no painel): `{ kind, text, durationMs, confirmationId? }`.
`durationMs` é envio → `processMessage` retornou (RNF-006). Log estruturado
`agent.studio.turn` (`companyId`, peer mascarado, `durationMs`, `kind`,
`requestId`) — sem PII em claro (RNF-034).

### Presets (número forjado)

Arquivo JSON (`AGENT_STUDIO_PRESETS`, default
`packages/agent/studio/presets.json`). Exemplo versionado:
`packages/agent/studio/presets.example.json`. Cada preset amarra `id` +
peer E.164 forjado + `companyId` / `userId` / `role: 'owner'` da fixture.
`companyId` no request context do cliente é **ignorado**. Peer duplicado
recusa o load (adapter não monta; API segue). Contrato:
[studio-harness.md](../../../specs/003-studio-harness/contracts/studio-harness.md),
[presets.md](../../../specs/003-studio-harness/contracts/presets.md).

`POST /agent/messages` permanece estrito (`text` só, `channel: 'app'`).
Studio não altera esse schema.
