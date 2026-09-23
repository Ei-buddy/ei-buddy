# Contract: Webhook do WhatsApp

**Date**: 2026-09-22  
**Spec**: [../spec.md](../spec.md) · **Data model**: [../data-model.md](../data-model.md)

Superfície HTTP da plataforma. O formato interno da Meta fica no adapter; este contrato é o que a rota garante. Sem sessão e sem `companyId` no corpo ou na query.

## GET `/webhooks/whatsapp`

Handshake de cadastro da URL. Query `hub.mode`, `hub.verify_token`, `hub.challenge`.

| Condição                                       | Status | Corpo                         |
| ---------------------------------------------- | ------ | ----------------------------- |
| Provedor não é `meta`, ou verify token ausente | 503    | erro `UNAVAILABLE`            |
| `hub.mode=subscribe` e token confere           | 200    | o `hub.challenge`, texto puro |
| Token diferente, mode diferente ou token vazio | 403    | vazio                         |

Não devolver JSON no sucesso: o cadastro da URL falha se o challenge não voltar cru.

## POST `/webhooks/whatsapp`

Corpo bruto `application/json`. Assinatura no cabeçalho `X-Hub-Signature-256` (`sha256=` + hex), HMAC do App Secret sobre esses bytes. Parser que reserializa o JSON antes da conferência é falha do contrato.

| Leitura do adapter                       | Status | Efeito                                                |
| ---------------------------------------- | ------ | ----------------------------------------------------- |
| Provedor não configurado                 | 503    | nada                                                  |
| `invalid_signature`                      | 401    | nada; mensagem genérica, sem detalhe do segredo       |
| `malformed`                              | 400    | nada                                                  |
| `ignored` (recibo, status, sem mensagem) | 200    | nada                                                  |
| `accepted`, número não autorizado        | 200    | sem inbox, sem assistente, sem envio                  |
| `accepted`, dona ativa, id novo          | 200    | inbox, turno ou frase fixa, envio da resposta visível |
| `accepted`, dona ativa, id repetido      | 200    | sem segundo turno e sem segundo envio                 |

200 no silêncio e na repetição é obrigatório. 4xx nesses casos faria o provedor reentregar para sempre.

Texto vazio ou mídia, com dona ativa: 200 e uma frase pedindo texto, sem modelo de IA. A mesma mensagem sem dona: 200 e nenhuma frase.

## Envio da resposta

Não é rota. É a porta `MessageSender.sendText` já existente.

| Campo               | Valor                                                                |
| ------------------- | -------------------------------------------------------------------- |
| `to`                | `from` da mensagem aceita, sem reformatar para o celular do cadastro |
| `body`              | texto visível do assistente, ou a frase fixa de pedido de texto      |
| `consent.basis`     | `service_reply`                                                      |
| `consent.inboundAt` | instante recebido na mensagem                                        |
| `idempotencyKey`    | id da mensagem de entrada                                            |

Recusa `outside_service_window` não vira novo tipo de mensagem nem template. O pedido HTTP do webhook continua 200: a entrada foi aceita; o provedor é que não entregou a saída.

## Fora deste contrato

- Envio a cliente final, opt-in e opt-out (RF-015, RF-016).
- `POST /agent/messages` (harness com sessão). Permanece como está.
- Download de mídia e mensagem de modelo.
