# Research: Operação diária do Buddy no WhatsApp

**Date**: 2026-10-06  
**Spec**: [spec.md](./spec.md)

## 1. Tools chamam o núcleo, não HTTP

**Decision**: cada tool do catálogo chama o caso de uso em `@na-regua/core` via
`AgentUseCases` em `apps/api/src/composition.ts` — o mesmo grafo que as rotas
HTTP usam. A tool **não** faz `fetch` interno ao endpoint.

**Rationale**: constitution I e II. O PRD fala em “endpoint que a tela usa” no
sentido de **mesmo contrato e mesmo efeito**, não de hop HTTP dentro do
processo. O laço `processMessage` → `tool.execute` → `core` já é o padrão
NR-060/117/118.

**Alternatives considered**:

- Tool → HTTP → core: rejeitado; duplica auth, perde `ExecutionContext` limpo e
  adiciona latência sem ganho de equivalência.
- Lógica só no `processMessage` sem tool: rejeitado; quebra confirmação por
  `toolId` e o catálogo Mastra.

## 2. Lacuna real desta entrega

**Decision**: tratar a fatia como **fechar o laço conversacional** sobre o que
já existe na tela, construir só o que falta no núcleo/API, e **não** inventar
remoção física.

| Capacidade                                                                                                                          | Estado hoje                                           | Trabalho                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Consultas já no catálogo (`list_sales`, `period_summary`, `revenue_by_month`, estoque, contas, carteira, agenda, `search_products`) | Tools + core                                          | FakeLlm / laço / paridade de frase; histórico por `customerId` na `list_sales`      |
| Ranking clientes/produtos                                                                                                           | Core + HTTP                                           | Tools `rank_customers` / `rank_products` + composition                              |
| Editar cliente                                                                                                                      | Core + HTTP (`updateCustomer`, `PATCH /clientes/:id`) | Tool `update_customer` + confirmação                                                |
| Editar produto (desc/preço/custo)                                                                                                   | Schema em contracts; **sem** core/API/web escritura   | `updateProduct` no core + `PATCH /produtos/:id` + ficha web + tool `update_product` |
| Marcar cliente deletado                                                                                                             | Core + HTTP (`deleteCustomer`)                        | Tool `mark_customer_deleted` (`mutatesValue`)                                       |
| Marcar produto deletado                                                                                                             | Coluna `deleted_at`; **sem** writer                   | `deleteProduct` / `setDeletedAt` + rota + tool                                      |
| “Apagar venda”                                                                                                                      | Só `cancelSale` / `cancel_sale` (sem `deleted_at`)    | Mapear pedido de apagar → `cancel_sale` (ver §3)                                    |
| Conta / contato “apagar”                                                                                                            | Conta: status; contato: sem `deleted_at`              | Ver §4                                                                              |
| Venda = “compra” do cliente                                                                                                         | `create_sale` existe                                  | FakeLlm + descrição da tool; não criar tool `create_purchase`                       |
| Roteiro manual                                                                                                                      | Ausente                                               | `docs/qa/buddy-roteiro-de-prompts.md` no aceite                                     |

**Rationale**: 23 tools já cobrem a maior parte da operação diária; o gap
visível da spec é edição, ranking, histórico explícito, soft-delete e o
roteiro.

## 3. “Apagar venda” vs constitution (RNF-040)

**Decision**: pedido de apagar/deletar **venda** NÃO cria `deleted_at` em
`sales`. O Buddy propõe e executa o **cancelamento da venda inteira**
(`cancel_sale` / `cancelSale`), com motivo e confirmação. A frase comunica que
a venda foi **cancelada** e permanece no histórico. Não existe tool cujo
efeito remova a linha da venda.

**Rationale**: constitution III e RNF-040 — venda registrada não é apagada;
correção é cancelamento ou devolução. O schema (`0002_dominio_0909`) documenta
venda sem `deleted_at`. A clarificação Q1 (marcar como deletado + dizer
deletado) aplica-se a entidades com soft-delete; para venda, o equivalente
fiel ao produto é cancelar.

**Alternatives considered**:

- Adicionar `deleted_at` em vendas: rejeitado; violaria constitution e o modelo
  fiscal/auditoria.
- Recusar “apague a venda” e exigir a palavra “cancele”: rejeitado para UX;
  a intenção é a mesma ação já coberta por US-075.
- Dizer “deletado” na conversa enquanto a tela mostra “cancelada”: rejeitado;
  quebra paridade de linguagem com a ficha.

**Spec alignment**: FR-022 e história 6 interpretados assim para venda; cliente
e produto usam marca `deleted_at` e a frase “deletado”.

## 4. Soft-delete: cliente, produto, conta, contato

**Decision**:

| Entidade                  | Efeito após o sim                   | Frase                                                                                                   |
| ------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Cliente                   | `deleteCustomer` → `deleted_at`     | Diz que foi deletado; some da lista; permanece guardado                                                 |
| Produto                   | novo `deleteProduct` → `deleted_at` | Idem                                                                                                    |
| Venda                     | `cancelSale`                        | Diz que foi cancelada; permanece no histórico                                                           |
| Conta a pagar / recebível | Sem tool de “deletar” nesta fatia   | Buddy orienta cancelamento/baixa já existentes ou recusa apagar título como remoção; não inventa DELETE |
| Contato                   | Sem soft-delete no schema           | Recusa informar que não apaga contato pela conversa nesta entrega; não remove                           |

**Rationale**: Q1 exige marca + frase “deletado” sem remoção física — isso
existe de verdade para cliente (e deve existir para produto). Conta e contato
não têm o mesmo modelo; forçar PATCH inventado quebraria a tela.

**Alternatives considered**:

- Soft-delete genérico para qualquer tabela: rejeitado; schema e auditoria
  diferem por entidade.
- Implementar `deleted_at` em payables/contacts nesta fatia: fora do escopo
  mínimo; pode virar NR futura.

## 5. Edição de produto: construir núcleo e ficha

**Decision**: implementar `updateProduct` em `core` (mesmo schema
`updateProductInputSchema`), persistência no repositório de produtos, `PATCH
/produtos/:id` na API e edição na ficha web — e só então a tool
`update_product`. Validação preço ≥ custo continua no schema (RF-021).

**Rationale**: a spec exige que o preço novo apareça na ficha. Hoje a ficha é
só leitura; sem o caso de uso, a tool mentiria equivalência de canais.

**Alternatives considered**:

- Tool que só altera memória / tabela paralela: rejeitado (constitution I).
- Editar só via SQL no agente: rejeitado (constitution II).

## 6. Ranking e histórico de compras

**Decision**:

- Tools de leitura `rank_customers` e `rank_products` → `rankCustomers` /
  `rankProducts` (`packages/core/src/reports/rankings.ts`), input
  `rankingInputSchema`. Sem confirmação.
- Histórico do cliente: reutilizar `list_sales` com `customerId` (já no
  `saleHistoryInputSchema`), com descrição e `formatReply` orientados a
  “compras do cliente” (RF-011). Opcional: alias de descrição; **não** criar
  segundo caso de uso.

**Rationale**: core e HTTP já existem; falta só o canal conversa.

**Alternatives considered**:

- Nova tool `list_customer_purchases` com schema próprio: rejeitado;
  duplicaria `listSales`.
- Calcular ranking no LLM: rejeitado.

## 7. Confirmação, idempotência e TDD

**Decision**: mutações novas (`update_*`, `mark_*_deleted`) usam o mesmo
portão NR-061 (`mutatesValue: true`, TTL 5 min). Escrita idempotente por chave
já usada em venda (`agent:requestId` / RNF-043) onde o caso de uso já exige;
soft-delete e update herdam a idempotência do núcleo (segunda chamada no
mesmo estado não inventa segundo efeito). Cada comportamento novo começa por
teste que falha (constitution V + PRD).

**Rationale**: já é o laço comprovado; não reabrir HITL do Mastra.

## 8. Canal WhatsApp e harness

**Decision**: aceite automatizado no laço `processMessage` + FakeLlm + rotas
`POST /agent/messages` (padrão NR-117). WhatsApp real entra no roteiro manual
(`docs/qa/buddy-roteiro-de-prompts.md`). Identidade continua celular do
owner (ADR-0012).

**Rationale**: CI sem Meta; RNF e constitution pedem adapter falso na CI.

## 9. Conta restrita

**Decision**: `assertCanWrite` no núcleo já bloqueia mutação; tools de leitura
continuam. Testes cobrem consulta OK + gravação recusada (RF-117/118).

**Rationale**: autorização no `core`, não só no handler (constitution I).
