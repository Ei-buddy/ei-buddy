# Implementation Plan: Conversar com o assistente pelo WhatsApp (NR-046)

**Branch**: `feat/NR-046-whatsapp-meta-cloud-api` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

## Summary

A dona com cadastro ativo passa a escrever no número de teste do produto e receber a resposta do assistente na mesma conversa. O adapter Meta, a barragem do celular e o `processMessage` já existem. Esta fatia liga o webhook a esse caminho, faz o celular sem o nono dígito casar com o cadastro, e devolve o texto pelo mesmo remetente. Número desconhecido ou inativo continua em silêncio. Cobrança a cliente, modelo fora da janela de 24 h e mídia ficam de fora.

## Technical Context

**Language/Version**: TypeScript, Node.js e pnpm workspace.

**Primary Dependencies**: Fastify (`apps/api`), Zod (`contracts` / `env`), adapter já existente em `packages/whatsapp` (`criarRemetenteMeta`, `responderVerificacao`), `processMessage` em `packages/agent`, `abrirCanal` em `packages/core`.

**Storage**: PostgreSQL com RLS. Sem migration nova. Identidade continua em `users.phone` + `channel_owner_by_phone` (migration 0028). Dedup da reentrega usa `webhook_events`, que já existe.

**Testing**: Vitest. Regra do nono dígito em `core`, sem banco. Rota do webhook com corpo gravado e remetente falso. Adapter real fora da CI (constitution: sandbox de provedor não entra no pipeline). Aceite no chip é o [quickstart](./quickstart.md), manual.

**Target Platform**: API Node.js acessível por HTTPS público só no aceite manual (túnel). Local e CI seguem `WHATSAPP_PROVIDER=fake`.

**Project Type**: Monorepo — `env`, `core`, `apps/api`. `whatsapp` só se o teste do handshake pedir ajuste; o envio e o HMAC já estão no adapter.

**Performance Goals**: uma resposta na conversa de teste em até 1 minuto (SC-001), no mesmo processo da API. Sem fila nova.

**Constraints**:

- Segredo de acesso, App Secret e verify token só em ambiente local. Não entram em spec, plano, teste, log nem repositório.
- O App Secret (`WHATSAPP_WEBHOOK_SECRET`) não é o token de acesso. Sem ele o POST recusa tudo.
- O token de acesso (`WHATSAPP_API_TOKEN`) e o Phone Number ID configuram o envio. O ID da conta WhatsApp Business não entra no código: o adapter já fala com o número pelo Phone Number ID.
- Webhook sem sessão. Assinatura inválida responde 401. Silêncio da RF-095 responde 200 e não envia texto.
- A resposta ao chip usa o `from` que a Meta mandou, não o celular canônico do cadastro.
- `sendCustomerCharge` e o worker `whatsapp-send` continuam no remetente falso. Esta fatia não passa a cobrar cliente.

**Scale/Scope**: uma conta e um número da plataforma (o de teste). O peer é o celular da dona. Sem WABA por loja.

## Constitution Check

_Gate inicial: PASS. Reavaliado após Phase 1: PASS._

| Princípio                        | Evidência no plano                                                                                           | Resultado |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------- |
| I. Um núcleo, dois canais        | A conversa chama o mesmo `processMessage` e as mesmas tools. A rota não reimplementa consulta nem gravação   | PASS      |
| II. Hexágono e fronteiras        | `whatsapp` não importa `core`. A cola fica em `apps/api`. O nono dígito fica em `core`, não no adapter       | PASS      |
| III. Integridade financeira      | Nenhuma regra de dinheiro nova. Reentrega não roda o turno duas vezes (`webhook_events`)                     | PASS      |
| IV. Isolamento de tenant         | `companyId` sai de `channel_owner_by_phone`, nunca do corpo. Número sem vínculo não grava inbox              | PASS      |
| V. Teste que prova comportamento | Matriz em [quickstart.md](./quickstart.md). CI com corpo gravado e remetente falso; chip real é manual       | PASS      |
| Segurança                        | HMAC no corpo bruto (RNF-028). Segredo fora do git (RNF-022). Log sem telefone inteiro nem texto da mensagem | PASS      |
| Produto                          | Só a dona ativa (ADR-0012, já filtrada no SQL). Consentimento de cliente final continua fora                 | PASS      |

Não há violação a justificar.

## Project Structure

### Documentation (this feature)

```text
specs/009-conversa-agente-whatsapp/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── webhook-whatsapp.md
```

### Source Code (repository root)

```text
packages/
├── env/src/api.ts                         # WHATSAPP_* incluindo VERIFY_TOKEN
├── core/src/agent/abrir-canal.ts          # chaves equivalentes, com e sem o 9
├── core/src/agent/abrir-canal.test.ts
└── db/src/                               # sem migration; teste do SQL ativo se faltar
apps/api/src/
├── composition.ts                        # remetente meta só na resposta do webhook; runtime com peers reais
├── routes/whatsapp-webhook.ts            # GET hub.challenge + POST corpo bruto
└── routes/whatsapp-webhook.test.ts
packages/whatsapp/src/meta-sender.ts      # reuso; não reinterpretar cadastro
```

**Structure Decision**: a borda HTTP nova mora em `apps/api`, no mesmo desenho do webhook do Asaas (corpo bruto, sem sessão). O adapter e a barragem não ganham um segundo produto.

## Implementation Outline

1. **Nono dígito** — `normalizarTelefoneDoCanal` passa a devolver as chaves equivalentes (canônica com 9 no móvel, e a forma de 10 dígitos). `abrirCanal` consulta nessa ordem e para na primeira. Fixo (local começando em 2–5) não ganha 9. O caso `5599998888` continua sem perder o DDD 55.
2. **Peers no runtime do webhook** — um `PeerDirectory` do agente cuja `resolve` chama `abrirCanal`. Não reutiliza o diretório de fixture do Studio. O runtime do `POST /agent/messages` não muda de canal.
3. **Env** — `WHATSAPP_PROVIDER`, `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_SECRET`, `WHATSAPP_VERIFY_TOKEN` em `packages/env`. Ausentes: a rota responde 503 e o resto da API sobe. Documentar em `.env.example` e `ambientes.md` sem valor real.
4. **Rotas** — `GET /webhooks/whatsapp` devolve o challenge em texto puro. `POST /webhooks/whatsapp` lê o corpo bruto, chama `readInbound`, e segue o [contrato](./contracts/webhook-whatsapp.md).
5. **Turno** — se `abrirCanal` autoriza, `webhook_events` (`provider = meta`, `event_id` = id da Meta) deduplica; `processMessage` com `channel: 'whatsapp'` e o `from` original; a resposta visível sai por `sendText` com consentimento `service_reply` e destino igual ao `from`. Silêncio não envia e não grava inbox.
6. **Testes** — matriz do quickstart. Sem chamada de rede à Meta na CI.
7. **Ledger** — NR-046 aponta para este quickstart quando o aceite manual passar. Não marcar ✅ só com a suíte falsa.

## Complexity Tracking

Nenhuma exceção à constitution é necessária.
