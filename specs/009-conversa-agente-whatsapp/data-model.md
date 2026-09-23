# Data Model: Conversar com o assistente pelo WhatsApp

**Date**: 2026-09-22  
**Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

Não há tabela nova nem coluna nova. O canal reutiliza cadastro, vínculo e a caixa de webhook.

## Celular canônico

Valor calculado, não persistido. Os dois lados da comparação passam pela mesma função antes do `SELECT`.

| Forma de entrada                              | Chave canônica (1ª consulta)   | Chave legada (2ª, só se a 1ª falhar) |
| --------------------------------------------- | ------------------------------ | ------------------------------------ |
| `41988888888`, `41 98888-8888`                | `41988888888`                  | `4188888888`                         |
| `4188888888`, `554188888888`                  | `41988888888`                  | `4188888888`                         |
| `+55 (41) 98888-8888`                         | `41988888888`                  | `4188888888`                         |
| `5599998888` (DDD 55, oito dígitos, móvel)    | `559999998888`                 | `5599998888`                         |
| `4133334444` (fixo; assinante começa com 2–5) | `4133334444`                   | nenhuma                              |
| sem dígito                                    | vazio → silêncio, sem consulta | —                                    |

Regras:

- Só dígitos. Máscara não conta.
- Prefixo `55` sai somente quando sobram pelo menos 12 dígitos. Dez dígitos começando com `55` são DDD 55, não país.
- O `9` entra depois do DDD só no nacional de 10 dígitos cujo primeiro dígito do assinante é 6, 7, 8 ou 9.
- Número que já tem 11 dígitos nacionais não ganha outro `9`.
- Duas pessoas diferentes, uma gravada com 10 e outra com 11, não se fundem: a chave canônica ganha. O índice `users_phone_unico` continua em igualdade exata da coluna.

## Cadastro da dona

Já existe. Esta fatia só lê.

| Campo / fato                             | Papel no canal                                           |
| ---------------------------------------- | -------------------------------------------------------- |
| `users.phone`                            | Credencial. Comparada às chaves acima, não ao `from` cru |
| `users.is_active`                        | Inativo → a função SQL não devolve linha → silêncio      |
| `company_users.role = owner`             | Staff e contador não operam                              |
| `company_users.is_active`                | Vínculo revogado → silêncio                              |
| `company_users.created_at`, `company_id` | Primeira empresa; as outras não aparecem no WhatsApp     |

Transições que já valem e o canal passa a obedecer sem regra nova:

- Troca de celular no aplicativo substitui `users.phone`. O número antigo deixa de casar; o novo casa.
- Desativar usuário ou vínculo tira a pessoa do resultado de `channel_owner_by_phone`.

`abrirCanal` traduz linha encontrada em `ExecutionContext` com `role: owner` e `channel: whatsapp`. Ausência de linha é `silencio`, sem texto.

## Mensagem recebida

Não é tabela própria. O corpo da Meta vira, no adapter, uma leitura já existente:

| Campo do adapter    | Uso                                                                                |
| ------------------- | ---------------------------------------------------------------------------------- |
| `providerMessageId` | `webhook_events.event_id`                                                          |
| `from`              | Entrada da normalização e destino da resposta (`to` do `sendText`)                 |
| `text`              | Turno do assistente, ou pedido fixo de texto se vier vazio e a dona for autorizada |
| `receivedAt`        | `consent.inboundAt` de `service_reply`                                             |
| `media`             | Permanece nulo. Não há download                                                    |

Estados do pedido HTTP, não de uma linha de negócio:

| Situação                                | Grava `webhook_events`? | Chama o assistente?  | Envia WhatsApp?                |
| --------------------------------------- | ----------------------- | -------------------- | ------------------------------ |
| Assinatura inválida ou segredo ausente  | não                     | não                  | não                            |
| Recibo, status, corpo sem mensagem      | não                     | não                  | não                            |
| Número sem vínculo, inativo ou não-dona | não                     | não                  | não                            |
| Dona ativa, id ainda não visto          | sim, antes do turno     | sim, se houver texto | sim, se a resposta for visível |
| Dona ativa, mesmo id de novo            | já existe               | não                  | não                            |
| Dona ativa, sem texto                   | sim                     | não (frase fixa)     | sim                            |

`webhook_events.provider` desta fatia é `meta`. `company_id` só entra depois da barragem. `payload` é `{ "kind": "text" | "empty" }` mais o id, sem corpo da mensagem e sem telefone completo. `processed_at` marca o fim do turno ou da frase fixa.

A conversa em si continua no store que `processMessage` já usa (`wa:{companyId}:…`). Esta fatia não cria memória nova.

## Resposta do assistente

O tipo `AgentReply` já existe. Só estes `kind` geram `sendText`: `answer`, `clarify`, `unknown`, `confirmation`. `ignored` e texto vazio não geram envio.

O envio não é entidade nova: é `SendTextRequest` com destino `from`, corpo = texto da resposta, e consentimento `service_reply`.
