---
adr: 0017
titulo: RAG como recuperação auxiliar; tools e domain continuam a verdade
status: aceita
data: 2026-09-16
decisores:
  - Produto
  - Trilha 2 — Plataforma & Integrações
substitui: null
substituida_por: null
---

# ADR-0017 — RAG como recuperação auxiliar; tools e domain continuam a verdade

|                       |                                     |
| --------------------- | ----------------------------------- |
| **Status**            | Aceita                              |
| **Data**              | 2026-09-16                          |
| **Decisores**         | Produto · Trilha 2                  |
| **Decisão de origem** | revisa o ponto 3 da [ADR-0010](0010-mastra-e-gpt-4o-mini.md) |

## Contexto

A [ADR-0010](0010-mastra-e-gpt-4o-mini.md) fechou runtime (Mastra) e modelo
(`gpt-4o-mini`) e, no mesmo texto, **proibiu** RAG / _semantic recall_ sobre
dado financeiro, estoque, cliente ou relatório. A intenção era correta: o
número da conversa tem de bater com o relatório ([RF-101](../../produto/requisitos-funcionais.md)).
A formulação misturou duas coisas distintas:

1. **Fonte de verdade** — quanto vendi, quanto deve, quanto tem em estoque.
2. **Recuperação** — achar o produto pelo apelido, o trecho de ajuda, o
   cliente ambíguo no catálogo.

O produto vai usar RAG para (2). Sem isso, desambiguação em português de
balcão ([RF-102](../../produto/requisitos-funcionais.md)) e consulta por
linguagem natural ficam só na sorte do `gpt-4o-mini` e na tool com filtro
exato.

A [ADR-0016](0016-memoria-da-conversa-tabelas-nossas.md) já fixou **histórico
de turnos** nas tabelas nossas (janela de 12, idle 2 h, expurgo 30 dias) e
deixou Memory/Storage do Mastra desligados. Isso **não** muda: RAG não
substitui a memória de conversa nem liga `@mastra/memory` em `public`.

Forças: qualidade de desambiguação; [RNF-075](../../produto/requisitos-nao-funcionais.md)
(mínimo ao LLM); [ADR-0001](0001-rls-por-linha.md) (isolamento); custo de
embedding e tokens ([RNF-072](../../produto/requisitos-nao-funcionais.md) /
[QST-002](../README.md#qst-002)).

## Opções consideradas

### Opção A — RAG auxiliar + tools como verdade

Índice vetorial (ou API de busca do Mastra **atrás** de store nosso) com
`company_id`. O retrieve alimenta o prompt ou uma tool de "candidatos". Totais,
saldos e efeitos em dinheiro continuam só via tool → `core` → `domain`.

| Prós                                                              | Contras                                                          |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| Casa com RF-101/102 sem abrir mão de português frouxo             | Embedding e índice são dado pessoal / de negócio a mais          |
| Isolamento igual ao resto do sistema se o store tiver `company_id` | Mais tokens se o retrieve for guloso (RNF-075)                   |
| Não reabre Memory Mastra nem servidor Mastra                      | Job de indexação / reindexação quando produto ou FAQ muda        |

### Opção B — Manter a proibição da ADR-0010

| Prós                         | Contras                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| Superfície menor             | Desambiguação e FAQ só por match exato ou alucinação       |
| Menos PII em índice vetorial | Contradiz a escolha de produto de **usar** RAG             |

### Opção C — RAG como fonte do número ("quanto vendi" no chunk)

| Prós                | Contras                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| Um caminho só       | Quebra RF-101: o chunk pode estar desatualizado ou misturar tenants     |
|                     | Relatório e Zap deixam de ser a mesma verdade                           |

## Decisão

**Escolhemos a opção A.** Isto **revisa** o item 3 da decisão da ADR-0010
("Mastra tem RAG… Não se ligam"): RAG **entra**, com os limites abaixo. O
resto da ADR-0010 (Mastra como biblioteca, `gpt-4o-mini`, sem `MastraServer`)
permanece.

1. **Para que serve.** Recuperar candidatos e contexto textual: catálogo de
   produto (nome, descrição, código), material de ajuda / FAQ do produto, e —
   se fizer falta depois da janela de 12 turnos — trechos de conversa **da
   mesma empresa**. Não serve para inventar faturamento, saldo, estoque nem
   DRE.
2. **Como o número nasce.** Pergunta de valor ou efeito em dinheiro → tool
   tipada → `core` → `domain`. O trecho recuperado pode **sugerir** qual
   `productId` / `customerId` passar à tool; o valor na resposta vem da tool.
3. **Onde mora o índice.** Store **nosso** (Postgres + extensão vetorial, ou
   equivalente), sempre com `company_id` e RLS — mesmo padrão da ADR-0001.
   APIs de RAG do Mastra só entram se apontarem para esse store. **Não** se
   liga Memory/Storage padrão do Mastra em `public` (ADR-0016 continua).
4. **O que vai ao modelo.** No máximo os top‑k chunks do tenant atual, com
   teto de tokens alinhado a RNF-075. Sem extrato completo, sem XML, sem
   lista inteira de clientes.
5. **O que não muda.** Confirmação nossa (RF-103); agente não calcula
   (RF-101); histórico recente continua ADR-0016 (tabelas `messages`, não
   semantic recall do Memory Mastra como substituto).

O que foi abdicado: proibição absoluta de busca semântica da ADR-0010;
usar RAG como caixa registradora; Memory Mastra como índice único.

Contrato vivo: [`integracoes/mastra.md`](../../arquitetura/integracoes/mastra.md).

## Consequências

### Positivas

- RF-102 e consultas em linguagem natural ganham caminho de desambiguação
  sem depender só do mini.
- A regra "mesmo número do relatório" fica escrita de forma que o RAG não a
  fura.
- Documentação deixa de contradizer a escolha de produto.

### Negativas

- Operação de embedding/reindexação e custo por tenant (medir desde o
  primeiro dia — RNF-073).
- Chunks de conversa ou catálogo no índice são mais superfície LGPD
  (expurgo alinhado a RNF-035 / DEC-016).
- Risco de o modelo **citar** um preço velho do chunk — aceite: a resposta
  ao lojista para valor usa a tool; se o texto citar o chunk, é bug.

### Neutras

- `AGENT_PROVIDER=fake` continua sem índice real nos testes unitários;
  contrato do retrieve entra nos testes da tarefa de implementação.
- FAQ global (sem `company_id`) só se for conteúdo **nosso** de produto, não
  dado de lojista.

## Impacto na documentação

- [x] `docs/decisoes/README.md` — DEC-007 / índice de ADRs apontam esta revisão
- [x] `docs/arquitetura/integracoes/mastra.md`
- [x] `docs/arquitetura/seguranca.md`
- [x] `packages/agent/README.md`
- [x] `docs/processo/destravar-os-bloqueios.md`
- [x] `docs/processo/task-ledger.md` — NR-120
- [ ] implementação do índice / retrieve — NR-120 (não este PR de docs)

## Quando revisitar

- Retrieve citar saldo/total que a tool não confirmou (incidente RF-101).
- Custo de embedding furar RNF-072 depois de QST-002.
- Precisar de índice cross-tenant (rede B2B) — aí ADR nova; esta não cobre.
- Mastra exigir Memory própria sem `company_id` para o RAG funcionar — aí
  store nosso continua obrigatório ou reabre isolamento.
