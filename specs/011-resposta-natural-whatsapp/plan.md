# Implementation Plan: Resposta natural no WhatsApp

**Branch**: `011-resposta-natural-whatsapp` | **Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

## Summary

A lojista passa a ver lido na hora, digitando só quando o assistente realmente responde, e a resposta em até cinco balões com a formatação que o WhatsApp desenha. Textos enviados em menos de 3 s viram um único pedido ao `processMessage`. A pausa vive num sequenciador em memória na API; lido, digitando, formatação e divisão vivem no adapter. O núcleo, o chat do aplicativo e o que o assistente é capaz de fazer não mudam.

## Technical Context

**Language/Version**: TypeScript, Node.js e pnpm workspace.

**Primary Dependencies**: Fastify (`apps/api`), adapter `packages/whatsapp` (`criarRemetenteMeta`), `processMessage` em `packages/agent`, caixa `WebhookInbox` em `packages/core`. Graph Messages API para status `read` e `typing_indicator`, no mesmo URL que o `sendText`.

**Storage**: Nenhum. Sequência e turno são memória do processo. Dedup da reentrega continua em `webhook_events`.

**Testing**: Vitest. Funções puras de formato e divisão em `whatsapp`, sem rede. Rota com relógio injetado e remetente falso. Adapter real fora da CI. Aceite no chip é o [quickstart](./quickstart.md), manual.

**Target Platform**: API Node.js, um processo. O mesmo limite que o mapa de idempotência do `sendText` já declara.

**Project Type**: Monorepo — `packages/whatsapp` e `apps/api`. `packages/agent` e `packages/core` não ganham regra desta fatia.

**Performance Goals**: lido em até 2 s após a chegada (SC-001), antes da pausa. Digitando ao começar a preparação e até 2 s depois do último balão (SC-002). A pausa acrescenta cerca de 3 s ao tempo que a resposta já leva hoje. Entre balões, 800 ms.

**Constraints**:

- A rota só devolve 200 depois do turno daquela sequência, para a Meta ainda reentregar se o processo cair no meio.
- Lido e digitando são melhor-esforço. Não bloqueiam a resposta (FR-019).
- Digitando não aparece durante a pausa.
- Número sem vínculo permanece em silêncio (NR-046, RF-095).
- Log sem telefone, sem corpo e sem token (RNF-034, RNF-022).
- Uma instância da API. Duas instâncias podem partir a sequência.
- Foto e demais tipos sem corpo de texto não entram na pausa.

**Scale/Scope**: um número da plataforma, uma conversa por dona. Sem presença no aplicativo, sem cobrança a cliente, sem mídia nova.

## Constitution Check

_Gate inicial: PASS. Reavaliado após Phase 1: PASS._

| Princípio                        | Evidência no plano                                                                                          | Resultado |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------- |
| I. Um núcleo, dois canais        | O webhook continua chamando o mesmo `processMessage`. Formatar e dividir não é regra de negócio             | PASS      |
| II. Hexágono e fronteiras        | Presença e formatação ficam em `whatsapp`, que não importa `core`. A cola da pausa fica em `apps/api`       | PASS      |
| III. Integridade financeira      | Nenhuma regra de dinheiro. Vários balões não viram várias gravações: uma chamada, chaves de envio distintas | PASS      |
| IV. Isolamento de tenant         | A chave da sequência leva `companyId` do vínculo, nunca do corpo. Número sem vínculo não grava inbox        | PASS      |
| V. Teste que prova comportamento | Matriz em [quickstart.md](./quickstart.md). CI com relógio e remetente falsos; chip é manual                | PASS      |
| Segurança                        | HMAC inalterado (RNF-028). Falha de presença não vaza segredo. Log sem dado pessoal                         | PASS      |
| Integrações                      | Timeout já existente no POST do adapter. Provedor fora não derruba o resto da API nem suprime a resposta    | PASS      |
| Produto                          | Confirmação explícita continua no texto do núcleo. O último balão só isola a pergunta que ele já faz        | PASS      |

Não há violação a justificar. O sequenciador em memória repete um limite que o adapter já documenta; não abre exceção de fronteira.

## Project Structure

### Documentation (this feature)

```text
specs/011-resposta-natural-whatsapp/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── presenca-whatsapp.md
    └── resposta-whatsapp.md
```

### Source Code (repository root)

```text
packages/whatsapp/src/
├── meta-sender.ts                 # POST de lido e de digitando, sem `to`
├── meta-sender.test.ts
├── fake-sender.ts                 # registra os sinais na ordem, para a rota
├── formatar-texto-whatsapp.ts     # função pura
├── dividir-resposta-whatsapp.ts   # função pura
└── *.test.ts
apps/api/src/
├── routes/whatsapp-webhook.ts     # sequenciador: pausa, união, partes, frase de falha
└── routes/whatsapp-webhook.test.ts
```

**Structure Decision**: apresentação do canal no adapter; orquestração da pausa na rota, que já é quem chama `processMessage`. Sem migration e sem porta nova em `core`.

## Implementation Outline

1. **Sinais** — o remetente Meta ganha marcar lido e mostrar digitando, no URL que já usa, sem passar pelo mapa de idempotência do `sendText`. O falso registra a ordem. Falha não lança para o chamador.
2. **Funções puras** — formatar e dividir conforme [contracts/resposta-whatsapp.md](./contracts/resposta-whatsapp.md). Testes de tabela, sem rede.
3. **Sequenciador na rota** — chave empresa + `from`, pausa de 3 s com relógio injetado, união por quebra de linha, uma chamada ao assistente, envio em ordem com digitando entre as partes. Texto sem corpo não entra na pausa. Número sem vínculo continua mudo. Reentrega do mesmo id espera o turno existente.
4. **Testes** — a matriz do [quickstart](./quickstart.md). `POST /agent/messages` permanece um bloco só.
5. **Documentação** — README de `packages/whatsapp` descreve lido, digitando e o limite de um processo. Sem variável nova e sem ADR: a chamada continua sendo a Cloud API da ADR-0014.

## Complexity Tracking

Nenhuma exceção à constitution é necessária.
