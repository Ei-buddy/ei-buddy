# agent

Runtime do assistente: tools, memória e confirmações.

**Estado:** 🟡 runtime local sem adapter real · [ADR-0010](../../docs/decisoes/adr/0010-mastra-e-gpt-4o-mini.md)
(Mastra + `openai/gpt-4o-mini`) · identidade do canal
[ADR-0012](../../docs/decisoes/adr/0012-identidade-do-canal-whatsapp.md)
(`PeerDirectory` pelo celular do owner) · canal de teste `POST /agent/messages`
com `AGENT_PROVIDER=fake` · harness **Mastra Studio** (eng.) é `NR-121` ·
webhook Meta é `NR-046`
([ADR-0014](../../docs/decisoes/adr/0014-meta-cloud-api.md)) · confirmação
persistente é `NR-061` (hoje in-memory) · memória da conversa
[ADR-0016](../../docs/decisoes/adr/0016-memoria-da-conversa-tabelas-nossas.md)
(`NR-062`: tabelas nossas, 12 msgs / 2 h idle / 30 dias) · RAG auxiliar
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

A máquina de estados **vai** morar na tabela `confirmations` (NR-061). Até lá
o runtime usa `InMemoryConfirmations`. O Mastra não substitui essa máquina.

Histórico de conversa (NR-062) mora em `conversations` / `messages` com RLS —
[ADR-0016](../../docs/decisoes/adr/0016-memoria-da-conversa-tabelas-nossas.md).
Sem Memory do Mastra.

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

## Variáveis de ambiente

`AGENT_PROVIDER` (`fake` \| `mastra`), `OPENAI_API_KEY`, `AGENT_MODEL`
(`openai/gpt-4o-mini`), `AGENT_MONTHLY_BUDGET_CENTS`.
