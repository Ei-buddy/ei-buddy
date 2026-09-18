# Contract: histórico no LlmPort.decide

**Feature**: NR-062 · **Package**: `@na-regua/agent`

O modelo só vê o recorte que **nós** montamos. Memory Mastra **não** é este contrato.

## Purpose

Fazer o `decide` receber as mensagens do contexto ativo, com teto e idle já aplicados pelo `ConversationStore`.

## Input (acréscimo)

```ts
type HistoryTurn = {
  readonly role: 'user' | 'assistant' | 'system'
  readonly body: string
}

type DecideInput = {
  readonly text: string
  readonly tools: readonly ToolDescriptor[]
  readonly today: string
  readonly history?: readonly HistoryTurn[] // 0..12; omitido = []
}
```

`processMessage`:

1. Pendência de confirmação aberta → **não** chama `decide`; não passa history.
2. Senão `loadActive` → `history` = `messages` mapeadas (`role` + `body`; sem `toolCalls` obrigatórios no prompt).
3. `idle === true` ou store ausente → `history = []`.
4. `decide({ text, tools, today, history })`.
5. Reply visível → `append` do par.

## MastraLlm

- Inclui `history` no `generate` (mensagens da API atual **ou** prefixo compacto, ainda ≤ 12 turnos).
- `maxSteps: 1` inalterado.
- Tools continuam identidade (não gravam).
- MUST NOT instanciar `@mastra/memory` / Storage.

## FakeLlm

- Reconhecedor atual **não** usa `history` (consultas pela frase completa).
- Anáfora na CI: `LlmPort` de teste que inspeciona `history` e devolve a tool ancorada; se `history` vier vazio no caso ocioso, **não** ancora.

## Invariants

- `history.length <= 12` na chamada real (o store já cortou; o LLM não recorta de novo como política — se vier maior, é bug do store).
- Corpo **não** vai para log (RNF-034).
- Números da resposta continuam de `core` após a tool — history não é fonte de saldo.
