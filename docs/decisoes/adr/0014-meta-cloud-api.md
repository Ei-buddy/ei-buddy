---
adr: 0014
titulo: Meta Cloud API como provedor de WhatsApp
status: aceita
data: 2026-09-15
decisores:
  - Produto
  - Trilha 2 — Plataforma & Integrações
substitui: null
substituida_por: null
---

# ADR-0014 — Meta Cloud API como provedor de WhatsApp

|                       |                                 |
| --------------------- | ------------------------------- |
| **Status**            | Aceita                          |
| **Data**              | 2026-09-15                      |
| **Decisores**         | Produto · Trilha 2              |
| **Decisão de origem** | [DEC-003](../README.md#dec-003) |

## Contexto

A [DEC-003](../README.md#dec-003) pedia o provedor do canal. A porta
`MessageSender`, o adapter falso e a suíte de contrato já existem
([NR-045](../../processo/task-ledger.md)). A identidade do canal já fechou:
o celular do owner fala com o número da plataforma
([ADR-0012](0012-identidade-do-canal-whatsapp.md)). O runtime do agente já
fechou ([ADR-0010](0010-mastra-e-gpt-4o-mini.md)). O que faltava era **quem
entrega e recebe o byte no chip**.

Forças: custo por conversa contra [RNF-072](../../produto/requisitos-nao-funcionais.md);
janela de 24 h e mensagem de modelo; confiabilidade do webhook;
**risco de banimento** — biblioteca não oficial derruba o produto sem aviso.
Não se media, neste momento, volume de conversas ([QST-002](../README.md#qst-002))
nem o preço real da conversa de serviço na Cloud API.

O número que o lojista chama **é o da plataforma**, não um WABA por loja. Um
provedor que exigisse cadastro Meta por lojista quebraria esse recorte.

## Opções consideradas

### Opção A — Meta Cloud API direto

A plataforma opera **um** WhatsApp Business Account e **um** número de
negócio. Envio e webhook passam por `graph.facebook.com`. Sem BSP no meio.

| Prós                                                                 | Contras                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Canal oficial — o critério de banimento da DEC-003 sai da mesa       | Verificação de negócio, nome de exibição e limites de taxa são nossos                            |
| Preço de conversa sem margem de intermediário                        | Sem buffer: suspensão da WABA pela Meta cai o assistente inteiro                                 |
| Webhook e mídia documentados; HMAC `X-Hub-Signature-256` casa com RNF-028 | Modelo fora da janela de 24 h é Graph `type: template` — a porta ainda não tem esse método |
| Casa com ADR-0012: um número nosso, o chip do owner é o peer         | App Secret e token de system user são mais um operador na [DEC-016](../README.md#dec-016)        |

### Opção B — BSP (Twilio, 360dialog, Z-API, Gupshup)

| Prós                                      | Contras                                                          |
| ----------------------------------------- | ---------------------------------------------------------------- |
| Cadastro e template mais rápidos no começo | Margem por conversa, em cima do preço da Meta                    |
| Alguns isolam a WABA se a Meta pune o BSP  | Mais um subprocessador de dado de conversa                       |
|                                            | Z-API e similares flertam com o não-oficial que a DEC descartou  |

### Opção C — Biblioteca não oficial

| Prós    | Contras                                                                 |
| ------- | ----------------------------------------------------------------------- |
| Barato  | Banimento sem recurso — o produto inteiro depende deste canal           |
|         | Fora de cogitação: a própria DEC-003 pedia descartar esta opção         |

## Decisão

**Escolhemos a opção A.**

O adapter real ([NR-046](../../processo/task-ledger.md)) fala com a
[Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api).
`WHATSAPP_PROVIDER=meta` em staging e produção; `fake` continua obrigatório
no local. Um WABA, um `PHONE_NUMBER_ID` da plataforma. O lojista não cria
conta Meta para usar o assistente.

O que foi abdicado: BSP como atalho de cadastro; qualquer stack não oficial;
WABA por loja.

Contrato: [`integracoes/meta-cloud-api.md`](../../arquitetura/integracoes/meta-cloud-api.md).
Identidade do peer: [ADR-0012](0012-identidade-do-canal-whatsapp.md) — esta
ADR não a relê, salvo se a Meta passar a exigir identificador por loja.

## Consequências

### Positivas

- NR-046, o runtime (NR-060) e as tools do E11 (NR-115–119) deixam de esperar
  decisão. O que ainda trava memória é a [DEC-011](../README.md#dec-011).
- Assinatura de webhook é HMAC da Meta — o mesmo contrato da porta
  (`readInbound` sobre o corpo bruto).
- DANFE e cobrança no chip ([RF-048](../../produto/requisitos-funcionais.md),
  [RF-068](../../produto/requisitos-funcionais.md)) têm caminho oficial.

### Negativas

- **Operar WABA é trabalho nosso:** verificação, limite de qualidade,
  template aprovado, janela de 24 h. BSP faria isso por nós.
- **Dado de conversa vai para a Meta.** Entra na lista de operadores da
  [DEC-016](../README.md#dec-016), junto com OpenAI e Asaas.
- **A porta ainda não envia modelo.** Fora da janela, `outside_service_window`
  continua recusa até a NR-046 acrescentar o método. Inventar o shape agora
  seria desenhar o Graph às cegas no `core`; o vocabulário de template fica
  no adapter, atrás da porta.
- Custo por conversa só fecha o [RNF-072](../../produto/requisitos-nao-funcionais.md)
  quando [QST-002](../README.md#qst-002) der denominador.

### Neutras

- `WHATSAPP_PROVIDER=fake|meta`. Token, `PHONE_NUMBER_ID` e segredo de
  webhook já estão na matriz; a NR-046 acrescenta o *verify token* do
  handshake `GET` se ainda não houver variável.
- `POST /agent/messages` e o fake **não saem**. São o caminho de teste sem
  chip ([ADR-0012](0012-identidade-do-canal-whatsapp.md)).
- OTP por WhatsApp (Better Auth) continua atrás do mesmo adapter — não é
  outro provedor.

## Impacto na documentação

- [x] `docs/arquitetura/integracoes/meta-cloud-api.md`
- [x] `docs/arquitetura/visao-geral.md`, `modulos.md`, `principios.md`
- [x] `packages/whatsapp/README.md`, `packages/agent/README.md`
- [x] `docs/engenharia/ambientes.md`, `.env.example`
- [x] `DEC-003` marcada como 🟢 e apontando para esta ADR
- [x] `docs/processo/task-ledger.md` — NR-046 e cascata saem de 🚧

## Quando revisitar

- Meta suspender a WABA ou mudar preço de conversa de serviço de forma que
  fure RNF-072 depois de QST-002.
- Exigência nova de WABA ou embedded signup **por lojista** — aí esta ADR
  não cobre, e a ADR-0012 também reabre.
- Janela de 24 h ou política de template impedir cobrança/DANFE no recorte
  do MVP.
- BSP passar a ser mais barato *e* mais estável, com a mesma porta.
