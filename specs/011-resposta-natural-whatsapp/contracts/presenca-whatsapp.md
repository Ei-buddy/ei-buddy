# Contract: Presença no WhatsApp

**Date**: 2026-10-01  
**Spec**: [../spec.md](../spec.md) · **Data model**: [../data-model.md](../data-model.md)

Não é rota nova. É o que o adapter faz no mesmo URL de mensagens do envio, e o que a rota exige desses sinais. Sem sessão. O aplicativo não chama isto.

## Quem chama

Só o webhook da conversa da dona, depois de `abrirCanal` autorizar. Número sem vínculo: nenhum POST de presença, nenhum envio, nenhum registro na caixa — igual à NR-046.

## Lido

Um POST por texto aceito, antes de armar a pausa e antes de responder.

| Campo               | Valor                           |
| ------------------- | ------------------------------- |
| `messaging_product` | `whatsapp`                      |
| `status`            | `read`                          |
| `message_id`        | `providerMessageId` deste balão |

Sem `to` e sem `typing_indicator`. Sucesso do provedor: `{ "success": true }`.

Marcar uma mensagem também marca as anteriores no chat; ainda assim cada balão da sequência dispara o seu POST, porque cada um precisa ficar lido na chegada, sem esperar o próximo.

## Digitando

O mesmo POST, com `typing_indicator: { "type": "text" }`.

| Momento                                            | `message_id`                        |
| -------------------------------------------------- | ----------------------------------- |
| O turno começa a ser preparado (a pausa já acabou) | Id do último fragmento da sequência |
| Antes de cada parte da resposta depois da primeira | O mesmo id                          |
| A preparação passa de 20 s sem mensagem nossa      | O mesmo id, de novo                 |

O provedor tira o indicador quando uma mensagem nossa é enviada, ou em 25 s. A última parte da resposta, ou a frase de falha, é o que encerra o indicador visível. Não existe chamada de “parar de digitar”.

Não enviar este POST durante os 3 s de pausa.

## Falha

Timeout, rede, corpo inesperado ou recusa (incluindo id inválido) são engolidos pelo chamador:

- a resposta em texto segue;
- o log leva `requestId`, `companyId` e o código do provedor, se houver;
- o log não leva telefone, corpo da mensagem nem token.

O POST de presença não usa o mapa de idempotência do `sendText`. Repetir o lido ou o digitando é inofensivo; repetir um texto de resposta não é, e continua no contrato de envio.

## Texto vazio ou sem corpo

Dona vinculada, `text` nulo ou só espaços: lido (se houver id) e digitando, depois a frase fixa já existente, sem pausa e sem modelo. Não mexe na sequência de textos que já esteja em espera.
