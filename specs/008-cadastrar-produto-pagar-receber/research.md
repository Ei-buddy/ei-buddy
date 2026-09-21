# Research: NR-117

**Date**: 2026-09-21  
**Spec**: [spec.md](./spec.md)

## 1. Onde vive a mutação (tools já no catálogo)

**Decision**: reutilizar as tools `create_product`, `create_payable` e
`create_receivable` em `packages/agent/src/catalog.ts`, ligadas a
`registerProduct`, `createPayable` e `createReceivable` de `core`, com schemas
`createProductInputSchema`, `createPayableInputSchema` e
`createReceivableInputSchema` de `contracts`. Não criar caso de uso paralelo nem
schema à mão.

**Rationale**: constitution I e II — um schema, dois canais. O catálogo e a
composition da API já expõem os três casos de uso; a fatia NR-117 fecha o
**laço conversacional** (FakeLlm, `processMessage`, confirmação, erros do
núcleo) e o handoff pós-foto da NR-116.

**Alternatives considered**:

- Novas tools com nomes diferentes: rejeitado; duplicaria contrato e confunde o
  LLM.
- Lógica de cadastro só no `processMessage` sem tool: rejeitado; quebra o padrão
  NR-060 e a confirmação por tool id.

## 2. Lacuna real desta entrega

**Decision**: tratar NR-117 como **completar aceite**, não greenfield:

| Área                          | Estado na branch                                          | Trabalho restante                                        |
| ----------------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| `catalog.ts` + `catalog.test` | Tools e testes unitários das três mutações                | Cobrir conflito de EAN via `AppError` no laço            |
| `fake-llm.ts`                 | Sem frases para as três tools                             | Padrões scriptáveis para harness e `process-message`     |
| `process-message.test.ts`     | Sem cenários US-069–071                                   | Confirmação, TTL, recusa, incompleto, tenant             |
| `routes/agent.test.ts`        | Stubs de `registerProduct` / contas                       | Smoke HTTP com confirmação                               |
| Foto → cadastro (NR-116)      | Resposta com código lido; cadastro por texto na sequência | Teste: turno seguinte com nome/custo/preço + `sim`       |
| NR-118                        | `settle_*`, `adjust_stock`, `cancel_sale` no catálogo     | **Fora do DoD** desta spec; não documentar no quickstart |

**Rationale**: evita reimplementar o que já passa em `catalog.test.ts` e foca no
que a spec exige para merge (laço + equivalência com app).

## 3. Preço menor que custo (US-069 vs schema)

**Decision**: na conversa, **mesma rejeição do aplicativo**: o
`createProductInputSchema` recusa `salePriceCents < costPriceCents` antes de
`registerProduct`. O assistente deve surfacear o erro de validação/conflito do
núcleo sem inventar preço; não há fluxo separado de “avisar e seguir” no
schema atual.

**Rationale**: `catalog.test.ts` documenta RF-140 como herdar a recusa da tela;
alterar para warning exigiria mudança em `contracts` + app + agente (fora do
escopo de 2 dias).

**Alternatives considered**:

- Relaxar Zod só no agente: violaria constitution I.
- Tool que calcula margem: violaria regra “agente não calcula”.

## 4. Código de barras duplicado

**Decision**: confiar em `registerProduct` → `AppError.conflict` quando o EAN já
existe; a tool propaga a mensagem ao lojista após confirmação (ou na validação
pré-execução se o LLM montar args inválidos). A foto com cadastro explícito
continua bloqueando antes do LLM via `TEXTO_FOTO_CADASTRO_PRODUTO_EXISTENTE`.

**Rationale**: RF-018/RF-140; mesmo caminho do POST de cadastro.

## 5. Conta “vencida” (US-070)

**Decision**: título gravado com `status: 'open'`; “vencida” é **faixa** em
`listPayables` (`overdue`) quando `dueDate < ctx.now`. A resposta da tool após
criação cita vencimento; testes de integração podem cruzar com `list_payables`
se a spec pedir evidência de faixa.

**Rationale**: alinhado a `payables.test.ts` e `list-payables.ts`; US-070 usa
linguagem de negócio (“overdue”), não coluna extra no insert.

## 6. Handoff foto → cadastro completo

**Decision**: **sem** rascunho novo tipo `PhotoProductDraft` na primeira
iteração. O turno da NR-116 deixa o código na mensagem do assistente; o turno
seguinte usa histórico (NR-062, até 12 mensagens) + texto da lojista para o
LLM (ou FakeLlm scriptado) montar `create_product` com `barcode` opcional. Se
testes com Mastra real mostrarem perda do código, adicionar rascunho por
`conversationKey` no mesmo padrão de `PhotoSaleDraft` (tarefa de follow-up no
`tasks.md`).

**Rationale**: menor diff; foto já imprime o código literal na resposta.

**Alternatives considered**:

- Rascunho obrigatório já na NR-117: mais estado; só entra se o laço falhar nos
  testes.

## 7. Recebível avulso vs venda

**Decision**: descrição da tool `create_receivable` deixa explícito “não vem de
venda”; `create_sale` permanece para itens. Testes FakeLlm com frase de venda
não devem mapear para `create_receivable`.

**Rationale**: US-071 e RF-142.

## 8. Cliente no recebível

**Decision**: `customerId` opcional no schema; resolução por nome fica a cargo
do LLM + histórico ou de fluxo `clarify` existente. Se o núcleo exigir cliente
no app para certos casos, o agente herda o mesmo erro — sem resolver cliente no
formatador.

**Rationale**: paridade com HTTP; ambiguidade de nome segue padrão NR-115 quando
houver tool de busca de cliente no futuro; nesta fatia, args completos ou pedido
de dado faltante.
