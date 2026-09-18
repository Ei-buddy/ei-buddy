# Data Model: foto do código de barras (NR-116)

**Date**: 2026-09-18  
**Spec**: [spec.md](./spec.md)

Esta fatia **não** cria tabela. Reutiliza conversa (NR-062), confirmação
(NR-061), produto e `registerSale`. O que nasce é um valor de entrada (foto) e
um resultado discriminado de resolução, ambos efêmeros no turno.

## Barcode photo (entrada)

Imagem anexada à mensagem da conversa. Não é entidade persistida.

| Campo    | Tipo / origem                               | Regras                                                                    |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| mimeType | `image/jpeg` \| `image/png` \| `image/webp` | Outro tipo ≡ foto ilegível                                                |
| bytes    | binário                                     | Convertido do base64 só na borda HTTP; teto de tamanho no contrato        |
| text     | string, pode ser vazia                      | Vazio é permitido **somente** quando há foto; sem foto, texto obrigatório |

**Validation rules**:

- Pelo menos foto ou texto; os dois vazios são inválidos.
- Várias imagens no mesmo envio são recusadas (um produto por vez).
- Os bytes não são gravados em `messages`, confirmação, catálogo nem log.

## Decoded barcode (saída do decoder)

| Campo | Tipo           | Regras                                                        |
| ----- | -------------- | ------------------------------------------------------------- |
| codes | lista de texto | Zero, um ou vários dígitos/símbolos lidos da mesma imagem     |
|       |                | Zero ≡ ilegível; dois ou mais ≡ recusa (não escolher sozinho) |

**State transitions**:

```text
foto recebida
  ├─ tipo/bytes inválidos → ilegível
  ├─ decoder devolve 0    → ilegível
  ├─ decoder devolve 2+   → recusa (um produto por vez)
  └─ decoder devolve 1    → lookup por empresa
```

## Barcode lookup (reuso de RF-018)

Resultado de `findProductByBarcode` no contexto da conversa.

| Campo          | Tipo / origem              | Regras                                                          |
| -------------- | -------------------------- | --------------------------------------------------------------- |
| barcode        | texto                      | O único código lido                                             |
| product        | `ProductOutput` ou ausente | Ausente = não existe **nesta** empresa (também se for de outra) |
| salePriceCents | inteiro em centavos        | Só existe com produto; vem do núcleo, o agente só copia         |

**Validation rules**:

- Nunca devolver produto de outro `companyId`.
- Ausência não distingue “não cadastrou” de “é da loja vizinha”.

## Photo intent (rota do turno)

Derivada do texto da **mesma** mensagem, depois da leitura.

| Campo  | Tipo                                                                                                    | Regras                     |
| ------ | ------------------------------------------------------------------------------------------------------- | -------------------------- |
| kind   | `sale` \| `register` \| `refuse`                                                                        | Uma rota por turno         |
| reason | `unreadable` \| `multiple` \| `unknown_product` \| `existing_product` \| `sale_item` \| `register_code` | Motivo estável para testes |

**State transitions**:

```text
1 código lido
  ├─ texto com cadastro explícito
  │    ├─ produto existe → register + existing_product (não vende, não duplica)
  │    └─ produto ausente → register + register_code (código na resposta; não grava)
  └─ sem cadastro explícito
       ├─ produto existe → sale + sale_item
       └─ produto ausente → refuse + unknown_product
```

Foto sem texto ⇒ `sale` em potencial, nunca `register`.

## Sale draft from photo (quando `sale_item`)

Rascunho para a tool `create_sale`. Não é tabela; vira args da confirmação ou
pedido de esclarecimento.

| Campo          | Tipo                     | Regras                                                           |
| -------------- | ------------------------ | ---------------------------------------------------------------- |
| productId      | UUID do produto lido     | Obrigatório                                                      |
| quantity       | inteiro                  | Omitido = 1; quantidade maior não é inferida da foto             |
| unitPriceCents | centavos do produto      | Cópia de `salePriceCents`; o agente não recalcula                |
| payments       | lista do schema de venda | Ausente ⇒ `clarify` (pedir forma); presente ⇒ confirmação        |
| customerId     | UUID opcional            | Só se o texto/fluxo já existente o identificar; foto não inventa |

**Validation rules**:

- Sem forma de pagamento não há `PendingConfirmation`.
- Item avulso é proibido neste caminho.
- Confirmação, expiração e `sim`/`não` são a máquina já existente.

## Relacionamentos

```text
Incoming message ──o photo ──> decoded barcode
Company 1 ──* Product ── findByBarcode ──> lookup
lookup + intent ──> refuse | register reply | sale draft ──> create_sale (NR-060)
Conversation.messages.body ──> placeholder textual (nunca os bytes)
```
