# Implementation Plan: Buddy com conversa natural

**Branch**: `013-buddy-conversa-natural` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-buddy-conversa-natural/spec.md`

**Note**: o setup Spec Kit reportou `BRANCH=013-buddy-conversa-natural`. O
checkout atual pode estar em outra branch; a pasta da feature é a fonte de
verdade (`.specify/feature.json`). PRD de origem:
[feature-buddy-conversa-natural.md](../../docs/prd/feature-buddy-conversa-natural.md).

## Summary

Trocar o laço de uma etapa (o modelo escolhe uma tool, um template escreve a
resposta) por um agente Mastra de até 5 etapas, em que as consultas rodam
dentro do laço e o modelo redige a resposta a partir do resultado real.
Gravações continuam passando por proposta na tabela `confirmations` e aceite;
o aceite é interpretado pelo modelo, mas executado por uma tool cuja trava
determinística recusa qualquer resposta com dado novo ou ressalva. O contexto
ganha um resumo de entidades derivado do `tool_calls` das mensagens, sem
migração. Uma visão humanizada nas tools, a instrução e um processador de
saída garantem que nada técnico chegue à dona. Saem: templates, `FakeLlm`,
o adapter de uma etapa e o fluxo de foto.

Abordagem e alternativas em [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript (strict), Node.js, pnpm workspaces + Turborepo.

**Primary Dependencies**: `@mastra/core` 1.70.0 (`Agent`, `createTool`,
processors, `RequestContext`, `MastraLanguageModelV2Mock`), Zod 4
(`@na-regua/contracts`), `@na-regua/core`, `@na-regua/money`, Fastify
(`apps/api`).

**Storage**: PostgreSQL + RLS, tabelas existentes `conversations`, `messages`
(`tool_calls` jsonb) e `confirmations`. Sem migração. Memory/Storage do Mastra
desligados (ADR-0016).

**Testing**: Vitest 4. CI com `MastraLanguageModelV2Mock` no `Agent` real e
fakes em memória das portas. Avaliação com o modelo real em
`packages/agent/eval/*.eval.ts`, fora do `pnpm test`.

**Target Platform**: API Node (`apps/api`); canais WhatsApp (webhook Meta),
`POST /agent/messages` e Studio.

**Project Type**: monorepo; mudança concentrada em `packages/agent`, com
composição em `apps/api` e default de modelo em `packages/env`.

**Performance Goals**: RNF-006 como meta medida: consulta ≤ 5 s e ação ≤ 8 s
em 95% dos casos da avaliação (SC-007).

**Constraints**:

- No máximo 5 etapas por mensagem; a quinta sem tool (`prepareStep`).
- `maxProcessorRetries: 1` para o retry do processador de saída.
- Tools chamam só `AgentUseCases` (casos de uso de `core`); `agent` não importa
  `db` nem `domain`.
- `companyId` vem do `ExecutionContext` no `RequestContext`, nunca de argumento
  do modelo.
- Gravação só por `accept_proposal`, com `idempotencyKey = confirmation:{id}`.
- Nenhum schema de `contracts` muda.
- TDD obrigatório.

**Scale/Scope**: 30 tools atuais reorganizadas (15 de leitura/regra executam no
laço, 15 de gravação viram proposta) + 4 novas (`find_customer`,
`find_product`, `accept_proposal`, `cancel_proposal`); `process-message.ts`
reescrito; ~6 arquivos apagados; suíte do agente reescrita.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Gate inicial: PASS. Reavaliado após Phase 1: PASS.

| Princípio / regra                                      | Evidência no plano                                                                                                  | Resultado |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------- |
| I. Um núcleo, dois canais                              | Tools chamam os mesmos `AgentUseCases` injetados pela composição; um laço para WhatsApp, app e Studio (FR-038)      | PASS      |
| II. Hexágono e fronteiras                              | `agent` segue sem `db`/`domain`; portas `ConversationStore`/`ConfirmationStore` inalteradas; `contracts` inalterado | PASS      |
| III. Integridade financeira                            | Modelo não calcula; visões formatam centavos de `core` via `money`; aceite idempotente por `confirmation:{id}`      | PASS      |
| IV. Isolamento de tenant                               | `ExecutionContext` resolvido pelo peer/sessão e passado por `RequestContext`; janela já filtrada por RLS; teste A/B | PASS      |
| V. Teste que prova comportamento                       | `Agent` real com modelo dublê; asserções sobre efeito (gravou/não gravou), não sobre chamada                        | PASS      |
| Produto: confirmação explícita, ambíguo conta como não | Trava: ressalva ou dado novo nunca executa; vencida não grava                                                       | PASS      |
| Produto: nunca perguntar o que já se sabe              | Resumo de entidades + instrução (FR-027)                                                                            | PASS      |
| Integrações: teto de IA configurável (RNF-073)         | `AGENT_MONTHLY_BUDGET_CENTS` mantido, desligado por padrão (clarificação da spec)                                   | PASS      |
| Integrações: timeout e falha de provedor               | `generate()` em `try/catch` com frase fixa; provedor fora não derruba a API                                         | PASS      |
| Segurança: dado pessoal fora de log                    | Logs seguem sem corpo de mensagem; transcrição da avaliação usa loja fictícia                                       | PASS      |

Não há violação a justificar em Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/013-buddy-conversa-natural/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── buddy-runtime.md
├── checklists/
│   └── requirements.md
└── spec.md
```

### Source Code (repository root)

```text
packages/agent/
├── src/
│   ├── process-message.ts          # reescrito: borda fina (identidade, janela, brain, limpeza, turno)
│   ├── buddy-brain.ts              # novo: Agent Mastra, generate, prepareStep, coletor do turno
│   ├── instructions.ts             # novo: tom, regras de perguntar/assumir, proibições
│   ├── tools/
│   │   ├── read-tools.ts           # novo: consultas executando core + find_customer/find_product
│   │   ├── proposal-tools.ts       # novo: create_*/update_*/... gravam PendingConfirmation
│   │   ├── acceptance-tools.ts     # novo: accept_proposal (trava) / cancel_proposal
│   │   └── refusal-tools.ts        # novo: refuse_* devolvendo a regra
│   ├── views.ts                    # novo: visões humanizadas (reais, rótulos PT, sem vazios)
│   ├── acceptance-guard.ts         # novo: ehConcordanciaPura
│   ├── technical-terms.ts          # novo: detecção, processador semTermoTecnico, limparTermosTecnicos
│   ├── conversation-context.ts     # novo: snapshot v2, montarResumoDeEntidades, leitor v1
│   ├── catalog.ts                  # reduzido: tipo AgentUseCases + montagem das tools
│   ├── types.ts                    # AgentRuntime com brain; sem llm/tools/barcode
│   ├── create-runtime.ts           # monta brain + stores
│   ├── ai-usage.ts                 # registra etapas; teto opcional mantido
│   ├── format.ts, confirmations.ts, conversations.ts, studio/   # mantidos
│   ├── fake-llm.ts                 # APAGAR
│   ├── mastra-llm.ts               # APAGAR (substituído por buddy-brain.ts)
│   ├── define-tool.ts              # APAGAR formatReply/formatProposal; semNulos vai para tools/
│   ├── photo-sale-draft.ts, photo-replies.ts, barcode-decoder.ts   # APAGAR
│   └── parse-payment-method.ts, parse-register-intent.ts           # APAGAR
├── eval/                           # novo: conversas *.eval.ts contra o modelo real
└── package.json                    # script "eval"; export "./mastra" aponta para buddy-brain
apps/api/src/
├── composition.ts                  # buildAgentDeps cria brain; tira barcode/findProductByBarcode
└── routes/agent.ts, routes/whatsapp-webhook.ts   # sem mudança de contrato; testes atualizados
packages/env/src/api.ts             # AGENT_MODEL default openai/gpt-5.4-mini
.env.example                        # idem
docs/
├── decisoes/adr/0010-...md         # revisão parcial: modelo + laço de várias etapas
├── decisoes/adr/0016-...md         # nota: resumo de entidades no tool_calls v2
├── arquitetura/integracoes/mastra.md
├── engenharia/ambientes.md         # AGENT_MODEL
├── processo/task-ledger.md         # NR da fatia
└── qa/buddy-roteiro-de-prompts.md  # vira índice das conversas de avaliação
packages/agent/README.md            # "Como o laço gira" reescrito
```

**Structure Decision**: reestruturação dentro de `packages/agent`, sem pacote
novo. As tools passam a ser montadas por responsabilidade (`tools/*`) em vez de
um `catalog.ts` com template por tool. `apps/api` só recompõe o runtime.

## Implementation Outline

1. **Testes de unidade puros (TDD)**: `ehConcordanciaPura`,
   `limparTermosTecnicos` e detecção, `montarResumoDeEntidades` (v1 e v2,
   idle), visões humanizadas.
2. **Tools**: leitura (com `find_*`), proposta, aceite com trava, recusas;
   testes de cada uma com `AgentUseCases` falso e `InMemoryConfirmations`.
3. **`buddy-brain.ts`**: `Agent` com instruções, tools, processador de saída,
   `prepareStep` e `RequestContext`; testes com `MastraLanguageModelV2Mock`
   cobrindo a matriz do [quickstart](./quickstart.md).
4. **`process-message.ts`** reescrito sobre o brain; snapshot v2 gravado;
   pendente rejeitada em mudança de assunto; foto; falha fixa; `aiUsage`.
5. **Apagar** `FakeLlm`, `mastra-llm.ts`, templates, foto e testes dependentes;
   reescrever `process-message.test.ts` e `create-runtime.test.ts`.
6. **`apps/api`**: composição, testes de rota (`agent`, `whatsapp-webhook`,
   e2e de confirmação) e Studio.
7. **Env e docs**: default de modelo, ADRs 0010/0016, `mastra.md`,
   `ambientes.md`, README do agente, ledger, roteiro.
8. **Avaliação**: `packages/agent/eval/` com as 8 conversas obrigatórias;
   rodar contra `openai/gpt-5.4-mini` e anexar a transcrição.
9. **`pnpm format:check`** e portões de CI antes do PR.

## Complexity Tracking

> Nenhuma violação de constitution a justificar.
