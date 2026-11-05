# agent

Runtime do assistente: tools, memória e confirmações.

**Estado:** 🟡 runtime local sem adapter real · [ADR-0010](../../docs/decisoes/adr/0010-mastra-e-gpt-4o-mini.md)
(Mastra + `openai/gpt-5.4-mini`, agente de várias etapas — spec 013) · identidade do canal
[ADR-0012](../../docs/decisoes/adr/0012-identidade-do-canal-whatsapp.md)
(`PeerDirectory` pelo celular do owner) · canal de teste `POST /agent/messages`
quando há `OPENAI_API_KEY` · a CI usa o modelo dublê do Mastra · harness **Mastra Studio** (eng.) é `NR-121` ·
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

Modelo padrão: `openai/gpt-5.4-mini`. Trocar de modelo é `AGENT_MODEL`, depois da avaliação. Trocar
de framework reabre a ADR-0010.

### Como o laço gira

```
mensagem → processMessage                       # identidade, janela, pendente, turno
        → BuddyBrain.conversar()                # Agent Mastra, até 5 etapas
            → tools de leitura → core           # o modelo vê o resultado e redige
            → tools de proposta → confirmations # não gravam
            → accept_proposal → trava → core    # grava com os args guardados
        → texto sem termo técnico → resposta
```

As consultas executam o caso de uso de `core` dentro do laço, com o
`ExecutionContext` que viaja no `RequestContext` (nunca no prompt, nunca em
argumento do modelo). As tools de gravação só gravam uma `PendingConfirmation`;
`accept_proposal` roda a trava `ehConcordanciaPura` sobre o texto da dona e
executa com `idempotencyKey = confirmation:{id}`. HITL do Mastra
(`requireApproval`) não é usado. Contrato:
[`buddy-runtime.md`](../../specs/013-buddy-conversa-natural/contracts/buddy-runtime.md).

| Arquivo                     | O que faz                                                                  |
| --------------------------- | -------------------------------------------------------------------------- |
| `process-message.ts`        | Borda: identidade, foto, teto, janela, pendente, uso de IA, turno, falha   |
| `buddy-brain.ts`            | `Agent` + `generate` (`maxSteps: 5`, `prepareStep`, `activeTools`)         |
| `instructions.ts`           | Tom e regras de conversa (não é a barreira: as regras de valor são código) |
| `tools/read-tools.ts`       | Consultas e `find_customer` / `find_product`                               |
| `tools/proposal-tools.ts`   | As 15 propostas e o `executar` usado no aceite                             |
| `tools/acceptance-tools.ts` | `accept_proposal` (trava) e `cancel_proposal`                              |
| `tools/refusal-tools.ts`    | `refuse_*`                                                                 |
| `acceptance-guard.ts`       | `ehConcordanciaPura` — dado novo ou ressalva nunca grava                   |
| `conversation-context.ts`   | Snapshot `v: 2` e resumo de entidades (ADR-0016)                           |
| `technical-terms.ts`        | Processador de saída e limpeza de UUID, código, campo, tool e centavos     |
| `views.ts`                  | Visões humanizadas (reais, pagamento em português, sem vazios)             |

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

Confirmação pendente **expira**. O modelo interpreta a resposta, mas dado novo
ou ressalva **nunca** grava (trava `ehConcordanciaPura`): vira correção e nova
proposta. Resposta ambígua conta como **não**: o custo de
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

Consumo medido por empresa e por etapa de modelo desde o primeiro dia. Teto
configurável e **desligado por padrão** (assinante sem limite), com degradação
avisada quando ligado —
[RNF-072](../../docs/produto/requisitos-nao-funcionais.md),
[RNF-073](../../docs/produto/requisitos-nao-funcionais.md).
O denominador da mensalidade ainda é [QST-002](../../docs/decisoes/README.md#qst-002).

## Harness local (NR-060)

Canal de engenharia: `POST /agent/messages` com sessão de **fixture**
(criar usuário + empresa de teste, popular dados, autenticar). Não é o
canal de produto do lojista. Opera em não-produção, ou com
`AGENT_HARNESS=1` quando o `NODE_ENV` está próximo de prod (staging).
Sem `OPENAI_API_KEY` o endpoint responde 503 e o restante da API segue.
Produção sem `AGENT_HARNESS=1` continua desligada mesmo com a chave. O Studio
(NR-121) é harness de engenharia, não canal de produto.

A CI não chama a OpenAI. Cada turno que precisa de tool grava a decisão com
o modelo dublê do Mastra. Passo a passo:
[quickstart](../../specs/010-assistente-sempre-openai/quickstart.md).

### Harness Studio (NR-121)

O painel do Mastra Studio conversa com o agent **`studio-harness`**, um relé
que chama o mesmo `processMessage` do POST (`channel: 'whatsapp'`, número
forjado). O generate do Studio **não** chama OpenAI: o modelo do relé só
encaminha o texto. A chamada ao modelo, se a chave existe, vive só dentro do
laço. Sem a chave o adapter do Studio não monta.

Fluxo mínimo:

1. Copiar `packages/agent/studio/presets.example.json` → `presets.json`
   (gitignored) **ou** apontar `AGENT_STUDIO_PRESETS` no `.env` para outro
   arquivo. Preencher `companyId` / `userId` com os UUIDs da fixture.
2. Subir a API em não-produção com `OPENAI_API_KEY`
   (`pnpm --filter @na-regua/api dev`). Sem a chave o Studio não monta. Sem a
   API na 3333 o painel relata Failed to fetch.
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

A CI com o modelo dublê só prova que `durationMs` existe e é `number ≥ 0`. Os tetos
de 5 s / 8 s medem-se **no painel**, com provedor real — não rode isto no
GitHub Actions nem em job que chame OpenAI.

```bash
OPENAI_API_KEY=… AGENT_MODEL=openai/gpt-5.4-mini
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
(`processMessage`) usa `AGENT_MODEL` (padrão `gpt-5.4-mini`).

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

## Operação diária no WhatsApp (012)

Tools novas/reorientadas — inputs de `contracts`, execução via `AgentUseCases` →
`core` (sem HTTP interno):

| Tool id                                          | Confirma? | Core                               | Notas                                                       |
| ------------------------------------------------ | :-------: | ---------------------------------- | ----------------------------------------------------------- |
| `rank_customers` / `rank_products`               |    ❌     | `rankCustomers` / `rankProducts`   | Período obrigatório; sem datas, o Buddy pergunta            |
| `list_sales` (histórico)                         |    ❌     | `listSales`                        | `customerId` = compras do cliente; ticket nulo sem inventar |
| `update_customer` / `update_product`             |    ✅     | `updateCustomer` / `updateProduct` | Só campos pedidos + id                                      |
| `mark_customer_deleted` / `mark_product_deleted` |    ✅     | `deleteCustomer` / `deleteProduct` | Soft-delete; frase **deletado**                             |
| `create_sale`                                    |    ✅     | `registerSale`                     | “Compra” do cliente = venda (não `create_receivable`)       |
| `cancel_sale`                                    |    ✅     | `cancelSale`                       | “Apague a venda” = cancelamento; linha permanece            |
| `refuse_delete_account_or_contact`               |    ❌     | —                                  | Conta bancária / contato: recusa sem remoção                |

Proibido: tool que execute `DELETE` físico em tabela de negócio.

Roteiro manual:
[`docs/qa/buddy-roteiro-de-prompts.md`](../../docs/qa/buddy-roteiro-de-prompts.md).
Gates:
[`specs/012-buddy-operacao-whatsapp/quickstart.md`](../../specs/012-buddy-operacao-whatsapp/quickstart.md).

## Foto do código de barras

Fora da spec 013: uma foto recebe o pedido de texto (`FRASE_PEDIDO_DE_TEXTO`),
sem chamar o modelo. O fluxo de decodificação da NR-116 foi retirado do agente;
o caso de uso `findProductByBarcode` continua em `core` para a tela.

## Cadastro, pagar e receber por mensagem (NR-117)

Três tools de escrita geradas de `contracts`, com `mutatesValue: true` e o mesmo
caso de uso das telas (`registerProduct`, `createPayable`, `createReceivable` em
`core`):

| Tool                | Confirma? | Exemplo de frase                                  |
| ------------------- | :-------: | ------------------------------------------------- |
| `create_product`    |    ✅     | `cadastra camiseta M custo 20 vende 49,90`        |
| `create_payable`    |    ✅     | `lança aluguel 1800 vence dia 10`                 |
| `create_receivable` |    ✅     | `a receber 500 do João na sexta, aluguel vitrine` |

Proposta → `sim` / `não` / TTL segue a máquina de confirmação da NR-061. Valor,
vencimento, fornecedor e descrição **não** são inventados: pedido incompleto vira
pergunta, sem `confirmationId`. Preço de venda abaixo do custo cai
no schema antes de qualquer pendência; EAN duplicado devolve o conflito do núcleo
sem atalho de “reutilizar” no chat.

**Fora do aceite desta fatia:** tools da NR-118 (`settle_*`, `adjust_stock`,
`cancel_sale`).

## Testes e avaliação (spec 013)

A CI não chama a OpenAI. Os testes usam o `MastraLanguageModelV2Mock` do
próprio Mastra no `Agent` real (`src/test-support/mock-model.ts`, uma resposta
por etapa) e uma loja em memória (`src/test-support/loja-de-teste.ts`).
`apps/api` importa os dois por `@na-regua/agent/test-support`.

```bash
pnpm --filter @na-regua/agent test
pnpm --filter @na-regua/api test -- src/routes/agent.test.ts src/composition.test.ts
# Com DATABASE_URL: proposta sobrevive ao reinício; mutações persistidas
pnpm --filter @na-regua/api test -- src/e2e/agent-confirmation-restart.test.ts src/e2e/agent-mutations-nr117.test.ts
```

A qualidade da conversa (tom, perguntas, retomada, ausência de termo técnico)
é medida com o modelo real, **fora da CI**, antes de liberar e a cada troca de
modelo:

```bash
OPENAI_API_KEY=… AGENT_MODEL=openai/gpt-5.4-mini pnpm --filter @na-regua/agent eval
```

As conversas ficam em `eval/*.eval.ts`; a transcrição de cada uma vai para
`eval/.transcricoes/` (fora do git) e é anexada ao PR de liberação. Roteiro
manual: [`docs/qa/buddy-roteiro-de-prompts.md`](../../docs/qa/buddy-roteiro-de-prompts.md).

## Variáveis de ambiente

Cópia para `.env`: [`.env.example`](../../.env.example) na raiz. Matriz
completa: [`ambientes.md`](../../docs/engenharia/ambientes.md).

| Variável                     | Local                                | Função                                                                                           |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `OPENAI_API_KEY`             | vazia no parse                       | Opcional para a API subir. Obrigatória só para o assistente montar. Sem ela, 503 no harness.     |
| `AGENT_MODEL`                | `openai/gpt-5.4-mini`                | Formato Mastra `provedor/modelo`. Só é lida quando a chave existe.                               |
| `AGENT_HARNESS`              | ausente \| `1`                       | Porteiro (FR-001b): `1` libera HTTP **e** Studio em produção. Ausente, vazio ou `0` = desligado. |
| `AGENT_STUDIO_PRESETS`       | `packages/agent/studio/presets.json` | Path do JSON de presets (NR-121). Ausente/vazio = esse default.                                  |
| `AGENT_MONTHLY_BUDGET_CENTS` | vazio = sem teto                     | Teto de IA por empresa/mês ([RNF-073](../../docs/produto/requisitos-nao-funcionais.md)).         |
