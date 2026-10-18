# Contract: disponibilidade do assistente

**Feature**: 010 · **Package**: `apps/api` + `packages/env`  
**Código**: `motivoDoAgenteIndisponivel` e `buildAgentDeps` em `apps/api/src/composition.ts`  
**Rota**: `POST /agent/messages` em `apps/api/src/routes/agent.ts`

## Ambiente

`AGENT_PROVIDER` não faz parte do schema. Presença da chave é o único sinal de provedor.

| Variável         | Regra                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY` | Opcional no parse. Vazia ou ausente: assistente indisponível, API no ar                                     |
| `AGENT_MODEL`    | Default `openai/gpt-4o-mini`. Só é lida quando a chave existe                                               |
| `AGENT_HARNESS`  | Inalterado. `1` libera o assistente com `NODE_ENV=production`. Ausente, vazio ou `0`: desligado em produção |
| `AGENT_PROVIDER` | Removida. Se o processo ainda enxergar a variável no ambiente, ela não é lida                               |

## Quando o runtime existe

| Ambiente     | Chave    | `AGENT_HARNESS` | Runtime |
| ------------ | -------- | --------------- | ------- |
| Não produção | presente | irrelevante     | Mastra  |
| Não produção | ausente  | irrelevante     | Ausente |
| Produção     | presente | `1`             | Mastra  |
| Produção     | presente | desligado       | Ausente |
| Produção     | ausente  | qualquer        | Ausente |

Não há linha em que o dublê seja o runtime servido.

## `POST /agent/messages` sem runtime

HTTP 503, corpo já usado pela rota:

```json
{
  "error": {
    "code": "UNAVAILABLE",
    "message": "<motivo devolvido por motivoDoAgenteIndisponivel>"
  }
}
```

O motivo cita a chave ausente ou o harness desligado em produção. Não cita um modo `fake` como alternativa de servidor.

Rotas que não são do assistente não passam a responder 503 por causa da chave.

## Studio

`/api/agents` só monta quando o motivo do assistente é ausente e o arquivo de presets carregou. Sem chave, o adapter não monta (404 no prefixo), o mesmo porteiro de hoje com assistente desligado.

O generate do `studio-harness`, quando o adapter monta, continua entregando o texto a `processMessage`. Esse generate não é chamada à OpenAI. A chamada à OpenAI, se a chave existe, ocorre dentro do laço.

## Fora deste contrato

- Forma do body de `POST /agent/messages` (`agentMessageInputSchema`). Não muda.
- Webhook Meta e `WHATSAPP_PROVIDER`.
- Foto e `FakeBarcodeDecoder`.
