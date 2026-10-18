# Research: Buddy com conversa natural

**Feature**: [spec.md](./spec.md) · **PRD**: [feature-buddy-conversa-natural.md](../../docs/prd/feature-buddy-conversa-natural.md)

Fontes verificadas: docs embutidas do `@mastra/core` 1.70.0
(`packages/agent/node_modules/@mastra/core/dist/docs/references/`), tipos em
`dist/processors/index.d.ts` e `dist/loop/types.d.ts`, e o código atual de
`packages/agent`, `apps/api` e `packages/core/src/ports`.

---

## 1. Causa raiz do comportamento “robotizado”

**Decision**: tratar a arquitetura como a causa, não o prompt.

**Rationale**: o laço atual chama `agent.generate(texto, { maxSteps: 1 })`. As
tools registradas no Mastra são identidade (`execute: async (input) => input`),
então o modelo nunca vê o resultado da consulta. Quem escreve a resposta é
`formatReply`/`formatProposal` em `catalog.ts`, com identificador interno
(`${p.description} (${p.id})`), nome de campo (`listarCamposAlterados`) e
campo vazio (“Localizacao indisponivel”). A decisão sobre o que fazer em
seguida (cliente inexistente → oferecer cadastro) também não existe, porque o
laço termina depois de uma ferramenta.

**Alternatives considered**: reescrever templates e prompt mantendo uma etapa
(rejeitado no PRD: continua sem raciocínio em várias etapas).

---

## 2. Laço do agente

**Decision**: um único `Agent` Mastra (`buddy`) chamado com
`agent.generate(mensagens, opções)` por mensagem recebida, com:

- `maxSteps: 5` (FR-036);
- `prepareStep`: na quinta etapa, força `toolChoice: 'none'` e acrescenta uma
  instrução de sistema para o modelo dizer o que entendeu e perguntar como
  seguir (saída elegante, sem sexta chamada);
- `requestContext` com o `ExecutionContext` resolvido pelo nosso código
  (empresa, usuário, papel, canal, `requestId`, `now`), o texto atual da dona
  e o estado da conversa;
- `system` por mensagem com a data da loja, o resumo de entidades e a
  proposta pendente (se houver);
- `outputProcessors: [semTermoTecnico]` com `maxProcessorRetries: 1`.

`processMessage` continua sendo a borda: resolve identidade, carrega histórico,
chama o agente, limpa a saída, grava o turno e devolve `AgentReply`.

**Rationale**: `generate()` aceita `CoreMessage[]`, `maxSteps`, `stopWhen`,
`prepareStep`, `requestContext`, `system` e `maxProcessorRetries`
(`reference-agents-generate.md`). `ProcessInputStepResult` aceita
`toolChoice`, `activeTools` e `systemMessages` (`processors/index.d.ts`), o que
permite fechar a última etapa sem ferramenta. O `RequestContext` não vai para o
prompt (`docs-guides-agent-lifecycle.md`), então a identidade da empresa
nunca é decidida pelo modelo.

**Alternatives considered**:

- `stopWhen` em 5 etapas e uma segunda chamada com `toolChoice: 'none'`:
  rejeitado, gera uma sexta chamada e mais latência.
- `stream()`: rejeitado nesta fatia; o WhatsApp envia a resposta inteira
  depois do “digitando” (spec 011), e o chat do app já espera o corpo inteiro.
- Supervisor com subagentes: rejeitado por YAGNI; um agente com as tools atuais
  cobre os fluxos.

---

## 3. Consultas executam dentro do laço

**Decision**: as tools de leitura (`list_sales`, `check_stock`,
`check_customer_wallet`, `search_products`, `period_summary`,
`revenue_by_month`, `list_payables`, `list_receivables`, `day_agenda`,
`rank_customers`, `rank_products`, além de duas novas, `find_customer` e
`find_product`) executam o caso de uso de `core` dentro do `execute` da tool
Mastra, lendo o `ExecutionContext` de `context.requestContext`. O retorno ao
modelo é uma **visão humanizada** (ver §6), não o objeto do caso de uso.

**Rationale**: princípio I da constitution: a tool só valida com `contracts`,
monta o contexto e chama `core`. O que muda é onde o resultado vai: antes para
um template, agora para o modelo. `find_customer` e `find_product` existem para
o modelo descobrir, antes de propor, se a entidade existe (FR-028, FR-029) e
se há mais de uma (FR-010).

**Alternatives considered**: deixar a resolução só dentro das tools de
gravação (como `resolveCustomerRef` hoje): rejeitado, o modelo só saberia que o
cliente não existe depois de montar a venda inteira.

---

## 4. Gravação: proposta, aceite e trava

**Decision**:

1. **Tools de gravação propõem, não gravam.** `create_customer`,
   `create_sale`, `create_product`, `update_customer`, `update_product`,
   `create_payable`, `create_receivable`, `settle_payable`,
   `settle_receivable`, `adjust_stock`, `cancel_sale`,
   `mark_customer_deleted`, `mark_product_deleted`, `create_appointment` e
   `send_charge` validam a entrada com o schema de `contracts`, resolvem
   cliente e produto por nome ou referência, e então gravam uma
   `PendingConfirmation` no `ConfirmationStore` já existente. O retorno ao
   modelo traz os fatos humanizados da proposta, para ele redigir a
   confirmação (FR-014). `put()` já encerra a pendente anterior da mesma
   conversa como `rejected`, o que implementa a correção (FR-016) e a regra
   de uma pendente por vez (FR-019).
2. **Duas tools novas, ativas só com proposta pendente:** `accept_proposal` e
   `cancel_proposal`.
3. **A trava fica no `execute` de `accept_proposal`**, em código
   determinístico, antes de qualquer gravação:
   - proposta vencida (`expiresAt <= now`): resolve `expired`, devolve
     `{ status: 'expirada' }`;
   - a mensagem atual da dona (lida do `requestContext`, nunca de argumento do
     modelo) traz dado novo ou ressalva: devolve
     `{ status: 'nao_e_aceite' }` e não grava;
   - caso contrário: resolve `accepted`, executa o caso de uso com os `args`
     guardados e `idempotencyKey = confirmation:${id}`, e devolve os fatos do
     que foi gravado (FR-020).
4. **Definição operacional de “concordância pura”** (função
   `ehConcordanciaPura`): sem dígito, sem valor monetário, sem forma de
   pagamento, sem nome de cliente ou produto presente no resumo de entidades,
   sem palavra de ressalva (`mas`, `porém`, `né`, `acho`, `será`, `talvez`,
   `não`, `?`), e com até 6 palavras. Emoji de aprovação conta como
   concordância. A lista e o limite de palavras são parâmetros testados, não
   texto no prompt.

**Rationale**: o PRD aceitou que o modelo interprete o aceite e escreva a
confirmação sem checagem de fatos. A trava é a única barreira de código entre
a interpretação e o banco, então precisa ser determinística, viver fora do
alcance do modelo (o texto vem do `requestContext`) e ter teste próprio. Os
`args` gravados são os da proposta (FR-013). A chave de idempotência derivada
da confirmação é mais estável que `agent:${requestId}`, que muda a cada
requisição HTTP.

**Alternatives considered**:

- `requireApproval` / `suspend()` do Mastra: rejeitado. Exige storage do
  Mastra para snapshots, o que reabre a ADR-0010 e a ADR-0016
  (`docs-agents-human-in-the-loop.md`).
- `hooks.beforeToolCall` para a trava: viável, mas espalha a regra; dentro do
  `execute` ela fica junto da gravação e é testada no mesmo lugar.
- Aceite só por lista fixa: rejeitado pelo PRD (decisão do aceite pelo modelo).

---

## 5. Contexto da conversa e resumo de entidades

**Decision**: sem migração. O resumo de entidades é derivado do jsonb
`tool_calls` das mensagens da janela ativa (até 12, corte de 2 h), que o
`ConversationStore` já devolve. Cada turno do Buddy grava em `toolCalls` um
**snapshot versionado** (`v: 2`) com as entidades tocadas no turno e a
intenção em andamento. O resumo enviado ao modelo é a união das entidades da
janela (a mais recente vence) e a intenção do snapshot mais recente. Como a
janela some com o corte de inatividade (`idle === true` → `messages: []`), o
resumo zera junto (FR-025).

As mensagens da janela vão ao `generate()` como `CoreMessage[]`
(`{ role, content }`), e não mais como prefixo de texto.

**Rationale**: a ADR-0016 já autoriza ids resolvidos em metadado da mensagem
ou em `tool_calls`. A janela por contagem já existe, e o isolamento por empresa
vem do RLS da tabela `messages`. Nada de Memory do Mastra.

**Alternatives considered**:

- Tabela nova para o resumo: rejeitado; duplicaria o corte de inatividade e o
  expurgo de 30 dias.
- Working memory do Mastra: rejeitado na entrevista (exige reabrir a ADR-0016).

---

## 6. Nada técnico na tela (três camadas)

**Decision**:

1. **Visões humanizadas** (`views.ts`): cada tool devolve ao modelo um objeto
   com rótulos em português, valores já formatados em reais (pelo
   `formatarCentavos` existente, sobre `@na-regua/money`), pagamento em
   português e só os campos com valor (FR-006). A referência interna aparece
   num campo `ref`, usado pelo modelo nas chamadas seguintes e proibido na
   resposta.
2. **Instrução** (`instructions.ts`): nunca exibir `ref`, código interno, nome
   de campo, nome de ferramenta ou centavos.
3. **Processador de saída** `semTermoTecnico`:
   - `processOutputStep`: se o texto da etapa final contiver termo proibido,
     `abort(feedback, { retry: true })`, com `maxProcessorRetries: 1`;
   - depois do `generate()`, `limparTermosTecnicos(texto)` em código nosso
     remove o que ainda sobrar (FR-004).

Termos detectados: UUID; código interno de produto (padrão `PROD-\d+`);
`camelCase` e `snake_case` que coincidam com chaves dos schemas das tools ou
com ids de tools; a palavra “centavo”; número inteiro colado a chave terminada
em `Cents`.

**Rationale**: o retry de saída é nativo (`docs-agents-processors.md`,
“Retry mechanism”) e exige `maxProcessorRetries` explícito. A limpeza final
fica em código nosso para ser determinística e testável, inclusive quando o
retry também falha.

**Alternatives considered**: apelidos curtos no lugar do UUID (rejeitado na
entrevista); só instrução (rejeitado: não garante FR-002).

---

## 7. Fora do escopo, recusas e falha

**Decision**: o pedido fora do escopo é tratado pela instrução (o modelo
responde sem ferramenta, com até 3 exemplos em palavras comuns). As
`refuse_*` continuam como tools que devolvem a regra; o modelo redige.
`AppError` dentro de uma tool vira `{ status: 'recusado', mensagem }` com a
`message` humana do `AppError` (sem `fields[].path`). Qualquer exceção fora de
tool, ou do próprio `generate()` (provedor fora, timeout), cai num `catch` em
`processMessage` que devolve a frase fixa existente (`Nao deu para concluir…`,
revisada para o tom novo) sem gravar (FR-035).

`textoDasCapacidades`, que lista ids de tools, é apagado.

---

## 8. Formato de `AgentReply`

**Decision**: o contrato `AgentReply` de `@na-regua/contracts` não muda. O
laço passa a emitir `confirmation` (com `confirmationId`) quando a mensagem
terminou com proposta pendente nova, `answer` nos demais casos e `ignored`
para peer não vinculado. `clarify` e `unknown` continuam no enum, mas deixam de
ser emitidos.

**Rationale**: o PRD não pede mudança na API. Mudar `contracts` exige revisão
das três trilhas (constitution II); não há ganho para a dona.

---

## 9. Foto

**Decision**: `processMessage` responde a qualquer `input.image` com
`FRASE_PEDIDO_DE_TEXTO` (a mesma do webhook para mídia), sem chamar o modelo.
São apagados: `tratarFoto`, `tratarRascunhoFoto`, `photo-sale-draft.ts`,
`photo-replies.ts`, `barcode-decoder.ts`, `parse-payment-method.ts`,
`parse-register-intent.ts`, os campos `barcodeDecoder` e
`findProductByBarcode` de `AgentRuntime` e sua composição em `apps/api`. O
schema `agentMessageInputSchema` continua aceitando `image` (sem mudar
`contracts`).

---

## 10. Teto de IA

**Decision**: mantém `AiUsageCounter` e `AGENT_MONTHLY_BUDGET_CENTS`. Sem a
variável, `isOverBudget` já devolve `false` (comportamento atual). O registro
passa de 1 por mensagem para `result.steps.length` por mensagem (FR-039).

---

## 11. Modelo

**Decision**: default de `AGENT_MODEL` passa de `openai/gpt-4o-mini` para
`openai/gpt-5.4-mini` em `packages/env/src/api.ts` e `.env.example`. O id
consta no `provider-registry.json` do `@mastra/core` 1.70.0 instalado. A
ADR-0010 recebe revisão parcial (modelo e laço); ela mesma diz que trocar a
string do modelo não a reabre.

**Nota**: o `.env` local de quem testou aponta para `openai/gpt-4`; o
quickstart pede para atualizar.

---

## 12. Testes

**Decision**: duas camadas.

- **CI determinística** com `MastraLanguageModelV2Mock`
  (`@mastra/core/test-utils/llm-mock`), injetado no `Agent` real. O mock
  aceita uma lista de respostas de `doGenerate`, uma por etapa (chamada de
  tool, depois texto), o que exercita o laço de várias etapas sem rede. Casos
  de unidade puros para `ehConcordanciaPura`, `limparTermosTecnicos`,
  `montarResumoDeEntidades` e as visões. Fakes em memória já existentes
  (`InMemoryConfirmations`, `InMemoryConversationStore`) para o laço.
- **Avaliação com o modelo real**: arquivos `*.eval.ts` em
  `packages/agent/eval/`, fora do `pnpm test`, rodados por
  `pnpm --filter @na-regua/agent eval` com `OPENAI_API_KEY`. Cada caso é uma
  conversa de várias mensagens sobre uma loja em memória, com asserções
  determinísticas (sem termo técnico, até 3 linhas, perguntou o pagamento,
  retomou depois do cadastro, nada gravou sem aceite) e a transcrição salva
  para revisão humana do tom. Bloqueia a liberação, não o PR.

`fake-llm.ts`, `mastra-llm.ts` e os testes que dependem de
`FakeLlm.script()` são apagados e reescritos, não adaptados.

**Rationale**: o mock do próprio Mastra exercita o `Agent` real (processors,
`prepareStep`, `requestContext`), o que um dublê nosso não faria. A avaliação
com modelo real fica fora da CI para não tornar cada PR caro e instável.

**Alternatives considered**: Mastra datasets/experiments/scorers. Viável, mas
traz storage e Studio para o fluxo de avaliação; uma suíte Vitest separada
cobre o critério com menos peças. Pode migrar depois sem mudar os casos.
