# agent

Runtime do assistente: tools, memória e confirmações.

**Estado:** 🟡 runtime local sem adapter real · [ADR-0010](../../docs/decisoes/adr/0010-mastra-e-gpt-4o-mini.md)
(Mastra + `openai/gpt-4o-mini`) · identidade do canal
[ADR-0012](../../docs/decisoes/adr/0012-identidade-do-canal-whatsapp.md)
(`PeerDirectory` pelo celular do owner) · canal de teste `POST /agent/messages`
com `AGENT_PROVIDER=fake` · harness **Mastra Studio** (eng.) é `NR-121` ·
webhook Meta é `NR-046`
([ADR-0014](../../docs/decisoes/adr/0014-meta-cloud-api.md)) · confirmação
persistente é `NR-061` (tabela `confirmations`) · memória da conversa **entregue**
(NR-062: tabelas `conversations` / `messages` com RLS; janela **12**; idle
**2 h**; retenção **30 d** —
[ADR-0016](../../docs/decisoes/adr/0016-memoria-da-conversa-tabelas-nossas.md))
· RAG auxiliar
[ADR-0017](../../docs/decisoes/adr/0017-rag-com-tools-e-rls.md) (`NR-120`)

## Responsabilidade

Interpretar mensagem em linguagem natural, resolver a intenção para uma chamada
tipada, confirmar quando a ação mexe em valor, e transportar para um caso de uso
de `core`.

**O que não faz — e isto é a regra mais importante do pacote:**

> **O agente nunca calcula.** Total, imposto, tarifa, parcela e margem vêm de
> `domain`, através de `core`. Se um número aparece numa mensagem, ele foi
> calculado por código determinístico e testado.

O LLM interpreta linguagem; nunca decide dinheiro. É isso que impede a classe
inteira de erro em que o número da conversa não bate com o número do relatório.

## Runtime

[Mastra](https://mastra.ai) como biblioteca — `Agent` (`@mastra/core/agent`) +
`createTool` (`@mastra/core/tools`) — **dentro** deste pacote, composto em
`apps/api`. Não é o servidor HTTP do Mastra nem Factory no caminho do lojista.
**Studio** é harness de engenharia ([NR-121](../../docs/processo/task-ledger.md)),
não canal de produção. Contrato:
[`integracoes/mastra.md`](../../docs/arquitetura/integracoes/mastra.md).

Modelo inicial: `openai/gpt-4o-mini`. Trocar de modelo é `AGENT_MODEL`. Trocar
de framework reabre a ADR-0010.

### Como o laço gira

```
mensagem → processMessage
        → LlmPort.decide()          # FakeLlm | Agent.generate(maxSteps: 1)
        → parseToolArgs(contracts)
        → se mutatesValue: confirmação nossa
        → AgentTool.execute → core
```

O `execute` das tools no `Agent` Mastra é identidade (devolve args). O efeito
em `core` só acontece no catálogo (`defineTool` / `catalog.ts`), depois da
confirmação quando a ação mexe em valor. HITL do Mastra (`requireApproval`)
não é usado.

## Fronteiras

|                       |                                       |
| --------------------- | ------------------------------------- |
| **Expõe**             | `processMessage()`, registro de tools |
| **Depende de**        | `core`, `contracts`, `money`          |
| **Proibido importar** | `db`, `domain` diretamente            |
| **Quem depende**      | `apps/api`                            |

Roda **dentro** de `apps/api`, não como serviço separado: precisa do mesmo
contexto de execução, da mesma autenticação e das mesmas portas. Separá-lo
criaria uma segunda composição de dependências — e é assim que os dois canais
começam a divergir. Ver
[`visao-geral.md`](../../docs/arquitetura/visao-geral.md#o-runtime-do-agente-mora-na-api).

## Tools são geradas de `contracts`

```
CreateSaleInput (Zod)  ──→  schema da tool do agente (Mastra createTool)
                       ──→  validação da rota HTTP
```

Uma fonte, dois consumidores. Não existe forma de o agente aceitar um campo que
a API recusa. **Não escreva definição de tool à mão.**

## Confirmação de ação sensível

| Tipo de intenção  | Confirma? | Exemplo                    |
| ----------------- | :-------: | -------------------------- |
| Leitura           |    ❌     | "quanto vendi hoje?"       |
| Cria valor        |    ✅     | lançar venda, lançar conta |
| Altera valor      |    ✅     | mudar preço                |
| Exclui ou estorna |    ✅     | cancelar venda             |
| Envia a terceiro  |    ✅     | enviar cobrança ao cliente |

Confirmação pendente **expira**. Resposta ambígua conta como **não**: o custo de
errar para o lado do "não" é uma pergunta repetida; para o lado do "sim" é um
lançamento financeiro errado. [RF-103](../../docs/produto/requisitos-funcionais.md),
[RF-104](../../docs/produto/requisitos-funcionais.md).

É também controle de **segurança**, não só de usabilidade: quem obtiver acesso
ao aparelho ainda precisa confirmar cada lançamento.

A máquina de estados mora na tabela `confirmations` (NR-061), ligada a um
stub de `conversations` (identidade da loja + canal + interlocutor).
`InMemoryConfirmations` é só teste unitário — a API injeta o store Postgres
em `apps/api/src/composition.ts`. HITL do Mastra (`requireApproval` /
`requireToolApproval` / `approveToolCall`) **não** substitui essa máquina.

HTTP e Studio **não** compartilham pendência: chave `app:{companyId}:{userId}`
≠ `wa:{companyId}:{peer}`.

Histórico de conversa (NR-062, **entregue**) mora em `conversations` /
`messages` com RLS — janela **12**, idle **2 h**, retenção **30 d**
([ADR-0016](../../docs/decisoes/adr/0016-memoria-da-conversa-tabelas-nossas.md)).
O harness/API injeta `createConversationStore` em
`apps/api/src/composition.ts`. `InMemoryConversationStore` é o default dos
testes (e quando a composition não injeta). Sem Memory do Mastra
(`@mastra/memory`).

## Riscos específicos de ter um LLM no caminho

| Risco                                  | Controle                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Injeção de prompt                      | só executa via tool call tipada; texto nunca vira chamada arbitrária                                            |
| Escalada de privilégio                 | chama `core` com o mesmo `ExecutionContext`; papel verificado no caso de uso                                    |
| Ação não intencionada                  | confirmação explícita                                                                                           |
| Vazamento entre conversas              | contexto isolado por empresa ([RF-106](../../docs/produto/requisitos-funcionais.md))                            |
| Dado sensível ao provedor              | envia o mínimo necessário ([RNF-075](../../docs/produto/requisitos-nao-funcionais.md)); OpenAI é subprocessador |
| Alucinação com consequência financeira | o agente não calcula                                                                                            |

## RAG recupera; `core` / `domain` decidem o número

Busca semântica **entra** ([ADR-0017](../../docs/decisoes/adr/0017-rag-com-tools-e-rls.md)):
catálogo, FAQ e, se preciso, trechos de conversa da mesma empresa — sempre em
store com `company_id` + RLS.

"Quanto vendi hoje?" **continua** consulta determinística via `core`, não o
texto do chunk. O RAG sugere candidatos (ex.: qual produto); a tool confirma
o valor. Citar preço ou saldo só do retrieve é bug.

## Custo

Consumo medido por empresa desde o primeiro dia. Teto configurável, com
degradação avisada em vez de conta surpresa —
[RNF-072](../../docs/produto/requisitos-nao-funcionais.md),
[RNF-073](../../docs/produto/requisitos-nao-funcionais.md).
O denominador da mensalidade ainda é [QST-002](../../docs/decisoes/README.md#qst-002).

## Harness local (NR-060)

Canal de engenharia: `POST /agent/messages` com sessão de **fixture**
(criar usuário + empresa de teste, popular dados, autenticar). Não é o
canal de produto do lojista. Opera em não-produção, ou com
`AGENT_HARNESS=1` quando o `NODE_ENV` está próximo de prod (staging).
Produção não serve `AGENT_PROVIDER=fake` e o endpoint permanece desligado
para o lojista até NR-113. O Studio (NR-121) é harness de engenharia, não
canal de produto.

Smoke passo a passo (FakeLlm, sem OpenAI):
[quickstart da feature](../../specs/002-agent-mastra-runtime/quickstart.md).

### Harness Studio (NR-121)

O painel do Mastra Studio conversa com o agent **`studio-harness`**, um relé
que chama o mesmo `processMessage` do POST (`channel: 'whatsapp'`, número
forjado). O generate do Studio **não** chama OpenAI: o modelo do relé só
encaminha o texto; FakeLlm (ou o provedor real) vive só dentro do laço.

Fluxo mínimo:

1. Copiar `packages/agent/studio/presets.example.json` → `presets.json`
   (gitignored) **ou** apontar `AGENT_STUDIO_PRESETS` no `.env` para outro
   arquivo. Preencher `companyId` / `userId` com os UUIDs da fixture.
2. Subir a API em não-produção (`pnpm --filter @na-regua/api dev`,
   `AGENT_PROVIDER=fake`). Sem a API na 3333 o painel relata Failed to fetch.
3. **Outro terminal:** `pnpm studio` — SPA em `http://localhost:3000` contra
   `API_URL` (`http://localhost:3333`), prefixo `/api`. URL da instância no
   painel: `http://localhost:3333`; prefixo `/api`; sem headers.
4. No painel, o único agent listado é `studio-harness`. Na página do agent,
   o botão **Request Context** (ao lado do envio) só aparece porque o agent
   declara `requestContextSchema`. Abrir, escolher `claudia-loja-1` no
   dropdown (ou colar `{ "preset": "claudia-loja-1" }`) e **Save**. Sem isso
   a tool responde `Numero nao vinculado`. O item de menu `/request-context`
   é da plataforma Mastra, não deste Fastify local. Depois: `quanto vendi
hoje?` — centavos/`kind` iguais ao HTTP; `durationMs` no output da tool.

### Smoke SC-003 — tetos RNF-006 (manual, fora da CI)

A CI com FakeLlm só prova que `durationMs` existe e é `number ≥ 0`. Os tetos
de 5 s / 8 s medem-se **no painel**, com provedor real — não rode isto no
GitHub Actions nem em job que chame OpenAI.

```bash
AGENT_PROVIDER=mastra OPENAI_API_KEY=… AGENT_MODEL=openai/gpt-4o-mini
```

1. Subir a API em não-produção e `pnpm studio`. Preset de fixture (número
   forjado; nunca celular de lojista real).
2. Consulta típica: `quanto vendi hoje?` — no output da tool, `durationMs`
   ≤ **5000**.
3. Ação com confirmação: cadastro ou venda → proposta → `sim`. O `durationMs`
   **do turno do `sim`** ≤ **8000**.
4. Se estourar, o valor continua visível no mesmo campo (não se perde no
   silêncio). Log estruturado `agent.studio.turn` (`companyId`, `peer`
   mascarado, `durationMs`, `kind`, `requestId`) — sem PII em claro
   ([RNF-034](../../docs/produto/requisitos-nao-funcionais.md)).

O generate do Studio **ainda** não chama o modelo: só o laço interno
(`processMessage`) usa `gpt-4o-mini`.

### Fora desta fatia (NR-121)

Confirmação persistente é [NR-061](../../docs/processo/task-ledger.md): tabela
`confirmations`, stub em `conversations`. A chave do Studio continua
`wa:${companyId}:${peer}`; o HTTP de teste usa `app:${companyId}:${userId}`.
**Não** cruzar `sim` de um harness com a proposta do outro. `InMemoryConfirmations`
fica no teste do agent. Histórico multi-turno é NR-062 (`conversations` /
`messages`). Não ligar Memory / Storage Mastra, RAG (NR-120 / ADR-0017) nem
webhook Meta (NR-046). Celular real do owner é NR-113.

### Dívida: relatório por arquivo/link (RF-109)

`period_summary` cobre [RF-108](../../docs/produto/requisitos-funcionais.md)
(faturamento, custo, despesas e resultado via `buildDre`). Se o detalhe
estourar o teto de uma mensagem (4096 caracteres, o mesmo do
`MessageSender`), a resposta é **só o texto truncado**. Arquivo ou link
para o restante — [RF-109](../../docs/produto/requisitos-funcionais.md) —
fica dívida explícita desta fatia e **não** entra no aceite da NR-060.

```bash
pnpm --filter @na-regua/agent test -- src/catalog.test.ts src/process-message.test.ts
pnpm --filter @na-regua/api exec vitest run src/routes/agent.test.ts src/composition.test.ts
```

Consultas somente-leitura NR-115 (`check_stock`, `list_payables`,
`check_customer_wallet`): `mutatesValue: false`, sem confirmação, sem escrita.
Gates completos:
[`specs/006-consultar-estoque-pagar-fiado/quickstart.md`](../../specs/006-consultar-estoque-pagar-fiado/quickstart.md).

## Foto do código de barras (NR-116)

`POST /agent/messages` aceita **texto e/ou imagem** (`agentMessageInputSchema`:
pelo menos um dos dois). A API converte `image.dataBase64` em bytes e chama o
mesmo `processMessage` — `companyId` nunca vem no body.

Com `image` presente, o laço **decodifica antes do LLM** (`BarcodeDecoder` +
`findProductByBarcode`); **não** usa visão do modelo. Sem imagem, o fluxo
permanece `LlmPort.decide()` → tool.

```
mensagem (+ image?) → processMessage
        → [se image] decode → lookup (sem LLM)
        → senão LlmPort.decide() → tool
        → confirmação quando mutatesValue
        → AgentTool.execute → core
```

Na CI e com `AGENT_PROVIDER=fake`, só entra `FakeBarcodeDecoder` (mapa de
fixture → 0, 1 ou N códigos). **Não** há ZXing real no pipeline de teste.

| Situação                                                    | Rota                                                                    | Confirma? |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- | :-------: |
| Foto legível + produto, sem pagamento                       | `clarify` (pergunta forma de pagamento); rascunho de venda por um turno |    ❌     |
| Pagamento inequívoco na mesma mensagem ou no turno seguinte | `create_sale` (qty 1, `unitPriceCents` = `salePriceCents` do produto)   |    ✅     |
| Próxima mensagem **não** é pagamento                        | descarta o item; segue o laço normal                                    |    ❌     |
| Ilegível / MIME inválido / 0 códigos                        | `answer` recusa; pede venda ou cadastro **por texto**                   |    ❌     |
| 2+ códigos na foto                                          | `answer` “um produto por vez”                                           |    ❌     |
| Código sem produto, sem pedido de cadastro                  | `answer` recusa; sem item avulso                                        |    ❌     |
| Foto + cadastro explícito (`cadastr…`)                      | `answer` com o código lido; **não** é venda (NR-117)                    |    ❌     |

A imagem **nunca** é persistida: histórico e memória gravam o placeholder
`[foto do codigo]` (com o código quando lido). Bytes e `dataBase64` não entram
em `messages.body` nem em logs estruturados.

Preço e total da venda por foto continuam vindos do catálogo/`core` — o agente
**nunca calcula** margem, parcela ou desconto.

Gates:
[`specs/007-foto-codigo-barras/quickstart.md`](../../specs/007-foto-codigo-barras/quickstart.md).

O quickstart pede API + Postgres + sessão de fixture. Sem servidor local, cada
linha do DoD está coberta pelos testes FakeLlm acima (sem OpenAI):

| #   | Mensagem                           | Teste                                                                                                    |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | `quanto vendi hoje?`               | `process-message.test.ts` (totais = `listSales`); `apps/api/src/routes/agent.test.ts` (POST autenticado) |
| 2   | `quem está me devendo?`            | `process-message.test.ts` (totais = `listReceivables`)                                                   |
| 3   | `quanto tem de camiseta?`          | `process-message.test.ts` + `catalog.test.ts` + `apps/api/src/routes/agent.test.ts` (NR-115)             |
| 3b  | `o que vence essa semana?`         | `process-message.test.ts` + `catalog.test.ts` + rota (NR-115 `list_payables`)                            |
| 3c  | `quanto o joão deve?`              | `process-message.test.ts` + `catalog.test.ts` + rota (NR-115 `check_customer_wallet`)                    |
| 4   | cadastrar cliente                  | `process-message.test.ts` (`create_customer` → confirmação → sim; duplicata; “talvez”)                   |
| 5   | venda scriptada                    | `process-message.test.ts` (`create_sale` → sim; líquido = core)                                          |
| 6   | produto ambíguo                    | `process-message.test.ts` (`search_products` → `clarify`)                                                |
| 7   | cobrança                           | `process-message.test.ts` (`send_charge` → sim / sem dívida)                                             |
| 8   | `resumo do mês`                    | `process-message.test.ts` + `format.test.ts` (quatro eixos DRE; truncamento; sem arquivo/link)           |
| 9   | certificado / OFX / “emite a nota” | `process-message.test.ts` (`refuse_*`; zero efeito)                                                      |
| 10  | mutação sem `sim` / TTL            | `process-message.test.ts` (não grava; expiração)                                                         |

## Fumaça opcional — Mastra real (SC-006, fora da CI)

Com chave e `AGENT_PROVIDER=mastra` (mesmo contrato de `POST /agent/messages`):

```bash
AGENT_PROVIDER=mastra OPENAI_API_KEY=… AGENT_MODEL=openai/gpt-4o-mini
```

1. Subir a API em não-produção (ou `AGENT_HARNESS=1` em staging). Produção
   não serve `fake` e o endpoint permanece desligado para o lojista.
2. Autenticar como fixture.
3. Repetir **uma consulta** (`quanto vendi hoje?`) e **uma venda**
   (proposta → `sim`). Só a origem da intenção muda (`Agent.generate`);
   tools → `core` é o mesmo laço do FakeLlm.

Não rode isto na CI. Sem chave, o runtime permanece em `fake`. Não subir
Studio (NR-121) nem webhook Meta (NR-046) nesta fumaça.

## Variáveis de ambiente

Cópia para `.env`: [`.env.example`](../../.env.example) na raiz. Matriz
completa: [`ambientes.md`](../../docs/engenharia/ambientes.md).

| Variável                     | Local                                | Função                                                                                       |
| ---------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `AGENT_PROVIDER`             | `fake` \| `mastra`                   | Porta LLM (`FakeLlm` ou Mastra). Default `fake`; em produção só `mastra` é servido.          |
| `AGENT_MODEL`                | `openai/gpt-4o-mini`                 | Formato Mastra `provedor/modelo`. Só entra com `mastra`.                                     |
| `AGENT_HARNESS`              | ausente \| `1`                       | Porteiro (FR-001b): `1` libera HTTP **e** Studio fora do `development`. Default off em prod. |
| `AGENT_STUDIO_PRESETS`       | `packages/agent/studio/presets.json` | Path do JSON de presets (NR-121). Ausente/vazio = esse default.                              |
| `AGENT_MONTHLY_BUDGET_CENTS` | vazio = sem teto                     | Teto de IA por empresa/mês ([RNF-073](../../docs/produto/requisitos-nao-funcionais.md)).     |
| `OPENAI_API_KEY`             | vazia                                | Obrigatória só com `AGENT_PROVIDER=mastra`.                                                  |
