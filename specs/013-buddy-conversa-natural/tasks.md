---
description: 'Lista de tarefas — Buddy com conversa natural'
---

# Tasks: Buddy com conversa natural

**Input**: documentos de `/specs/013-buddy-conversa-natural/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/buddy-runtime.md](./contracts/buddy-runtime.md), [quickstart.md](./quickstart.md)

**Tests**: obrigatórios. A constitution (princípio V) e o PRD exigem TDD: cada teste é escrito antes do código e precisa falhar primeiro. Testes provam efeito (gravou ou não gravou, o que a dona leu), não chamada.

**Organization**: por história da spec. A Fase 2 troca o laço de uma etapa pelo agente de várias etapas e apaga o antigo; cada história depois acrescenta o seu comportamento sobre esse laço.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: história da spec (US1 a US7)

## Path Conventions

Monorepo. Mudança concentrada em `packages/agent/src/`, composição em `apps/api/src/`, default de modelo em `packages/env/src/`.

---

## Phase 1: Setup (infraestrutura compartilhada)

**Purpose**: dublê de modelo, loja de teste, avaliação e default do modelo.

- [x] T001 Criar `packages/agent/src/test-support/mock-model.ts` com `roteiroDoModelo(etapas)`, que monta um `MastraLanguageModelV2Mock` (de `@mastra/core/test-utils/llm-mock`) com uma resposta de `doGenerate` por etapa: `{ tool: nome, args }` vira conteúdo de tool-call, `{ texto }` vira conteúdo de texto; expõe as chamadas recebidas (`doGenerateCalls`) para asserção do prompt
- [x] T002 [P] Criar `packages/agent/src/test-support/loja-de-teste.ts` com um `AgentUseCases` falso em memória (clientes, produtos com preço de tabela, vendas, contas), espiões de gravação (`gravacoes`) e um `ExecutionContext` por empresa (`ctxDaEmpresa('A')`, `ctxDaEmpresa('B')`), para testes do laço e da avaliação
- [x] T003 [P] Excluir `src/test-support/**` e `eval/**` do denominador de cobertura em `packages/agent/vitest.config.ts`, e trocar `src/mastra-llm.ts` por `src/buddy-brain.ts` na lista de exclusão só para a função que monta o modelo real (`criarModeloReal`)
- [x] T004 [P] Criar `packages/agent/vitest.eval.config.ts` (inclui só `eval/**/*.eval.ts`, timeout por teste de 60 s) e o script `"eval": "vitest run --config vitest.eval.config.ts"` em `packages/agent/package.json`; o `vitest.config.ts` padrão não pode incluir `eval/`
- [x] T005 [P] Trocar o default de `AGENT_MODEL` de `openai/gpt-4o-mini` para `openai/gpt-5.4-mini` em `packages/env/src/api.ts` e `.env.example`, e registrar em `docs/engenharia/ambientes.md`

---

## Phase 2: Foundational (pré-requisitos bloqueantes)

**Purpose**: o laço novo funcionando ponta a ponta com consultas, e o laço antigo apagado.

**⚠️ CRITICAL**: nenhuma história começa antes do checkpoint desta fase.

### Testes da fundação (escrever primeiro, ver falhar)

- [x] T006 [P] Teste de `montarResumoDeEntidades` em `packages/agent/src/conversation-context.test.ts`: lê snapshot `v: 2` (`entidades`, `intencao`, `propostaId`); converte v1 (`{ customerId?, saleId?, productId? }`) e descarta entidades sem `rotulo`; deduplica por `tipo + ref` com o `rotulo` mais recente vencendo; usa a `intencao` do snapshot mais recente que a tenha e encerra a anterior quando um snapshot mais novo vem sem `intencao`; janela vazia devolve resumo vazio; snapshot inválido é ignorado sem lançar
- [x] T007 [P] Teste das visões base em `packages/agent/src/views.test.ts`: `reais(cents)` formata no padrão brasileiro via `formatarCentavos`; `pagamento('cash'|'pix'|'debit'|'credit'|'wallet')` devolve dinheiro, pix, débito, crédito, fiado; `semVazios(obj)` remove chaves `null`, `undefined` e string vazia; `erroHumano(AppError)` devolve `{ status: 'recusado', mensagem }` com a `message` do `AppError` e sem nenhum `fields[].path`
- [x] T008 [P] Teste das tools de leitura em `packages/agent/src/tools/read-tools.test.ts` com `loja-de-teste`: `list_sales`, `period_summary`, `revenue_by_month`, `check_stock`, `search_products`, `check_customer_wallet`, `list_payables`, `list_receivables`, `day_agenda`, `rank_customers`, `rank_products` chamam o caso de uso com o `ExecutionContext` lido de `requestContext` (nunca de argumento) e devolvem `{ status: 'ok', ... }` sem chave terminada em `Cents` e com valores em reais; cada entidade devolvida tem `ref` e `rotulo` e é registrada no coletor do turno
- [x] T009 [P] Teste do laço em `packages/agent/src/buddy-brain.test.ts` com `roteiroDoModelo`: etapa 1 chama `check_stock`, etapa 2 devolve texto; `conversar` retorna esse texto, `etapas = 2` e um `snapshot` v2 com o produto consultado; a janela chega ao modelo como mensagens `user`/`assistant` (não como prefixo de texto); a mensagem de sistema traz a data da loja e o resumo de entidades; `generate` recebe `maxSteps: 5`
- [x] T010 Reescrever `packages/agent/src/process-message.test.ts` do zero (apagar o conteúdo atual baseado em `FakeLlm`), com um `BuddyBrain` falso: peer não vinculado devolve `ignored` sem chamar o brain; peer vinculado chama o brain com a janela de `loadActive` (até 12) e o resumo montado; o turno é gravado com `body` limpo e `toolCalls` = snapshot v2; a resposta é `{ kind: 'answer', text }`

### Implementação da fundação

- [x] T011 [P] Implementar `packages/agent/src/conversation-context.ts`: tipos `SnapshotDeTurno` (`v: 2`), `EntidadeDaConversa` (`tipo: 'cliente' | 'produto' | 'venda' | 'conta_a_pagar' | 'recebivel' | 'compromisso'`, `ref`, `rotulo` não vazio), `IntencaoEmAndamento` (`acao`, `jaDito`, `aguardando: 'cadastro_cliente' | 'cadastro_produto' | 'dados' | 'escolha'`, `descricao`), `ResumoDeEntidades`, `montarResumoDeEntidades(janela)` e `resumoComoTexto(resumo)` em português, com `ref` marcado como uso interno (faz T006 passar)
- [x] T012 [P] Implementar `packages/agent/src/views.ts` com `reais`, `pagamento`, `semVazios` e `erroHumano` (faz T007 passar)
- [x] T013 Implementar `packages/agent/src/tools/shared.ts`: chaves tipadas do `RequestContext` (`execucao`, `textoDaDona`, `resumo`, `pendente`, `coletor`), `execucaoDe(context)`, `semNulos` (movido de `define-tool.ts`, recursivo), `ColetorDoTurno` (entidades, `intencao?`, `propostaNova?`) e `emErroHumano(fn)` que transforma `AppError` em `erroHumano` e deixa outras exceções subirem
- [x] T014 Implementar `packages/agent/src/tools/read-tools.ts` com `createTool` do Mastra para as 11 tools de leitura listadas em T008, cada uma com o `inputSchema` atual de `@na-regua/contracts` e saída humanizada por `views.ts` (faz T008 passar)
- [x] T015 Implementar `packages/agent/src/instructions.ts` com a base das instruções em português: papel do Buddy na loja, nunca calcular dinheiro, consultar por ferramenta, nunca inventar dado, nunca exibir `ref`; exportar como função `instrucoes(): string`
- [x] T016 Atualizar `packages/agent/src/types.ts`: `AgentRuntime` passa a ter `brain: BuddyBrain` e perde `llm`, `tools`, `barcodeDecoder` e `findProductByBarcode`; adicionar `BuddyBrain` e o tipo de entrada e saída de `conversar` conforme `contracts/buddy-runtime.md` §2; remover `LlmPort`, `LlmDecision`, `ToolDescriptor` e `AgentTool`
- [x] T017 Implementar `packages/agent/src/buddy-brain.ts`: `createBuddyBrain({ model, useCases, confirmations, ttlMs, timeZone })` monta o `Agent` Mastra (`id: 'buddy'`, instruções de `instructions.ts`, tools de leitura); `conversar` cria o `RequestContext` com as chaves de `tools/shared.ts`, chama `agent.generate(mensagens, { maxSteps: 5, requestContext, system })` e devolve `{ texto, etapas: result.steps.length, snapshot, propostaNova? }`; `criarModeloReal(model)` isolada para a exclusão de cobertura (faz T009 passar)
- [x] T018 Reescrever `packages/agent/src/process-message.ts` como borda fina sobre `runtime.brain`: resolver contexto (peer ou sessão, como hoje), `chaveDaConversa`, `loadActive`, `montarResumoDeEntidades`, chamar `brain.conversar`, gravar o turno com `append` (`toolCalls` = snapshot), devolver `AgentReply`; remover `tratarFoto`, `tratarRascunhoFoto`, `proporVendaFoto`, `textoDasCapacidades`, `responderErro` e o fluxo `SIM`/`NAO` (faz T010 passar)
- [x] T019 Atualizar `packages/agent/src/create-runtime.ts` e `packages/agent/src/index.ts` para montar e exportar o runtime com `brain`; trocar o export `"./mastra"` de `packages/agent/package.json` para `./src/buddy-brain.ts`
- [x] T020 Reduzir `packages/agent/src/catalog.ts` ao tipo `AgentUseCases` e às constantes de recusa (`TEXTO_RECUSA_*`); apagar `createToolCatalog`, todos os `formatReply`/`formatProposal`, `listarCamposAlterados`, `formatarRespostaEstoque`, `formatarRespostaFiado` e `textoDasCapacidades`
- [x] T021 Apagar `packages/agent/src/fake-llm.ts`, `fake-llm.test.ts`, `mastra-llm.ts`, `mastra-llm.test.ts`, `define-tool.ts`, `photo-sale-draft.ts`, `photo-replies.ts`, `barcode-decoder.ts`, `barcode-decoder.test.ts`, `parse-payment-method.ts`, `parse-register-intent.ts` e `catalog.test.ts`; reescrever `packages/agent/src/create-runtime.test.ts` sobre `roteiroDoModelo`
- [x] T022 Atualizar `apps/api/src/composition.ts`: `buildAgentDeps` cria o runtime com `createBuddyBrain({ model: env.AGENT_MODEL, ... })` em vez de `createToolCatalog` + `createMastraLlm`; remover `findProductByBarcode` de `buildAgentUseCases` (o caso de uso continua em `core`)
- [x] T023 [P] Atualizar `apps/api/src/composition.test.ts` e `apps/api/src/studio.test.ts` para o runtime com `brain` e sem `findProductByBarcode`
- [x] T024 [P] Atualizar `apps/api/src/routes/agent.test.ts` e `apps/api/src/e2e/agent-mutations-nr117.test.ts` para injetar `roteiroDoModelo` no lugar de `FakeLlm`; casos de mutação ficam marcados para reescrita em US2/US3 (`it.todo` com o nome do cenário, sem `skip` de teste existente que ainda faça sentido)
- [x] T025 [P] Atualizar `packages/agent/src/studio/relay-agent.ts` e `relay-agent.test.ts` para o runtime com `brain`; o rele continua chamando `processMessage`

**Checkpoint**: `pnpm --filter @na-regua/agent test` e `pnpm --filter @na-regua/api test` verdes; uma consulta de estoque pelo laço novo responde a partir do dado real; `pnpm boundaries` verde (agent sem `db`/`domain`).

---

## Phase 3: User Story 1 - Ler respostas sem nada técnico (Priority: P1) 🎯 MVP

**Goal**: nenhuma resposta traz identificador interno, código de produto, nome de campo, nome de ferramenta ou centavos; respostas curtas no tom definido.

**Independent Test**: consulta de estoque, busca de produto e edição de preço sem nenhum termo técnico na resposta (spec US1).

### Testes da US1 (escrever primeiro, ver falhar)

- [x] T026 [P] [US1] Teste em `packages/agent/src/technical-terms.test.ts`: `contemTermoTecnico` detecta UUID, `PROD-0003`, id de tool (`list_sales`), chave de schema (`salePriceCents`, `unitPriceCents`), qualquer `camelCase` terminado em `Cents` e a palavra “centavo(s)”; não acusa texto comum com “R$ 25,00”; `limparTermosTecnicos` remove a frase ou o item de lista que contém o termo e preserva o resto
- [x] T027 [P] [US1] Teste em `packages/agent/src/buddy-brain.test.ts`: o modelo responde com UUID na etapa final → o processador `semTermoTecnico` pede uma reescrita (segunda resposta roteirizada sem UUID é a devolvida); se a segunda também tiver termo, `conversar` devolve o texto já limpo, sem o trecho
- [x] T028 [P] [US1] Teste em `packages/agent/src/tools/read-tools.test.ts`: `check_stock` de produto com `location` nula não devolve chave de localização (FR-006); `search_products` com dois produtos devolve `opcoes` com `rotulo` e preço em reais e o `ref` só no campo `ref`
- [x] T029 [P] [US1] Teste em `packages/agent/src/instructions.test.ts`: as instruções proíbem exibir `ref`, código interno, nome de campo, nome de ferramenta e centavos; fixam até 3 linhas na maioria das respostas, lista só com mais de 3 itens, no máximo 1 emoji, sem descrever o funcionamento interno e cumprimento só quando a dona cumprimentar

### Implementação da US1

- [x] T030 [US1] Implementar `packages/agent/src/technical-terms.ts`: `contemTermoTecnico`, `limparTermosTecnicos` e o processador `semTermoTecnico` (`processOutputStep`: com termo e `retryCount === 0`, `abort(feedback, { retry: true })`); a lista de ids e chaves proibidas é coletada das tools registradas (faz T026 passar)
- [x] T031 [US1] Registrar `semTermoTecnico` em `outputProcessors` do `Agent`, passar `maxProcessorRetries: 1` no `generate` e aplicar `limparTermosTecnicos` no texto final em `packages/agent/src/buddy-brain.ts` (faz T027 passar)
- [x] T032 [US1] Ajustar as visões de `check_stock` e `search_products` em `packages/agent/src/tools/read-tools.ts` (faz T028 passar)
- [x] T033 [US1] Acrescentar as regras de tom e de proibição em `packages/agent/src/instructions.ts` (faz T029 passar)
- [x] T034 [US1] Teste e implementação em `packages/agent/src/process-message.test.ts` / `process-message.ts`: o `body` gravado no histórico é o texto limpo, nunca o original com termo técnico
- [x] T035 [P] [US1] Conversa de avaliação “Consulta” (“quanto tem de café?”) em `packages/agent/eval/consulta.eval.ts`: resposta com nome, quantidade e preço em reais, `contemTermoTecnico` falso, até 3 linhas

**Checkpoint**: US1 testável sozinha; nenhuma resposta do laço novo carrega termo técnico.

---

## Phase 4: User Story 2 - Pedir o que falta numa só mensagem (Priority: P1)

**Goal**: o Buddy assume preço de tabela e quantidade 1, sempre pergunta a forma de pagamento, junta o que falta numa mensagem e cria a proposta só com dados completos.

**Independent Test**: “vende um café pro Pedro” pergunta só o pagamento e, depois, propõe 1 café ao preço de tabela (spec US2).

### Testes da US2 (escrever primeiro, ver falhar)

- [x] T036 [P] [US2] Teste em `packages/agent/src/tools/proposal-tools.test.ts` para `create_sale`: sem `payments` devolve `{ status: 'faltando', faltando: ['forma de pagamento'] }` e não chama `confirmations.put`; sem `quantity` e `unitPriceCents` usa 1 e o `salePriceCents` do produto, devolve `{ status: 'proposta', fatos, assumido: ['quantidade 1', 'preço de tabela R$ …'] }` e grava `PendingConfirmation` com `args` já validados por `createSaleInputSchema`, `summary` com os fatos e `expiresAt = now + 5 min`
- [x] T037 [P] [US2] Teste em `packages/agent/src/tools/proposal-tools.test.ts`: cliente ou produto citado com mais de um cadastro compatível devolve `{ status: 'varios', opcoes }` com `rotulo` (e telefone para clientes) e não cria proposta; `create_product` sem os obrigatórios devolve `faltando` com descrição, unidade, custo e preço de venda e um campo `opcionais`; preço de venda menor que o custo devolve `recusado` com a mensagem do schema
- [x] T038 [P] [US2] Teste em `packages/agent/src/tools/proposal-tools.test.ts` para as demais 13 tools de proposta (`create_customer`, `update_customer`, `mark_customer_deleted`, `update_product`, `mark_product_deleted`, `cancel_sale`, `create_payable`, `create_receivable`, `settle_payable`, `settle_receivable`, `adjust_stock`, `create_appointment`, `send_charge`): nenhuma chama caso de uso de gravação; todas gravam `PendingConfirmation` com `args` validados pelo schema de `contracts` e devolvem `fatos` sem nome de campo
- [x] T039 [P] [US2] Teste em `packages/agent/src/process-message.test.ts`: quando o brain devolve `propostaNova`, a resposta é `{ kind: 'confirmation', confirmationId }`; sem proposta, `answer`
- [x] T040 [P] [US2] Teste em `packages/agent/src/instructions.test.ts`: as instruções mandam assumir preço de tabela e quantidade 1, sempre perguntar a forma de pagamento, perguntar tudo o que falta numa única mensagem, listar opções pelo nome quando houver mais de uma, e mostrar na confirmação tudo o que foi assumido

### Implementação da US2

- [x] T041 [US2] Implementar `packages/agent/src/tools/proposal-tools.ts` com as 15 tools de proposta: entrada = schema de `contracts` passado por `semNulos` (para `create_sale`, uma versão com `quantity` e `unitPriceCents` opcionais por item, preenchida antes de validar com `createSaleInputSchema`); resolução de cliente e produto por `resolveCustomerId`/`resolveProductId` com `NOT_FOUND` → `nao_encontrado` e ambiguidade → `varios`; `confirmations.put` com `args`, `summary` e TTL; `coletor.propostaNova` preenchido; cada tool exporta também `executar(useCases, ctx, args)` usado depois pelo aceite (faz T036, T037, T038 passarem)
- [x] T042 [US2] Atualizar o envelope em `specs/013-buddy-conversa-natural/contracts/buddy-runtime.md` §4 com `{ status: 'faltando', faltando: string[], opcionais?: string[] }`
- [x] T043 [US2] Registrar as tools de proposta no `Agent` em `packages/agent/src/buddy-brain.ts` e mapear `coletor.propostaNova` para `kind: 'confirmation'` em `packages/agent/src/process-message.ts` (faz T039 passar)
- [x] T044 [US2] Acrescentar as regras de perguntar e assumir em `packages/agent/src/instructions.ts` (faz T040 passar)
- [x] T045 [US2] Teste e implementação em `packages/agent/src/buddy-brain.test.ts`: roteiro com `find_product` ausente → `create_sale` sem pagamento → texto de pergunta; nenhuma proposta; segundo roteiro com pagamento → proposta com `assumido`
- [x] T046 [P] [US2] Conversa de avaliação “Pedido incompleto” (“adicione café”) em `packages/agent/eval/pedido-incompleto.eval.ts`: pede numa única mensagem os obrigatórios e cita os opcionais; nenhum produto gravado

**Checkpoint**: US2 testável sozinha; venda incompleta nunca vira proposta e venda completa vira proposta com o assumido explícito.

---

## Phase 5: User Story 3 - Confirmar e corrigir falando normalmente (Priority: P1)

**Goal**: aceite por concordância pura grava os dados da proposta; dado novo ou ressalva vira nova proposta; recusa, prazo e mudança de assunto não gravam.

**Independent Test**: proposta de venda → “não, são 3” → nada gravado e nova proposta com 3 → “fechou” → venda gravada com 3 (spec US3).

### Testes da US3 (escrever primeiro, ver falhar)

- [x] T047 [P] [US3] Teste em `packages/agent/src/acceptance-guard.test.ts` de `ehConcordanciaPura(texto, resumo)`: verdadeiro para `sim`, `pode`, `fechou`, `isso aí`, `manda ver`, `confirmo`, `ok`, `👍`; falso com dígito, `R$`/`reais`, forma de pagamento (`pix`, `dinheiro`, `débito`, `crédito`, `cartão`, `fiado`), `rotulo` de entidade do resumo, ressalva (`mas`, `porém`, `né`, `acho`, `será`, `talvez`, `não`, `troca`, `muda`), `?` ou mais de 6 palavras; comparação sem acento e sem caixa
- [x] T048 [P] [US3] Teste em `packages/agent/src/tools/acceptance-tools.test.ts` de `accept_proposal` com `InMemoryConfirmations` e `loja-de-teste`: concordância pura → `resolve('accepted')`, `executar` da tool da proposta com os `args` guardados e `ctx.idempotencyKey = 'confirmation:{id}'`, retorno `{ status: 'gravado', fatos }` com o que o caso de uso devolveu; texto com ressalva (lido de `requestContext.textoDaDona`, não de argumento) → `{ status: 'nao_e_aceite' }` e nenhuma gravação; proposta vencida → `resolve('expired')` e `{ status: 'expirada' }`; perfil `accountant` → `recusado` e nenhuma gravação; `AppError` do caso de uso → `recusado` com mensagem humana
- [x] T049 [P] [US3] Teste em `packages/agent/src/tools/acceptance-tools.test.ts`: o mesmo aceite executado duas vezes produz um único registro (idempotência por `confirmation:{id}`); `cancel_proposal` resolve `rejected` e devolve `{ status: 'cancelada' }`
- [x] T050 [P] [US3] Teste em `packages/agent/src/buddy-brain.test.ts`: sem pendente, `accept_proposal` e `cancel_proposal` não estão em `activeTools`; com pendente, estão, e a mensagem de sistema traz os fatos da proposta pendente; nova proposta no mesmo turno substitui a pendente (`put` encerra a anterior como `rejected`)
- [x] T051 [P] [US3] Teste em `packages/agent/src/process-message.test.ts`: pendente vencida antes de chamar o brain → `resolve('expired')` e o fato “proposta venceu” vai ao brain; pendente aberta e o brain termina sem `accept_proposal`, sem `cancel_proposal` e sem nova proposta → `resolve('rejected')` ao fim da mensagem (mudança de assunto)
- [x] T052 [P] [US3] Reescrever `apps/api/src/e2e/agent-confirmation-restart.test.ts` com `roteiroDoModelo`: proposta gravada no Postgres, processo novo, “fechou” aceita a pendente do banco e grava uma vez; “pode, mas no pix” não grava

### Implementação da US3

- [x] T053 [US3] Implementar `packages/agent/src/acceptance-guard.ts` (faz T047 passar)
- [x] T054 [US3] Implementar `packages/agent/src/tools/acceptance-tools.ts` com `accept_proposal` e `cancel_proposal`; a trava roda antes de qualquer gravação e usa `executar` exportado por `proposal-tools.ts` (faz T048, T049 passarem)
- [x] T055 [US3] Em `packages/agent/src/buddy-brain.ts`, registrar as tools de aceite, passar `activeTools` conforme exista pendente e incluir a proposta pendente na mensagem de sistema (faz T050 passar)
- [x] T056 [US3] Em `packages/agent/src/process-message.ts`, tratar pendente vencida e rejeitar a pendente em mudança de assunto (faz T051 passar)
- [x] T057 [US3] Em `apps/api/src/composition.ts`, garantir que `registerSale` e as demais gravações com chave de idempotência usem `ctx.idempotencyKey` quando presente (hoje `agent:${ctx.requestId}` é o fallback); concluir T052 e trocar os `it.todo` de mutação de T024 em `apps/api/src/routes/agent.test.ts` e `apps/api/src/e2e/agent-mutations-nr117.test.ts` por testes reais com proposta e aceite
- [x] T058 [US3] Acrescentar em `packages/agent/src/instructions.ts`: chamar `accept_proposal` só quando a dona concordar, refazer a proposta quando ela corrigir, `cancel_proposal` quando recusar, e descrever na mensagem final o que de fato foi gravado
- [x] T059 [P] [US3] Conversa de avaliação “Correção” em `packages/agent/eval/correcao.eval.ts`: proposta de 1 café → “não, são 3” → nada gravado e nova proposta com 3 → “fechou” → venda gravada com 3

**Checkpoint**: P1 completo (US1 a US3). Nenhuma resposta com dado novo ou ressalva grava.

---

## Phase 6: User Story 4 - Ser entendida pelo que acabou de dizer (Priority: P2)

**Goal**: “ele”, “esse café” e “a venda de agora” resolvidos pelo resumo de entidades; corte de 2 h zera; nada vaza entre empresas.

**Independent Test**: citar um cliente e mandar “ele quer comprar 2 cafés”; repetir após 2 h paradas (spec US4).

### Testes da US4 (escrever primeiro, ver falhar)

- [x] T060 [P] [US4] Teste em `packages/agent/src/process-message.test.ts` com `InMemoryConversationStore`: turno 1 consulta o João (snapshot com `{ tipo: 'cliente', ref, rotulo: 'João' }`); no turno 2 o brain recebe um resumo com o João; depois de 2 h sem mensagem, o resumo chega vazio
- [x] T061 [P] [US4] Teste em `packages/agent/src/buddy-brain.test.ts`: a mensagem de sistema do turno 2 contém o `rotulo` e o `ref` do João; um roteiro que chama `create_sale` com `customerId` = esse `ref` cria a proposta para o João sem nova busca
- [x] T062 [P] [US4] Teste de isolamento em `packages/agent/src/process-message.test.ts`: conversa da empresa B nunca recebe entidade da empresa A no resumo e nenhuma tool da B lê dado da A, mesmo com o mesmo peer
- [x] T063 [P] [US4] Teste em `packages/agent/src/instructions.test.ts`: as instruções mandam usar o resumo para resolver referências e nunca perguntar o que já foi dito na conversa ativa (FR-027)

### Implementação da US4

- [x] T064 [US4] Garantir que leitura, proposta e aceite registrem no coletor todas as entidades tocadas com `ref` e `rotulo` em `packages/agent/src/tools/read-tools.ts`, `proposal-tools.ts` e `acceptance-tools.ts`, e que `resolveCustomerId`/`resolveProductId` aceitem o `ref` vindo do resumo (faz T060, T061 passarem)
- [x] T065 [US4] Revisar o isolamento em `packages/agent/src/process-message.ts`: resumo montado só da janela da própria `conversationKey` e `ExecutionContext` sempre do peer/sessão (faz T062 passar)
- [x] T066 [US4] Acrescentar as regras de referência em `packages/agent/src/instructions.ts` (faz T063 passar)
- [x] T067 [P] [US4] Conversa de avaliação “Referência” em `packages/agent/eval/referencia.eval.ts`: cita o João e depois “ele quer comprar 2 cafés”; o Buddy segue a venda para o João sem pedir o nome

**Checkpoint**: US4 testável sozinha sobre US1 a US3.

---

## Phase 7: User Story 5 - Cadastrar no meio do pedido sem recomeçar (Priority: P2)

**Goal**: cliente ou produto inexistente leva à oferta de cadastro (ou de seguir sem cliente) e, depois do cadastro aceito, a venda é retomada sozinha.

**Independent Test**: sem João cadastrado, “O João quer comprar café” → aceitar o cadastro → venda retomada sem repetir (spec US5).

### Testes da US5 (escrever primeiro, ver falhar)

- [x] T068 [P] [US5] Teste em `packages/agent/src/tools/read-tools.test.ts` das novas `find_customer` e `find_product`: `nao_encontrado` com o termo procurado; `varios` com opções; `ok` com `ref` e `rotulo`
- [x] T069 [P] [US5] Teste em `packages/agent/src/tools/proposal-tools.test.ts`: `create_customer` e `create_product` aceitam o campo do agente `paraRetomar: { acao, descricao, jaDito }`, que é removido antes da validação de `contracts` e vira `coletor.intencao` com `aguardando: 'cadastro_cliente' | 'cadastro_produto'`; uma segunda tool de proposta no mesmo turno devolve `{ status: 'ja_tem_proposta' }` e não chama `put` (FR-019)
- [x] T070 [P] [US5] Teste em `packages/agent/src/tools/acceptance-tools.test.ts`: aceite de cadastro de cliente com `duplicate_found` devolve `{ status: 'parecido', opcoes }` sem criar outro; aceite de cadastro com intenção aberta devolve `gravado` mais a intenção a retomar, e a entidade criada entra no coletor
- [x] T071 [P] [US5] Teste em `packages/agent/src/buddy-brain.test.ts` do caso do João em um turno de aceite: roteiro `accept_proposal` (cadastro) → `find_product` → `create_sale` sem pagamento → texto perguntando o pagamento; o snapshot encerra a intenção de cadastro e abre `aguardando: 'dados'`
- [x] T072 [P] [US5] Teste em `packages/agent/src/instructions.test.ts`: as instruções mandam oferecer cadastrar (só o nome basta) ou registrar sem cliente, nunca oferecer “sem cliente” no fiado, oferecer cadastro de produto com os obrigatórios, propor uma gravação por vez e retomar a intenção depois do cadastro

### Implementação da US5

- [x] T073 [US5] Implementar `find_customer` e `find_product` em `packages/agent/src/tools/read-tools.ts` sobre `searchCustomers`/`searchProducts` de `AgentUseCases` (faz T068 passar)
- [x] T074 [US5] Implementar `paraRetomar` e `ja_tem_proposta` em `packages/agent/src/tools/proposal-tools.ts` (faz T069 passar)
- [x] T075 [US5] Implementar `parecido` e o retorno da intenção a retomar em `packages/agent/src/tools/acceptance-tools.ts` (faz T070, T071 passarem)
- [x] T076 [US5] Atualizar `specs/013-buddy-conversa-natural/contracts/buddy-runtime.md` §4 e §5 com `paraRetomar`, `ja_tem_proposta`, `parecido` e as tools `find_*`
- [x] T077 [US5] Acrescentar as regras de entidade inexistente e retomada em `packages/agent/src/instructions.ts` (faz T072 passar)
- [x] T078 [P] [US5] Conversa de avaliação “Caso do João” em `packages/agent/eval/caso-do-joao.eval.ts`, completa como em `quickstart.md` §2.1; asserção de SC-005 (no máximo 4 mensagens da dona depois do pedido inicial)

**Checkpoint**: o caso do teste manual funciona de ponta a ponta com o modelo dublê.

---

## Phase 8: User Story 6 - Ouvir “não” e “deu errado” com naturalidade (Priority: P3)

**Goal**: fora do escopo, recusas e erros de regra redigidos no mesmo tom; falha inesperada com frase fixa.

**Independent Test**: “me conta uma piada”, “importa meu extrato” e produto com preço abaixo do custo (spec US6).

### Testes da US6 (escrever primeiro, ver falhar)

- [x] T079 [P] [US6] Teste em `packages/agent/src/tools/refusal-tools.test.ts`: `refuse_certificate`, `refuse_banking`, `refuse_invoice_command` e `refuse_delete_account_or_contact` devolvem `{ status: 'regra', mensagem }` com a regra das constantes `TEXTO_RECUSA_*` e não chamam caso de uso
- [x] T080 [P] [US6] Teste em `packages/agent/src/process-message.test.ts`: `brain.conversar` lança (provedor fora) → `answer` com a frase fixa de falha no tom novo, nada gravado e nenhuma pendente criada; o turno é gravado com essa frase
- [x] T081 [P] [US6] Teste em `packages/agent/src/instructions.test.ts`: fora do escopo diz que não faz e dá até 3 exemplos do que faz, em palavras comuns; erro de regra é explicado com o que ajustar e nunca como sucesso

### Implementação da US6

- [x] T082 [US6] Implementar `packages/agent/src/tools/refusal-tools.ts` e registrar no `Agent` em `packages/agent/src/buddy-brain.ts` (faz T079 passar)
- [x] T083 [US6] Implementar o `try/catch` em volta de `brain.conversar` com a frase fixa em `packages/agent/src/process-message.ts` (faz T080 passar)
- [x] T084 [US6] Acrescentar as regras de fora do escopo e de erro em `packages/agent/src/instructions.ts` (faz T081 passar)
- [x] T085 [P] [US6] Conversas de avaliação “Fora do escopo”, “Recusa” e “Erro de regra” em `packages/agent/eval/nao-e-erro.eval.ts`

**Checkpoint**: nenhuma saída fora do caminho feliz lista ferramentas ou cola mensagem técnica.

---

## Phase 9: User Story 7 - Mesmo Buddy em todo canal, sem travar (Priority: P3)

**Goal**: limite de 5 etapas com saída elegante, foto com pedido de texto, uso de IA por etapa e o mesmo comportamento em todos os canais.

**Independent Test**: mesma conversa no WhatsApp, no app e no Studio; pedido que exigiria 6 etapas (spec US7).

### Testes da US7 (escrever primeiro, ver falhar)

- [x] T086 [P] [US7] Teste em `packages/agent/src/buddy-brain.test.ts`: roteiro com 4 etapas de tool → na quinta, o modelo recebe `toolChoice: 'none'` e a instrução de saída elegante (verificar em `doGenerateCalls[4]`); nenhuma sexta chamada; nada gravado sem proposta e aceite
- [x] T087 [P] [US7] Teste em `packages/agent/src/process-message.test.ts`: `input.image` presente → `answer` com o pedido de texto, brain não chamado; `aiUsage.record` recebe `etapas`; sem `budgetCents`, `isOverBudget` nunca bloqueia
- [x] T088 [P] [US7] Teste de paridade em `packages/agent/src/process-message.test.ts`: a mesma conversa roteirizada por canal `whatsapp` (peer), `app` (sessão) e pelo rele do Studio produz a mesma sequência de tools e o mesmo `kind`
- [x] T089 [P] [US7] Teste em `apps/api/src/routes/agent.test.ts`: corpo só com imagem devolve o pedido de texto; e em `apps/api/src/routes/whatsapp-webhook.test.ts`, regressão de que o “digitando” continua sendo renovado durante uma resposta demorada

### Implementação da US7

- [x] T090 [US7] Implementar `prepareStep` em `packages/agent/src/buddy-brain.ts` (na quinta etapa, `toolChoice: 'none'` e mensagem de sistema de saída elegante) (faz T086 passar)
- [x] T091 [US7] Em `packages/agent/src/process-message.ts`, responder foto com `FRASE_PEDIDO_DE_TEXTO` (mover a constante para `packages/agent/src/catalog.ts` e reexportar no webhook em `apps/api/src/routes/whatsapp-webhook.ts`) e registrar `aiUsage.record(companyId, now, etapas)` (faz T087, T089 passarem)
- [x] T092 [US7] Ajustar o comentário e o contrato de `AiUsageCounter` em `packages/agent/src/ai-usage.ts`: uma unidade por etapa de modelo; teto opcional, desligado por padrão (FR-039, FR-040)
- [x] T093 [US7] Corrigir o que a paridade de T088 apontar em `packages/agent/src/process-message.ts` ou `packages/agent/src/studio/relay-agent.ts`

**Checkpoint**: todas as histórias funcionais.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [x] T094 [P] Revisão parcial na `docs/decisoes/adr/0010-mastra-e-gpt-4o-mini.md`: modelo padrão `openai/gpt-5.4-mini`, laço de até 5 etapas com consultas no laço, gravação por proposta e `accept_proposal`; HITL do Mastra continua desligado
- [x] T095 [P] Nota na `docs/decisoes/adr/0016-memoria-da-conversa-tabelas-nossas.md`: resumo de entidades derivado do snapshot v2 em `messages.tool_calls`, sem tabela nova e sem Memory do Mastra
- [x] T096 [P] Atualizar `docs/arquitetura/integracoes/mastra.md` e `packages/agent/README.md` (“Como o laço gira”, tools, trava do aceite, termos técnicos, avaliação)
- [x] T097 [P] Reescrever `docs/qa/buddy-roteiro-de-prompts.md` como índice das conversas de `packages/agent/eval/`, com a coluna de conferência no banco e na web
- [x] T098 [P] Atualizar `docs/processo/task-ledger.md` com a NR da fatia e o vínculo aos RF/RNF da spec
- [x] T099 Rodar as conversas de `packages/agent/eval/` com `pnpm --filter @na-regua/agent eval` e `AGENT_MODEL=openai/gpt-5.4-mini`, conferir SC-001 a SC-007 e SC-009 e anexar a transcrição ao PR
- [ ] T100 Repetir o teste manual do `quickstart.md` §3 no WhatsApp (casos João, referência e correção) e conferir a venda e o cliente na web
- [x] T101 Na raiz do repositório (`package.json`), rodar `pnpm format:check`, `pnpm boundaries`, `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build`; corrigir o que falhar antes do PR

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sem dependência.
- **Foundational (Fase 2)**: depende da Fase 1. Bloqueia todas as histórias. Dentro dela: T006–T010 antes de T011–T018; T016 antes de T017; T017 e T018 antes de T019–T025; T021 só depois de T018 (o laço novo precisa existir antes de apagar o antigo).
- **US1 (Fase 3)**: depende só da Fase 2.
- **US2 (Fase 4)**: depende da Fase 2. Independente da US1 em código; as duas tocam `instructions.ts` e `buddy-brain.ts`, então rodam em sequência se for uma pessoa.
- **US3 (Fase 5)**: depende da US2 (o aceite executa o `executar` das tools de proposta).
- **US4 (Fase 6)**: depende da Fase 2; o teste de venda por referência (T061) depende da US2.
- **US5 (Fase 7)**: depende da US3 (retomada acontece no turno de aceite) e da US4 (intenção no resumo).
- **US6 (Fase 8)**: depende só da Fase 2.
- **US7 (Fase 9)**: depende da Fase 2; a paridade (T088) fica mais útil depois da US3.
- **Polish (Fase 10)**: depende das histórias escolhidas.

### User Story Dependencies

```text
Fase 2 ──► US1
      ├──► US2 ──► US3 ──┐
      ├──► US4 ──────────┴──► US5
      ├──► US6
      └──► US7
```

### Within Each User Story

- Testes primeiro e falhando.
- Unidades puras (guarda, termos, visões) antes das tools; tools antes do `buddy-brain.ts`; brain antes do `process-message.ts`; composição em `apps/api` por último.
- `instructions.ts` é editado em várias histórias: cada edição acrescenta a seção da história, sem reescrever as anteriores.

### Parallel Opportunities

- Fase 1: T002, T003, T004, T005 em paralelo depois de T001.
- Fase 2: T006, T007, T008, T009 em paralelo; T011 e T012 em paralelo; T023, T024, T025 em paralelo.
- US1, US4 (exceto T061), US6 e US7 podem andar em paralelo depois da Fase 2, com cuidado em `instructions.ts` e `buddy-brain.ts`.
- Dentro de cada história, todos os testes marcados [P].
- Fase 10: T094 a T098 em paralelo.

---

## Parallel Example: User Story 1

```bash
# Testes da US1 juntos:
Task: "Teste de contemTermoTecnico/limparTermosTecnicos em packages/agent/src/technical-terms.test.ts"
Task: "Teste do retry de saída em packages/agent/src/buddy-brain.test.ts"
Task: "Teste das visões de check_stock e search_products em packages/agent/src/tools/read-tools.test.ts"
Task: "Teste das regras de tom em packages/agent/src/instructions.test.ts"
```

## Parallel Example: User Story 3

```bash
Task: "Teste de ehConcordanciaPura em packages/agent/src/acceptance-guard.test.ts"
Task: "Teste de accept_proposal em packages/agent/src/tools/acceptance-tools.test.ts"
Task: "Reescrever apps/api/src/e2e/agent-confirmation-restart.test.ts com roteiroDoModelo"
```

---

## Implementation Strategy

### MVP First

1. Fases 1 e 2: laço novo com consultas, laço antigo apagado.
2. Fase 3 (US1): nada técnico na tela.
3. **Parar e validar**: consulta de estoque e busca sem termo técnico (T035).

O MVP de valor para a dona é P1 completo (US1 a US3): sem termos técnicos, perguntas numa só mensagem e confirmação natural com trava. Sem a US2 e a US3, o laço novo não grava nada.

### Incremental Delivery

1. Fundação + US1 → consultas humanas.
2. - US2 → propostas com o assumido explícito.
3. - US3 → aceite e correção naturais. **Liberação P1.**
4. - US4 + US5 → contexto e caso do João.
5. - US6 + US7 → recusas, falhas, limites e paridade.
6. Polish → docs, avaliação com modelo real, portões de CI.

### Parallel Team Strategy

Depois da Fase 2: uma pessoa em US2 → US3 → US5; outra em US1 → US4; outra em US6 → US7. Conflitos esperados em `instructions.ts` e `buddy-brain.ts`: resolver por seção.

---

## Notes

- [P] = arquivos diferentes, sem dependência pendente.
- Teste que só verifica chamada não é aceito (constitution V): verificar o que foi gravado e o que a dona leu.
- Nenhuma tarefa altera schema de `@na-regua/contracts`.
- Commits pequenos por tarefa ou grupo lógico; `pnpm format:check` antes de qualquer push.
