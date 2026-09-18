# Implementation Plan: Foto do código de barras por mensagem (NR-116)

**Branch**: `feat/NR-116-foto-codigo-barras` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

## Summary

Aceitar foto na mensagem do assistente, ler o código com uma porta de decoder
(falso na CI), localizar o produto pelo mesmo `findProductByBarcode` do
aplicativo e roteiar: venda com confirmação, recusa por texto, ou encaminhamento
do código ao cadastro — sem item avulso, sem perguntar se cadastra e sem gravar
produto nesta fatia.

## Technical Context

**Language/Version**: TypeScript, Node.js e pnpm workspace.

**Primary Dependencies**: Zod para o contrato da mensagem; Vitest; porta
`BarcodeDecoder` no agente (fake obrigatório; ZXing ou equivalente só fora da
CI). Mastra/LLM **não** vê a imagem.

**Storage**: nenhum schema novo. Conversa e confirmação já existem; a imagem não
é persistida. Produto e venda no PostgreSQL via casos de uso atuais.

**Testing**: Vitest; unitário em `contracts`/`agent`/`core`; rota HTTP na API
com sessão fixture. Decoder real fora da CI.

**Target Platform**: API Node.js; aceite em `POST /agent/messages`. Studio
reutiliza o schema se receber `image`; WhatsApp de produção é NR-046.

**Project Type**: Monorepo de pacotes de domínio/núcleo, API e clientes.

**Performance Goals**: um turno de conversa; decode + lookup antes do LLM, sem
chamada extra ao provedor nas recusas.

**Constraints**:

- `core` não importa imagem; agente não importa `db`/`domain`.
- `companyId` só do `ExecutionContext`.
- Preço do item é cópia de `salePriceCents`; o agente não calcula totais.
- Criar valor continua exigindo confirmação (`create_sale`).
- Foto ilegível ou código desconhecido não criam pendência nem cadastro.

**Scale/Scope**: um campo de imagem no contrato, uma porta, um roteador no
laço existente, reuso de `findProductByBarcode` e `create_sale`. Sem tool nova
de mutação, sem NR-117, sem Meta.

## Constitution Check

_Gate inicial: PASS. Reavaliado após o desenho: PASS._

| Princípio                        | Evidência no plano                                                                                | Resultado |
| -------------------------------- | ------------------------------------------------------------------------------------------------- | --------- |
| I. Um núcleo, dois canais        | Lookup é `findProductByBarcode`; venda é `registerSale` via `create_sale`. Sem catálogo paralelo. | PASS      |
| II. Hexágono e fronteiras        | Decoder é porta no agente; schema em `contracts`; `db` só na composition já existente.            | PASS      |
| III. Integridade financeira      | Venda só com confirmação; preço copiado do núcleo; recusas não gravam.                            | PASS      |
| IV. Isolamento de tenant         | Lookup com `ctx.companyId`; produto alheio é inexistente; teste A/B no laço.                      | PASS      |
| V. Teste que prova comportamento | Matriz: venda+sim, ilegível, sem produto, cadastro, isolamento; fake decoder na CI.               | PASS      |
| Produto / MVP                    | SHOULD US-068 no harness de engenharia; WhatsApp real e cadastro completo ficam fora.             | PASS      |

Não há violação a justificar.

## Project Structure

### Documentation (this feature)

```text
specs/007-foto-codigo-barras/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── agent-barcode-photo.md
```

### Source Code (repository root)

```text
packages/
├── contracts/src/agent/
│   ├── message.ts              # text e/ou image
│   └── message.test.ts
├── core/src/registration/
│   └── register-product.ts     # findProductByBarcode (reuso)
└── agent/src/
    ├── types.ts                # IncomingMessage.image; BarcodeDecoder
    ├── barcode-decoder.ts      # FakeBarcodeDecoder
    ├── process-message.ts      # portão da foto antes do LLM
    ├── catalog.ts              # create_sale inalterada; AgentUseCases + findByBarcode
    ├── create-runtime.ts
    └── *.test.ts
apps/api/src/
├── composition.ts              # injeta decoder fake (e real se configurado)
├── routes/agent.ts             # encaminha image em bytes
└── routes/agent.test.ts
```

**Structure Decision**: alteração vertical nos pacotes existentes. Contrato da
mensagem em `contracts`; identificação em `core`; decode e roteamento no
`agent`; a API só valida e injeta.

## Implementation Outline

1. Estender `agentMessageInputSchema` com imagem opcional e refine (texto ou
   foto); testes de contrato.
2. Declarar `BarcodeDecoder` e `FakeBarcodeDecoder`; opcionalmente adapter
   real atrás da mesma porta, nunca na CI.
3. Expor `findProductByBarcode` em `AgentUseCases` e composition (já existe em
   `core`).
4. Em `processMessage`, se houver imagem: decode → lookup → tabela de rotas
   da spec **antes** de `llm.decide`. Sem imagem, laço atual.
5. Caminho de venda: qty 1 e preço de tabela; sem pagamento → `clarify`; com
   pagamento inequívoco → pendência `create_sale` existente.
6. Recusas e cadastro: textos estáveis do contrato; histórico só com
   placeholder; bytes fora do log.
7. Testes por camada e comandos do [quickstart](./quickstart.md). Atualizar
   README do agente e o ledger no mesmo PR.

## Complexity Tracking

Nenhuma exceção à constitution é necessária.
