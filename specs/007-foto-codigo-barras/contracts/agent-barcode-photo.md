# Contract: foto do código de barras NR-116

**Feature**: NR-116  
**Package**: `@na-regua/agent` + `@na-regua/contracts`  
**Norma**: input do harness continua em `contracts`. A tool de venda continua
`create_sale` / `createSaleInputSchema`. Não nasce schema paralelo de item
avulso. O decoder é porta do agente, não caso de uso de `core`.

## Mensagem de entrada

`agentMessageInputSchema` (hoje só `text` obrigatório) passa a:

```text
{ text?: string, image?: { mimeType, dataBase64 } }  (strict)
  refine: text não vazio OU image presente
  text: trim, max 4000; pode ser omitido ou vazio se houver image
  image.mimeType: image/jpeg | image/png | image/webp
  image.dataBase64: base64 sem prefixo data:; teto de tamanho no schema
```

`POST /agent/messages` valida esse schema, monta `IncomingMessage` com `text`
(string, possivelmente `''`) e `image` em bytes, e chama a mesma
`processMessage`. `companyId` nunca vem no body.

## Porta `BarcodeDecoder`

```text
decode(input: { mimeType, bytes }) → { codes: string[] }
```

| Implementação | Onde                           | Papel                                     |
| ------------- | ------------------------------ | ----------------------------------------- |
| Fake          | testes + `AGENT_PROVIDER=fake` | mapa fixture → códigos; CI só usa esta    |
| Real          | composition, fora da CI        | EAN-13 / EAN-8 / UPC-A; falha ≡ 0 códigos |

Sem decoder configurado e com imagem: tratar como ilegível (falha fechada).

## Resolução (antes do LLM)

```text
imagem? ─ não → laço atual (LLM → tool)
         └ sim → decode
              ├─ 0 códigos / erro de tipo / bytes vazios → recusa ilegível
              ├─ 2+ códigos → recusa múltipla
              └─ 1 código → findProductByBarcode(ctx, barcode)
                   ├─ cadastro explícito no texto → resposta de cadastro
                   ├─ produto encontrado → rascunho de venda (§ abaixo)
                   └─ produto ausente → recusa unknown_product
```

Cadastro explícito: o texto normalizado casa com pedido de cadastrar
(`cadastr`). Ausência de texto ≠ cadastro.

## Venda (`create_sale`)

Não há tool nova. Args, quando completos:

```text
{
  items: [{ productId, quantity: 1, unitPriceCents: product.salePriceCents }],
  payments: [{ method, amountCents: product.salePriceCents }]
}
```

`method` só se o texto da mensagem o declarar de forma inequívoca (valores de
`paymentMethodSchema`). Sem `method`: `kind: clarify`, sem pendência.

Confirmação, `sim`/`não`, expiração e `registerSale` são o contrato já
documentado em [agent-messages.md](../../002-agent-mastra-runtime/contracts/agent-messages.md).

## Textos de recusa e cadastro (estáveis para teste)

Os textos abaixo são o contrato da conversa. Não oferecer item avulso nem
perguntar se cadastra — inclusive por paráfrase.

| Motivo                           | kind           | Deve conter                           | Não deve conter                                |
| -------------------------------- | -------------- | ------------------------------------- | ---------------------------------------------- |
| Ilegível                         | `answer`       | pedir venda ou cadastro **por texto** | proposta de venda, código inventado            |
| Vários códigos                   | `answer`       | um produto por vez                    | escolha automática de um código                |
| Código sem produto, sem cadastro | `answer`       | descrever **por texto**               | `avulso`, pergunta se cadastra, `create_sale`  |
| Cadastro + código lido           | `answer`       | o código lido                         | proposta de venda, nome/custo/preço inventados |
| Cadastro + produto existente     | `answer`       | aviso do existente                    | nova venda, novo produto                       |
| Venda, falta pagamento           | `clarify`      | nome do produto e preço do núcleo     | forma de pagamento inventada, `confirmationId` |
| Venda completa                   | `confirmation` | resumo da `create_sale`               | execução antes do `sim`                        |

## Histórico e log

- `messages.body` do turno do usuário: texto original, ou placeholder
  `[foto do codigo]` (e o código lido, se houver). Nunca base64.
- Log estruturado: `requestId`, `companyId`, motivo da rota. Sem bytes, sem
  data-URL.
- Recusas e cadastro: `mutatesValue` efetivo falso — zero `PendingConfirmation`.

## Testes de contrato

1. Schema recusa body sem texto e sem imagem; aceita só imagem; aceita imagem +
   texto; recusa MIME fora da lista.
2. Foto ilegível / múltiplos códigos / código sem produto não chamam
   `registerSale` nem `registerProduct`.
3. Código sem produto não contém convite a cadastrar nem item avulso.
4. Foto + cadastro explícito não cria confirmação de `create_sale`.
5. Foto + produto existente, com forma de pagamento no texto, pede confirmação
   e só grava no `sim`.
6. Mesmo código na empresa B não identifica o produto da empresa A.
7. `create_sale` permanece o único caminho que grava venda; preço do item é o
   `salePriceCents` devolvido por `findProductByBarcode`.
