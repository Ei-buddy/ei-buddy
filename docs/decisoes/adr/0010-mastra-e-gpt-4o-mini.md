---
adr: 0010
titulo: Mastra como runtime do agente, gpt-4o-mini como modelo inicial
status: aceita
data: 2026-09-11
decisores:
  - Trilha 2 — Plataforma & Integrações
substitui: null
substituida_por: null
---

# ADR-0010 — Mastra como runtime do agente, gpt-4o-mini como modelo inicial

|                       |                                     |
| --------------------- | ----------------------------------- |
| **Status**            | Aceita                              |
| **Data**              | 2026-09-11                          |
| **Decisores**         | Trilha 2 — Plataforma & Integrações |
| **Decisão de origem** | [DEC-007](../README.md#dec-007)     |

> **Revisão parcial (2026-09-16):** o item 3 da decisão abaixo (proibição de
> RAG / _semantic recall_) foi **revisado** pela
> [ADR-0017](0017-rag-com-tools-e-rls.md). Runtime Mastra, modelo inicial e a
> regra “tools + `domain` calculam valor” permanecem.
>
> **Revisão parcial (2026-09-16, Studio):** o trecho que abdicava de Studio /
> servidor HTTP Mastra como _plataforma do lojista_ permanece. **Studio entra
> como harness de engenharia** ([NR-121](../../processo/task-ledger.md)):
> substitui o WhatsApp no desenvolvimento, chama o mesmo `processMessage`, com
> preset/número forjado e observabilidade. Não é canal de produção.

## Contexto

A [DEC-007](../README.md#dec-007) misturava duas perguntas. A segunda já tinha
resposta na arquitetura: o agente **não** busca texto no banco de negócio. Ele
chama _tools_ tipadas geradas de `contracts`, que invocam casos de uso de
`core`. Sem isso, "quanto vendi hoje?" vira um número que não bate com o
relatório — e [RF-101](../../produto/requisitos-funcionais.md) cai.

A primeira pergunta — **qual runtime e qual modelo** — ainda estava aberta, e
era ela que marcava `NR-060` como bloqueada. O `.env.example` apontava para
Anthropic (`ANTHROPIC_API_KEY`, `claude-sonnet-5`) por omissão, não por
decisão. O pacote `agent` era um placeholder.

Forças em conflito: custo por interação contra [RNF-072](../../produto/requisitos-nao-funcionais.md)
(IA ≤ 15% da mensalidade, e a mensalidade ainda é [QST-002](../README.md#qst-002));
latência contra [RNF-006](../../produto/requisitos-nao-funcionais.md) (≤ 5 s na
consulta, ≤ 8 s na ação com confirmação); _tool calling_ em português; e o
tempo de um time de três pessoas escrever um laço de agente à mão.

Não se sabia, neste momento, se `gpt-4o-mini` desambigua produto em português
com a qualidade que [RF-102](../../produto/requisitos-funcionais.md) pede. A
escolha do modelo é de **começo**, não de destino. A escolha do framework é a
que custa mais para reverter.

## Opções consideradas

### Opção A — Mastra + OpenAI `gpt-4o-mini` no começo

[Mastra](https://mastra.ai) é um framework TypeScript de agentes: `Agent`,
`createTool` com schema Zod, roteamento de modelo no formato
`provedor/modelo`. O modelo inicial é `openai/gpt-4o-mini`.

| Prós                                                                                                    | Contras                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Tools em Zod — o mesmo tipo de schema que `contracts` já é                                              | Framework a mais no caminho entre a mensagem e `core`                                                                    |
| Trocar de modelo é string (`openai/gpt-4o-mini` → outro), não reescrever o laço                         | OpenAI é subprocessador nos EUA — dado de conversa sai do Brasil ([RNF-036](../../produto/requisitos-nao-funcionais.md)) |
| `gpt-4o-mini` é barato o bastante para caber no teto enquanto [QST-002](../README.md#qst-002) não fecha | Mini erra mais em desambiguação e português coloquial que um modelo maior                                                |
| Dá para chamar `agent.generate()` como biblioteca, dentro de `apps/api`                                 | Mastra traz memória, RAG e um servidor HTTP próprios — todos os três são armadilha neste desenho                         |

### Opção B — Laço próprio (Vercel AI SDK ou `fetch`) + modelo a escolher

| Prós                                      | Contras                                                  |
| ----------------------------------------- | -------------------------------------------------------- |
| Menos dependência, superfície menor       | O laço de tool call, retry e streaming vira código nosso |
| Troca de modelo continua sendo um adapter | Três pessoas pagam o custo que o framework já resolveu   |

### Opção C — Anthropic Claude como primeiro provedor

É o que o `.env.example` sugeria (`ANTHROPIC_API_KEY`, `claude-sonnet-5`).

| Prós                                         | Contras                                                               |
| -------------------------------------------- | --------------------------------------------------------------------- |
| Qualidade em português e tool calling fortes | Custo por token mais alto no começo, com mensalidade ainda indefinida |
|                                              | A sugestão no exemplo nunca foi uma decisão                           |

### Opção D — LangChain / LangGraph

| Prós               | Contras                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| Ecossistema grande | Python-first; o stack inteiro é TypeScript                              |
|                    | Abstrações demais para um agente que só pode chamar casos de uso nossos |

## Decisão

**Escolhemos a opção A.**

1. **O runtime do assistente é o Mastra**, dentro de `packages/agent`,
   composto em `apps/api`. Não é um processo separado, não é o servidor HTTP
   do Mastra (`MastraServer`, porta 4111, rotas `/api/agents`). O precedente é
   o Better Auth ([ADR-0003](0003-better-auth-como-prova-de-identidade.md)):
   usa-se a biblioteca, não se montam as rotas dela.
2. **O modelo inicial é `openai/gpt-4o-mini`.** "Inicial" é literal: a string
   de modelo é configuração (`AGENT_MODEL`). Trocar de tamanho ou de provedor
   depois não reabre esta ADR — reabre só se o **framework** deixar de servir.
3. **A recuperação de informação continua sendo tool call sobre `core`.**
   Mastra tem RAG e _semantic recall_. **Não se ligam** sobre dado financeiro,
   de estoque, de cliente ou de relatório. O lojista pergunta, a tool consulta,
   `domain` calcula.

O que foi abdicado: Anthropic como primeiro provedor; escrever o laço à mão;
tratar o Mastra como **plataforma de produção** do lojista (Memory padrão,
índice vetorial sem tenant, rotas `/api/agents` como canal). **Studio e um
servidor Mastra de desenvolvimento** entram só como harness de engenharia
([NR-121](../../processo/task-ledger.md)) — ver revisão no topo.

Contrato: [`integracoes/mastra.md`](../../arquitetura/integracoes/mastra.md).

## Consequências

### Positivas

- `NR-060` deixa de esperar esta decisão. O canal Meta (`NR-046`) **não**
  bloqueia mais o runtime: o harness Studio (`NR-121`) substitui o Zap em
  engenharia até o E11 + RAG fecharem. Contexto de conversa:
  [DEC-011](../README.md#dec-011) / [ADR-0016](0016-memoria-da-conversa-tabelas-nossas.md).
- Tools nascem de Zod. A regra "não escreva definição de tool à mão" cabe no
  `createTool` do Mastra: `inputSchema` é o schema de `contracts`.
- Modo `AGENT_PROVIDER=fake` continua obrigatório no local — ninguém precisa de
  chave da OpenAI para subir o sistema.

### Negativas

- **Dado de conversa vai para a OpenAI.** Minimização ([RNF-075](../../produto/requisitos-nao-funcionais.md))
  deixa de ser recado e vira critério de aceite da `NR-060`: o que a tool já
  resolveu não viaja de novo no prompt. A política de privacidade passa a ter
  um operador nomeado — [DEC-016](../README.md#dec-016).
- **`gpt-4o-mini` pode ser fraco demais** para RF-102 (produto ambíguo) e para
  português de balcão. O gatilho de troca é medição, não impressão.
- **Mastra Storage / Memory não entram em `public`.** Tabelas sem `company_id`
  quebram a [ADR-0001](0001-rls-por-linha.md). O precedente é o schema
  `identidade` do Better Auth. O que a conversa lembra, por quanto tempo e
  onde, continua sendo a [DEC-011](../README.md#dec-011) — esta ADR não a
  fecha.
- **Custo por tenant ainda não tem denominador.** RNF-072 é percentual da
  mensalidade, e a mensalidade é [QST-002](../README.md#qst-002). Medir
  tokens por empresa desde o primeiro dia (RNF-073) não espera o preço.

### Neutras

- `ANTHROPIC_API_KEY` sai do exemplo de ambiente. `OPENAI_API_KEY` entra.
- `AGENT_PROVIDER=fake|mastra`. `AGENT_MODEL=openai/gpt-4o-mini`.
- Confirmação de ação sensível ([RF-103](../../produto/requisitos-funcionais.md),
  [RF-104](../../produto/requisitos-funcionais.md)) **não** é feature do
  Mastra: é máquina de estados nossa sobre a tabela `confirmations`.

## Impacto na documentação

- [x] `docs/arquitetura/integracoes/mastra.md`
- [x] `docs/arquitetura/visao-geral.md`, `modulos.md`, `fluxos.md`, `seguranca.md`
- [x] `packages/agent/README.md`
- [x] `docs/engenharia/ambientes.md`, `.env.example`
- [x] `DEC-007` marcada como 🟢 e apontando para esta ADR
- [x] `docs/processo/task-ledger.md` — NR-060 deixa de citar DEC-007 como bloqueio próprio
- [x] `docs/processo/task-ledger.md` — NR-121 (Studio) + cascata E11 antes de Meta (2026-09-16)

## Quando revisitar

- Custo de IA por empresa ativa furar [RNF-072](../../produto/requisitos-nao-funcionais.md)
  depois de [QST-002](../README.md#qst-002) fechar.
- Latência acima de [RNF-006](../../produto/requisitos-nao-funcionais.md) de
  forma persistente.
- Tool calling em português falhar os critérios de RF-097, RF-100 ou RF-102
  num piloto.
- Mastra passar a exigir um servidor HTTP próprio, ou gravar memória em
  `public` sem caminho de schema isolado.
- OpenAI encerrar `gpt-4o-mini`, mudar política de retenção, ou ficar
  inviável como subprocessador (DEC-016 / jurídico).
