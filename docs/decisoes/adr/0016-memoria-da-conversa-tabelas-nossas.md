---
adr: 0016
titulo: Memória da conversa nas tabelas nossas, sem Memory Mastra
status: aceita
data: 2026-09-16
decisores:
  - Trilha 2 — Plataforma & Integrações
substitui: null
substituida_por: null
---

# ADR-0016 — Memória da conversa nas tabelas nossas, sem Memory Mastra

|                       |                                     |
| --------------------- | ----------------------------------- |
| **Status**            | Aceita                              |
| **Data**              | 2026-09-16                          |
| **Decisores**         | Trilha 2 — Plataforma & Integrações |
| **Decisão de origem** | [DEC-011](../README.md#dec-011)     |

## Contexto

A [DEC-011](../README.md#dec-011) perguntava o que a conversa lembra, por
quanto tempo, onde mora, e se "aprendizado contínuo" era memória por lojista ou
ajuste de modelo. Enquanto aberta, [RF-105](../../produto/requisitos-funcionais.md),
[RF-106](../../produto/requisitos-funcionais.md) e
[US-051](../../produto/user-stories.md#us-051--manter-o-contexto-da-conversa)
e a [NR-062](../../processo/task-ledger.md) ficavam atrás dela.

O repo já respondia parte da pergunta:

1. O catálogo tem `conversations`, `messages` e `confirmations` com
   `company_id` e RLS ([esquema](../../arquitetura/esquema-postgresql.md#assistente),
   [ADR-0001](0001-rls-por-linha.md)).
2. Mastra é biblioteca; Memory/Storage dele **não** entram em `public`
   ([ADR-0010](0010-mastra-e-gpt-4o-mini.md),
   [`integracoes/mastra.md`](../../arquitetura/integracoes/mastra.md)).
3. A identidade do canal já fixou a chave lógica por empresa + peer
   (`wa:${companyId}:${peer}`), e recusou Memory por `user_id`
   ([ADR-0012](0012-identidade-do-canal-whatsapp.md)).
4. Confirmação de valor é máquina nossa ([RF-103](../../produto/requisitos-funcionais.md)),
   hoje in-memory até a NR-061 — o schema já liga `confirmations` a
   `conversations`.
5. Conteúdo de conversa retém-se pelo mínimo declarado, com expurgo
   ([RNF-035](../../produto/requisitos-nao-funcionais.md)); ao LLM vai o
   mínimo ([RNF-075](../../produto/requisitos-nao-funcionais.md)).

Não se media, neste momento, volume de mensagens por empresa
([QST-002](../README.md#qst-002)). O prazo numérico de retenção ainda não
aparecia em lugar nenhum — só a obrigação de **declarar** um.

## Opções consideradas

### Opção A — Tabelas nossas + janela curta + idle

Persistir turnos em `conversations` / `messages` (RLS). Contexto ativo = últimas
mensagens da conversa vigente, até um teto. Ociosidade longa encerra o contexto
ativo para ações novas. Sem Memory Mastra. Sem treino de modelo.

| Prós                                                                    | Contras                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Casa com o catálogo e com RF-105/106                                    | Expõe corpo de mensagem no Postgres — exige expurgo (RNF-035)            |
| Isolamento por `company_id` é o mesmo do resto do sistema               | `processMessage` precisa carregar histórico antes do `generate`          |
| Confirmação (NR-061) passa a FK real em `conversations`                 | Janela curta pode falhar em anáfora após muitas mensagens intermediárias |
| "Aprendizado" da apresentação vira memória de turno, não LGPD de treino |                                                                          |

### Opção B — Memory / Storage do Mastra

Ligar `@mastra/memory` (histórico, working memory, semantic recall).

| Prós                        | Contras                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| Menos código de histórico   | Tabelas sem `company_id` em `public` quebram ADR-0001                                        |
| Docs do framework descrevem | Semantic recall sobre conversa financeira é vizinho do RAG que a ADR-0010 proibiu no negócio |
|                             | Fecha a DEC por omissão, sem controle de idle/expurgo nossos                                 |

### Opção C — Só estado volátil (Redis / memória de processo)

| Prós                                         | Contras                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| Sem dado sensível no Postgres de longo prazo | Reinício do processo apaga contexto — RF-105 falha entre deploys               |
|                                              | Confirmação sensível já precisa sobreviver a restart (NR-061)                  |
|                                              | Esvazia o catálogo `conversations` / `messages` que a ADR-0006 já materializou |

### Opção D — Preferências duráveis + "aprendizado" de modelo

Guardar perfil do lojista e/ou fine-tune / feedback loop com dado de conversa.

| Prós                   | Contras                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| Cobre o slogan da deck | Campo minado de LGPD ([RNF-036](../../produto/requisitos-nao-funcionais.md)); DEC-011 já alertava |
|                        | Fora do MVP de RF-105 (anáfora), não do de treino                                                 |

## Decisão

**Escolhemos a opção A.**

1. **O quê é lembrado.** Histórico recente de turnos (`user` / `assistant` /
   `system`) da conversa ativa, o bastante para resolver referência
   ("ele", "essa venda"). Entidades já resolvidas no turno (ids de cliente,
   venda, produto) podem ir em metadado da mensagem ou no `tool_calls` jsonb —
   não há perfil de preferências nem memória "para sempre" do lojista.
2. **Onde.** Tabelas `conversations`, `messages` e `confirmations` no schema
   de negócio, com `company_id` e RLS. Porta em `core` / repositório em `db`;
   `packages/agent` não importa `db`. **Memory, Storage e semantic recall do
   Mastra continuam desligados.**
3. **Chave da conversa.** Por empresa + canal + peer (WhatsApp:
   `company_id` + `channel='whatsapp'` + `peer`), alinhada à
   [ADR-0012](0012-identidade-do-canal-whatsapp.md). App/web usam a mesma
   disciplina com o peer da sessão quando o canal existir.
4. **Contexto ativo (RF-105 + RNF-075).** No `decide`, envia-se no máximo as
   **últimas 12 mensagens** da conversa vigente (ou menos, se o idle tiver
   cortado antes). Corpo completo de histórico antigo **não** viaja à OpenAI.
5. **Idle (RF-106).** Sem mensagem por **2 horas**, a conversa deixa de ser
   "ativa" para anáfora: ação nova **não** aplica silenciosamente "ele" /
   "essa venda" do trecho ocioso — o assistente pede de novo ou trata como
   intenção sem âncora. Confirmação pendente continua com o TTL próprio
   (5 min no runtime atual; NR-061 na tabela).
6. **Retenção (RNF-035).** Corpos de `messages` (e conversas órfãs) são
   **expurgados após 30 dias** por job verificável. Auditoria de efeito em
   negócio continua nas tabelas de auditoria — não depende do chat.
7. **"Aprendizado contínuo".** Significa só contexto de conversa por empresa.
   **Não** há treino, fine-tune nem índice vetorial com dado de lojista neste
   recorte.

O que foi abdicado: Memory Mastra; Redis-only; preferências duráveis; treino
de modelo com conversa.

Contrato vivo: [`integracoes/mastra.md`](../../arquitetura/integracoes/mastra.md).
Trabalho: NR-061 (confirmação persistente) e NR-062 (contexto isolado).

## Consequências

### Positivas

- NR-062 deixa de esperar decisão: o _onde_ é o catálogo que já existe.
- RF-105/106 e US-051 ganham critérios numéricos (12 msgs, 2 h idle, 30 dias).
- Confirmação e histórico compartilham a mesma `conversations` row.
- Isolamento continua sendo RLS + `ExecutionContext`, não processor Mastra.

### Negativas

- Mais dado pessoal (texto de WhatsApp) no Postgres — expurgo de 30 dias vira
  aceite da NR-062 / job de retenção.
- Janela de 12 mensagens pode perder âncora em diálogos longos; o remédio é
  pedir esclarecimento, não aumentar o prompt sem medida (RNF-075).
- Idle de 2 h é escolha sem medição de uso real — pode ser curto demais no
  balcão ou longo demais para anáfora perigosa.

### Neutras

- `AGENT_PROVIDER=fake` continua sem precisar de histórico real nos testes
  unitários; testes de contrato da NR-062 cobrem idle e isolamento.
- DEC-016 (política / subprocessadores) continua dona de declarar OpenAI e
  Meta; esta ADR só fixa o que nós guardamos.

## Impacto na documentação

- [x] `docs/decisoes/README.md` — DEC-011 → 🟢
- [x] `docs/arquitetura/integracoes/mastra.md`
- [x] `docs/arquitetura/visao-geral.md`, `fluxos.md`
- [x] `packages/agent/README.md`
- [x] `docs/produto/user-stories.md` (US-051)
- [x] `docs/processo/task-ledger.md` — NR-062 sem bloqueio DEC-011

## Quando revisitar

- Idle de 2 h ou janela de 12 msgs falharem RF-105/102 num piloto mensurável.
- Retenção de 30 dias for insuficiente para disputa ou excessiva para jurídico
  (DEC-016 / QST-004).
- Volume de mensagens tornar o carregamento por turno caro demais
  (aí janela por tokens, não por contagem).
- Mastra Memory passar a oferecer store com `company_id` e expurgo nossos —
  ainda assim reabre **esta** ADR (histórico de turnos), não a de RAG.
  Recuperação vetorial auxiliar é [ADR-0017](0017-rag-com-tools-e-rls.md).
