# Quickstart: validar NR-116

**Goal**: comprovar que uma foto de código de barras identifica o produto sem
digitá-lo, roteia venda/cadastro/recusa corretamente e não grava nada nos
caminhos de erro.

## Prerequisites

- Repositório instalado e Postgres do Compose em execução:
  [setup](../../docs/engenharia/setup.md).
- Branch `feat/NR-116-foto-codigo-barras`.
- `AGENT_PROVIDER=fake` e `FakeBarcodeDecoder` com as fixtures da matriz.
- Sessão fixture para `POST /agent/messages`.

## Matriz de fixtures NR-116

O fake de decoder mapeia um marcador estável (bytes da “imagem”) para códigos.
Não é necessário JPEG real na CI.

**Clarificações (2026-09-18):** foto só de produto existente → pergunta
pagamento, **sem** confirmação ainda. Pagamento na **mesma** mensagem ou na
**próxima** → confirmação `create_sale`. Próxima mensagem que **não** for
pagamento → solta o item da foto e atende o pedido novo.

| Cenário                      | Marcador / fixture                       | Empresa A                                             | Empresa B                                      | Resultado esperado                                                             |
| ---------------------------- | ---------------------------------------- | ----------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Código legível               | `7891234567895`                          | Produto com esse barcode e preço conhecido            | Mesmo código noutro produto, ou código só da A | Base para venda; isolamento por tenant                                         |
| Foto ilegível (0 códigos)    | bytes vazios / corruptos / MIME inválido | —                                                     | —                                              | `answer` recusa ilegível; sem venda nem cadastro                               |
| Foto → dois códigos          | marcador com 2 códigos                   | —                                                     | —                                              | `answer` um produto por vez (FR-011)                                           |
| Foto → código sem produto    | código lido sem cadastro                 | Nenhum produto com esse barcode                       | Produto só na B                                | `answer` recusa; sem avulso e sem “quer cadastrar?”                            |
| Foto + cadastro explícito    | código lido + texto `cadastra este`      | Sem produto / com produto já existente                | —                                              | `answer` com o código; não vende; não duplica                                  |
| Só foto (produto existente)  | `7891234567895`, sem texto de pagamento  | Produto existente                                     | —                                              | `clarify` com nome e preço; pede pagamento; **sem** `confirmationId`           |
| Foto + pagamento (mesma msg) | produto + `no pix` na mesma requisição   | Produto existente                                     | —                                              | `kind: confirmation`; `sim` grava; `não` não grava                             |
| Pagamento no turno seguinte  | foto no turno 1; `no pix` no turno 2     | Produto existente                                     | —                                              | turno 2 → `confirmation` daquele produto; não exige reenviar foto              |
| Turno seguinte ≠ pagamento   | foto no turno 1; consulta no turno 2     | Produto existente                                     | —                                              | turno 2 atende a consulta; item da foto solto; sem confirmação da venda antiga |
| Tenant B                     | código da empresa A                      | Produto da A                                          | —                                              | Na B: ausência; nunca produto alheio (FR-008)                                  |
| Só texto, sem foto           | mensagem textual habitual                | Comportamento já entregue (consulta/venda NR-115/060) | —                                              | Sem regressão                                                                  |

## Validação

```bash
pnpm --filter @na-regua/contracts test -- src/agent/message.test.ts
pnpm --filter @na-regua/core test -- src/registration/registration.test.ts
pnpm --filter @na-regua/agent test -- src/catalog.test.ts src/process-message.test.ts
pnpm --filter @na-regua/api test -- src/routes/agent.test.ts src/composition.test.ts
pnpm format:check
pnpm boundaries
pnpm typecheck
pnpm test
pnpm build
```

Sem `DATABASE_URL`, testes de `packages/db` com `skipIf` continuam opcionais
nesta fatia — a busca por barcode já é coberta em `core` contra o repositório
de cadastro; o agente prova o roteamento.

### Responsabilidade dos testes

Baseline verificado na Phase 1 (T002). Cobertura NR-116 de foto, decoder e gate
entra nas fases seguintes (T003–T022).

| Arquivo                                               | Responsabilidade (baseline hoje)                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/contracts/src/agent/message.test.ts`        | Schema só texto: aceita e apara, recusa vazio e campo extra; `agentReplySchema` com confirmação  |
| `packages/core/src/registration/registration.test.ts` | `findProductByBarcode`: acha o da empresa, `undefined` no alheio/ausente; cadastro geral         |
| `packages/agent/src/catalog.test.ts`                  | `create_sale` e consultas NR-115: schemas de contracts, `mutatesValue`, formatação               |
| `packages/agent/src/process-message.test.ts`          | Laço NR-115, venda/cadastro/cobrança com confirmação, isolamento entre lojas, recusas RF-149–151 |
| `apps/api/src/routes/agent.test.ts`                   | Harness HTTP autenticado: consultas NR-115, confirmação `create_sale` / `create_customer`        |

## Smoke manual

1. Suba a API em não-produção e autentique uma fixture da empresa A.
2. Envie **só** a foto (marcador do fake ou JPEG, se o decoder real estiver
   ligado):

```http
POST /agent/messages
{
  "image": { "mimeType": "image/png", "dataBase64": "<fixture-7891234567895>" }
}
```

Esperado: `clarify` com o nome e o preço do produto, pedindo forma de
pagamento — **sem** `confirmationId`.

3. Repita com texto de pagamento na **mesma** mensagem:

```http
POST /agent/messages
{
  "text": "no pix",
  "image": { "mimeType": "image/png", "dataBase64": "<fixture-7891234567895>" }
}
```

Esperado: `kind: confirmation`. `sim` grava a venda do produto; `não` não grava.

4. Em outra conversa (ou após limpar o rascunho): envie só a foto no turno 1 e,
   no turno 2, **sem reenviar a imagem**:

```http
POST /agent/messages
{ "text": "no pix" }
```

Esperado: `kind: confirmation` daquele produto — o assistente reutiliza o item
lido no turno anterior.

5. De novo só foto no turno 1; no turno 2 envie um pedido que **não** é
   pagamento:

```http
POST /agent/messages
{ "text": "quanto vendi hoje?" }
```

Esperado: responde a consulta; **não** propõe confirmação da venda da foto; o
item da foto foi solto.

6. Foto ilegível e foto de código inexistente: `answer` pedindo texto, sem
   confirmação, sem “quer cadastrar?”, sem item avulso. Conferir que estoque e
   cadastro não mudaram.
7. `{"text":"cadastra este","image":{...}}` com código lido: `answer` com o
   código, sem proposta de venda.
8. Trocar para fixture da empresa B e reenviar o código só da A: ausência, nunca
   o produto alheio.

## Referências

- Contrato: [contracts/agent-barcode-photo.md](./contracts/agent-barcode-photo.md)
- Entidades: [data-model.md](./data-model.md)
- Decisões: [research.md](./research.md)

## Não fazer nesta fatia

- Não gravar produto novo, custo ou preço a partir da foto (NR-117).
- Não persistir a imagem, não usar como foto de catálogo.
- Não chamar visão de LLM nem WhatsApp/Meta de produção.
- Não pular confirmação da venda nem oferecer item avulso.
