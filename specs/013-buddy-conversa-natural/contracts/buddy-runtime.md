# Contract: runtime do Buddy (agente de várias etapas)

Interfaces internas entre `apps/api` e `packages/agent`, e entre o modelo e as
tools. Nenhum schema de `@na-regua/contracts` muda nesta fatia.

---

## 1. Borda pública do pacote (inalterada para quem chama)

```text
processMessage(runtime: AgentRuntime, input: IncomingMessage): Promise<AgentReply>
```

- `IncomingMessage` e `AgentReply` mantêm a forma atual.
- `AgentReply.kind` emitido: `confirmation` (com `confirmationId`) quando a
  mensagem terminou com proposta nova pendente; `answer` nos demais casos;
  `ignored` para peer não vinculado. `clarify` e `unknown` não são mais
  emitidos.
- `input.image` presente → `answer` com a frase de pedido de texto, sem chamar
  o modelo.

Chamadores que não mudam: `apps/api/src/routes/whatsapp-webhook.ts`,
`apps/api/src/routes/agent.ts`, `packages/agent/src/studio/relay-agent.ts`.

---

## 2. `AgentRuntime` (muda)

```text
AgentRuntime {
  brain: BuddyBrain                 // substitui `llm: LlmPort` e `tools: AgentTool[]`
  confirmations: ConfirmationStore  // porta de core, inalterada
  conversations?: ConversationStore // porta de core, inalterada
  peers?: PeerDirectory
  aiUsage?: AiUsageCounter
  timeZone: string
  confirmationTtlMs: number         // 5 min
}
```

Saem: `llm`, `tools`, `barcodeDecoder`, `findProductByBarcode`.

```text
BuddyBrain {
  conversar(input: {
    execucao: ExecutionContext
    texto: string
    janela: readonly { role: 'user' | 'assistant'; body: string }[]  // 0..12
    resumo: ResumoDeEntidades
    pendente?: PendingConfirmation
    hoje: string                    // AAAA-MM-DD no fuso da loja
  }): Promise<{
    texto: string                   // já limpo (FR-004)
    etapas: number                  // para aiUsage
    snapshot: SnapshotDeTurno       // ver data-model
    propostaNova?: { id: string }
  }>
}
```

`createBuddyBrain({ model, useCases, confirmations, ttlMs })` monta o `Agent`
Mastra. `model` aceita a string do registro (`openai/gpt-5.4-mini`) ou um
`MastraLanguageModelV2Mock` nos testes.

---

## 3. Chamada ao Mastra

```text
agent.generate(mensagensDaJanela + mensagemAtual, {
  maxSteps: 5,
  maxProcessorRetries: 1,
  requestContext,          // execucao, textoDaDona, resumo, pendente, coletor
  system: [dataDaLoja, resumoDeEntidades, propostaPendente?],
  activeTools,             // accept_proposal / cancel_proposal só com pendente
  prepareStep: na etapa 5 → toolChoice 'none' + instrução de saída elegante,
})
```

`outputProcessors: [semTermoTecnico]` no `Agent`.

---

## 4. Envelope de retorno das tools para o modelo

Toda tool devolve um objeto com `status` e fatos humanizados. Nenhum campo em
centavos, nenhum nome de campo do domínio nas chaves.

```text
{ status: 'ok', ...fatos }                       // consulta
{ status: 'nao_encontrado', procurado: string }  // find_* / resolução de ref
{ status: 'varios', opcoes: { ref, rotulo, detalhe? }[] }
{ status: 'faltando', faltando: string[], opcionais?: string[] }  // não dá para propor ainda
{ status: 'proposta', fatos: string[], assumido: string[] }   // gravação proposta
{ status: 'gravado', fatos: string[], retomar?: string }  // accept_proposal ok; retomar = pedido interrompido pelo cadastro
{ status: 'parecido', fatos: string[], opcoes }  // cadastro de cliente com telefone/documento repetido
{ status: 'ja_cadastrado', ref, rotulo, mensagem }  // create_customer com nome de cliente já no contexto
{ status: 'nao_e_aceite', orientacao: string }   // trava
{ status: 'ja_tem_proposta', orientacao: string } // segunda proposta no mesmo turno (FR-019)
{ status: 'ja_decidida' }                        // segundo aceite no mesmo turno
{ status: 'expirada' }
{ status: 'cancelada' }
{ status: 'recusado', mensagem: string }         // AppError humano, sem path
{ status: 'regra', mensagem: string }            // refuse_*
```

Exemplo de `check_stock` para o caso do teste manual:

```text
{ status: 'ok', produto: 'café em grãos', ref: '78a3…', quantidade: '0 un.', preco: 'R$ 25,00' }
```

(sem `localizacao`, porque não há valor — FR-006)

---

## 5. Catálogo de tools

| Tool                                                                                                 | Tipo     | Executa `core` | Observação                                          |
| ---------------------------------------------------------------------------------------------------- | -------- | -------------- | --------------------------------------------------- |
| `find_customer`, `find_product`                                                                      | leitura  | sim            | Novas; `nao_encontrado` / `varios` / `ok`           |
| `list_sales`, `period_summary`, `revenue_by_month`                                                   | leitura  | sim            |                                                     |
| `check_stock`, `search_products`                                                                     | leitura  | sim            |                                                     |
| `check_customer_wallet`                                                                              | leitura  | sim            |                                                     |
| `list_payables`, `list_receivables`, `day_agenda`                                                    | leitura  | sim            |                                                     |
| `rank_customers`, `rank_products`                                                                    | leitura  | sim            | Período obrigatório                                 |
| `create_customer`, `update_customer`, `mark_customer_deleted`                                        | proposta | não            | Grava só via `accept_proposal`                      |
| `create_product`, `update_product`, `mark_product_deleted`                                           | proposta | não            |                                                     |
| `create_sale`, `cancel_sale`                                                                         | proposta | não            | Preço de tabela e qtd 1 assumidos vêm em `assumido` |
| `create_payable`, `create_receivable`, `settle_payable`, `settle_receivable`                         | proposta | não            |                                                     |
| `adjust_stock`, `create_appointment`, `send_charge`                                                  | proposta | não            |                                                     |
| `accept_proposal`                                                                                    | execução | sim            | Só com pendente; trava determinística               |
| `cancel_proposal`                                                                                    | execução | não            | Só com pendente                                     |
| `refuse_certificate`, `refuse_banking`, `refuse_invoice_command`, `refuse_delete_account_or_contact` | regra    | não            |                                                     |

Input de todas as tools de proposta = schema de `contracts` atual, com
`semNulos` antes da validação (o modelo manda `null` em opcional). Exceções:

- `create_sale` aceita `quantity`, `unitPriceCents`, `amountCents` e `payments`
  ausentes; a tool preenche (qtd 1, preço de tabela, total) ou devolve
  `faltando`, e só então valida com `createSaleInputSchema`.
- `create_product` aceita todos os campos ausentes para devolver `faltando`
  com obrigatórios e opcionais.
- `create_customer` e `create_product` aceitam o campo do agente
  `paraRetomar: { acao, descricao, jaDito? }`, removido antes da validação de
  `contracts` e gravado como intenção em andamento (`aguardando:
'cadastro_cliente' | 'cadastro_produto'`).

`find_customer` e `find_product` recebem `{ termo }` e devolvem
`ok` (com `ref` e `rotulo`), `varios` ou `nao_encontrado`.

---

## 6. Trava do aceite (`ehConcordanciaPura`)

```text
ehConcordanciaPura(texto: string, resumo: ResumoDeEntidades): boolean
```

Falso se o texto, normalizado (minúsculas, sem acento), tiver qualquer um:

- dígito;
- valor monetário (`r$`, `reais`, `real`, `conto`);
- forma de pagamento (`pix`, `dinheiro`, `debito`, `credito`, `cartao`, `fiado`);
- `rotulo` de entidade do resumo;
- palavra de ressalva: `mas`, `porem`, `ne`, `acho`, `sera`, `talvez`, `nao`, `troca`, `muda`;
- `?`;
- mais de 6 palavras.

Verdadeiro para concordância curta (`sim`, `pode`, `fechou`, `isso ai`,
`manda ver`, `confirmo`, `ok`, `👍`).

---

## 7. Termos técnicos (`semTermoTecnico` / `limparTermosTecnicos`)

Proibidos na resposta:

- UUID (`[0-9a-f]{8}-[0-9a-f]{4}-…`);
- código interno de produto (`PROD-\d+`);
- id de tool e chave de schema das tools (coletados do catálogo na montagem);
- `camelCase` terminado em `Cents` e a palavra `centavo(s)`.

`processOutputStep`: com termo e `retryCount === 0` → `abort(feedback, { retry: true })`.
Depois do `generate()`: `limparTermosTecnicos` remove o trecho (frase ou item
de lista) que ainda contiver termo.

---

## 8. Snapshot gravado em `messages.tool_calls`

Formato em [data-model.md](../data-model.md#snapshot-de-turno-tool_calls-v2).
Leitor aceita v1 (`{ customerId?, saleId?, productId? }`) e converte para
entidades sem `rotulo` legível (descartadas do resumo).
