# agent

Runtime do assistente: tools, memória e confirmações.

**Estado:** 🟡 runtime local sem adapter real · [ADR-0010](../../docs/decisoes/adr/0010-mastra-e-gpt-4o-mini.md)
(Mastra + `openai/gpt-4o-mini`) · identidade do canal
[ADR-0012](../../docs/decisoes/adr/0012-identidade-do-canal-whatsapp.md)
(`PeerDirectory` pelo celular do owner) · canal de teste `POST /agent/messages`
com `AGENT_PROVIDER=fake` · webhook Meta é `NR-046`
([ADR-0014](../../docs/decisoes/adr/0014-meta-cloud-api.md)) · confirmação
persistente é `NR-061` (hoje in-memory) · memória da conversa ainda é
[DEC-011](../../docs/decisoes/README.md#dec-011) (`NR-062`)

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

[Mastra](https://mastra.ai) como biblioteca — `Agent` + `createTool` — **dentro**
deste pacote, composto em `apps/api`. Não é o servidor HTTP do Mastra. Contrato:
[`integracoes/mastra.md`](../../docs/arquitetura/integracoes/mastra.md).

Modelo inicial: `openai/gpt-4o-mini`. Trocar de modelo é `AGENT_MODEL`. Trocar
de framework reabre a ADR-0010.

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
Não se grava `conversations` / `messages` enquanto a DEC-011 estiver aberta.

## Riscos específicos de ter um LLM no caminho

| Risco                                  | Controle                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Injeção de prompt                      | só executa via tool call tipada; texto nunca vira chamada arbitrária                                            |
| Escalada de privilégio                 | chama `core` com o mesmo `ExecutionContext`; papel verificado no caso de uso                                    |
| Ação não intencionada                  | confirmação explícita                                                                                           |
| Vazamento entre conversas              | contexto isolado por empresa ([RF-106](../../docs/produto/requisitos-funcionais.md))                            |
| Dado sensível ao provedor              | envia o mínimo necessário ([RNF-075](../../docs/produto/requisitos-nao-funcionais.md)); OpenAI é subprocessador |
| Alucinação com consequência financeira | o agente não calcula                                                                                            |

## Não haverá busca semântica sobre o banco de negócio

"Quanto vendi hoje?" vira consulta SQL determinística via `core`, não busca
vetorial. Mastra tem RAG; **não se liga** sobre dado financeiro. Fechado na
[ADR-0010](../../docs/decisoes/adr/0010-mastra-e-gpt-4o-mini.md).

## Custo

Consumo medido por empresa desde o primeiro dia. Teto configurável, com
degradação avisada em vez de conta surpresa —
[RNF-072](../../docs/produto/requisitos-nao-funcionais.md),
[RNF-073](../../docs/produto/requisitos-nao-funcionais.md).
O denominador da mensalidade ainda é [QST-002](../../docs/decisoes/README.md#qst-002).

## Variáveis de ambiente

`AGENT_PROVIDER` (`fake` \| `mastra`), `OPENAI_API_KEY`, `AGENT_MODEL`
(`openai/gpt-4o-mini`), `AGENT_MONTHLY_BUDGET_CENTS`.
