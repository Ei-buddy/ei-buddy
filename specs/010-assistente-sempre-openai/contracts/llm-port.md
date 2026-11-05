# Contract: `LlmPort` no teste e no servidor

**Feature**: 010 · **Package**: `@na-regua/agent`  
**Tipos**: `LlmPort` e `LlmDecision` em `packages/agent/src/types.ts`

## Servidor

`criarLlmDoAgente` devolve `createMastraLlm` ou não é chamado. Quando o runtime é nulo, não há porta.

`decide` no Mastra continua:

1. `agent.generate` com `maxSteps: 1`.
2. Se houve tool call, `{ type: 'tool', name, args }`.
3. Se houve texto, `{ type: 'text', text }`.
4. Senão `{ type: 'unknown' }`.

O `execute` registrado no Mastra devolve o input validado pelo schema da tool. Não chama `core`.

## Dublê (`FakeLlm`)

Usado quando o teste passa `llm` para `createAgentRuntime`, ou quando omite `llm` e aceita o default do runtime de teste. A composição da API não usa esse default.

| Método                   | Contrato                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `script(texto, decisao)` | Grava a decisão para o texto normalizado (trim, minúsculas, sem marca de acento). Substitui roteiro anterior da mesma chave   |
| `decide`                 | Se há roteiro para o texto, devolve essa decisão. Senão `{ type: 'unknown' }`. `tools`, `today` e `history` não escolhem tool |

Proibido no dublê depois desta fatia:

- Mapear "quanto vendi hoje?", estoque, fiado, resumo do mês, certificado, OFX ou nota para uma tool.
- Mapear "lança …", "cadastra …" ou "a receber …" para `create_payable`, `create_product` ou `create_receivable`.
- Calcular centavos ou data de vencimento a partir da frase.

## Laço, dado uma decisão `tool`

Inalterado, e é o que a CI prova:

1. Achar a tool no catálogo pelo `name`.
2. Validar `args` com o Zod de `contracts`.
3. Se `mutatesValue`, gravar proposta e responder confirmação. Não executar.
4. No turno seguinte, "sim" executa o caso de uso. "Não", ambiguidade ou TTL não gravam.

Uma frase sem `script()` não chega no passo 1 pelo dublê: a decisão é `unknown` e a resposta lista as capacidades.

## O que este contrato não promete

A CI não promete que o `gpt-4o-mini` escolha `list_sales` para "quanto vendi hoje?". Isso é smoke com chave, no [quickstart](../quickstart.md).
