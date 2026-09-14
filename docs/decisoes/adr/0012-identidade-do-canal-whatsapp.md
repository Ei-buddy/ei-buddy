---
adr: 0012
titulo: Identidade do canal WhatsApp pelo celular do owner, sem código
status: aceita
data: 2026-09-13
decisores:
  - Trilha 2 — Plataforma & Integrações
  - Produto
substitui: null
substituida_por: null
---

# ADR-0012 — Identidade do canal WhatsApp pelo celular do owner, sem código

|                       |                                 |
| --------------------- | ------------------------------- |
| **Status**            | Aceita                          |
| **Data**              | 2026-09-13                      |
| **Decisores**         | Trilha 2 · Produto              |
| **Decisão de origem** | [DEC-023](../README.md#dec-023) |

## Contexto

O canal WhatsApp não carrega sessão. O desenho antigo ([RF-094](../../produto/requisitos-funcionais.md)
como estava, [US-046](../../produto/user-stories.md#us-046--vincular-o-número-da-loja))
pedia código no próprio número para criar o vínculo. Um plano paralelo propunha
orquestrar isso com **Workflow Mastra**, `MastraAuthBetterAuth` e
`@chat-adapter/whatsapp`, cache Redis na frente do Better Auth, e memória do
Mastra por `user_id`.

Três fatos do repo já fechavam parte da pergunta:

1. Better Auth **prova** identidade no app ([ADR-0003](0003-better-auth-como-prova-de-identidade.md)).
   Acesso e tenant moram em `users` + `company_users`. O webhook da Meta **não**
   traz cookie nem Bearer do Better Auth.
2. Mastra é biblioteca em `packages/agent` ([ADR-0010](0010-mastra-e-gpt-4o-mini.md)):
   `processMessage` + tools. Não é `MastraServer`, não é Channel, não é
   Workflow como porta do WhatsApp.
3. Isolamento é `company_id` (RLS, [ADR-0001](0001-rls-por-linha.md)). Um
   usuário pode ter várias empresas ([US-059](../../produto/user-stories.md#us-059--fazer-login)).
   `ExecutionContext` exige `companyId`. Memória por `user_id` mistura lojas
   ([RF-106](../../produto/requisitos-funcionais.md)).

O que ainda estava em aberto era **como nasce o vínculo** e **o que o
assistente faz neste recorte** sem fechar [DEC-003](../README.md#dec-003)
(provedor) nem [DEC-011](../README.md#dec-011) (memória).

Não se media, neste momento, volume de conversas/mês ([QST-002](../README.md#qst-002))
nem o custo real de OTP no chip (o envio também espera a DEC-003).

## Opções consideradas

### Opção A — Código no número (RF-094 original)

A lojista inicia no app; um código no WhatsApp prova a posse do chip.

| Prós                                      | Contras                                                 |
| ----------------------------------------- | ------------------------------------------------------- |
| Prova de posse; dificulta ocupação        | Depende de enviar OTP — [DEC-003](../README.md#dec-003) |
| Alinha ao modelo de ameaças de 2026-09-08 | Duas etapas depois de um cadastro que já pede telefone  |

### Opção B — Celular obrigatório no cadastro do owner **é** o vínculo

Sem código. `users.phone` do owner, único (`users_phone_unico`), cola na
**primeira** empresa. Só o owner opera o canal. Troca no app substitui.

| Prós                                                    | Contras                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Destrava RF-094/095 sem provedor de WhatsApp            | Sem prova de posse: quem digitou o número no form fala pelo chip (T5 mais fraco) |
| Casa com `findByPhone` e `PeerDirectory` já desenhados  | Segunda loja some no Buddy; staff/contador não operam o canal                    |
| Troca de chip continua no segundo canal (sessão do app) | Recupera o risco de ocupação que o código existia para fechar                    |

### Opção C — Stack oficial Mastra (Server + Channel + Better Auth)

Webhook em `/api/agents/…/channels/whatsapp`; `server.auth` com Better Auth.

| Prós                          | Contras                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| Docs do Mastra descrevem isso | Reabre a [ADR-0010](0010-mastra-e-gpt-4o-mini.md) (proíbe MastraServer) |
|                               | Better Auth não autentica POST da Meta                                  |
|                               | Substitui `packages/whatsapp` e a fila Fastify                          |

### Opção D — Memory do Mastra por `user_id`

Histórico atrelado à pessoa.

| Prós                     | Contras                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| Casa com o plano inicial | Quebra [RF-106](../../produto/requisitos-funcionais.md) (isolamento por empresa) |
|                          | Tabelas do Memory sem `company_id` em `public` quebram a ADR-0001                |
|                          | Fecha a [DEC-011](../README.md#dec-011) por omissão                              |

## Decisão

**Escolhemos a opção B para a identidade do canal.** As opções C e D foram
recusadas. A opção A (código) fica **abdicada neste recorte**: RF-094 e US-046
passam a descrever o celular do cadastro, não o OTP.

1. **Barragem.** `users.phone` do **owner** → primeira empresa em
   `company_users` → `{ companyId, userId, role: owner }`. Número que não é
   esse celular: silêncio ([RF-095](../../produto/requisitos-funcionais.md)).
   Better Auth não entra no webhook.
2. **Entrada.** Fastify → (fila já existente) → `processMessage`. Sem Workflow
   Mastra, sem `@chat-adapter/whatsapp`, sem `MastraAuthBetterAuth`.
3. **Multi-empresa.** O chip cola na primeira empresa. As outras só no app.
4. **Quem opera.** Só o owner do cadastro. Staff e contador não têm canal.
5. **Conta restrita.** Igual ao app ([RF-117](../../produto/requisitos-funcionais.md) /
   [RF-118](../../produto/requisitos-funcionais.md)): consulta responde; ação
   que grava vira texto pronto, sem tool de escrita.
6. **Troca de celular.** Só no app, com sessão. O número novo substitui o
   vínculo; o antigo deixa de operar. Número ocupado já é recusado pelo índice
   único, sem revelar de quem é.
7. **Redis.** Continua fila (`whatsapp-send`). Identidade sempre no Postgres.
   Cache telefone→contexto só se [RNF-018](../../produto/requisitos-nao-funcionais.md)
   doer — e com invalidação na troca.
8. **Provedor.** [DEC-003](../README.md#dec-003) **permanece aberta**. Este
   recorte se exercita com `WHATSAPP_PROVIDER=fake` e `POST /agent/messages`.
9. **Isolamento cruzado.** `ExecutionContext` + tools sem id de terceiro + RLS.
   Processor Mastra e `user_id` no argumento da tool **não** são o controle
   ([T1](../../arquitetura/seguranca.md#modelo-de-ameaças)).
10. **Memória.** [DEC-011](../README.md#dec-011) **permanece aberta**. Sem
    Memory Mastra. Sem gravar `conversations` / `messages`. Confirmação
    continua in-memory até a [NR-061](../../processo/task-ledger.md).

A [ADR-0002](0002-autenticacao-identidade-propria.md) continua valendo: o
número não é identidade forte; operação privilegiada exige sessão do app. O
que muda é **como o primeiro vínculo nasce** (cadastro, não código).

## Consequências

### Positivas

- RF-094 e RF-095 deixam de esperar a DEC-003 para existir como regra de
  `core` / `agent`. Dá para testar a barragem no fake.
- Um caminho só: o mesmo `processMessage` do `POST /agent/messages`.
- Sem segunda composição (Mastra Server) e sem cache de credencial no Redis.

### Negativas

- **T5 fica mais fraco.** Quem cadastra o celular de outra pessoa ocupa o
  canal. Confirmação em banda (RF-103) **não** corrige isso — a ADR-0002 já
  registrou.
- Lojista com duas empresas vê no Buddy só a primeira. Staff não tem WhatsApp.
- “Confirma?” morre se o processo reiniciar (NR-061 adiada neste recorte).
- Sem teste no chip real até a NR-046.

### Neutras

- `signupInputSchema.phone` deixa de ser opcional. O índice `users_phone_unico`
  já existia.
- [RF-132](../../produto/requisitos-funcionais.md) registra a troca de celular.
- Chave de conversa no agente continua `wa:${companyId}:${peer}` — não se usa
  como persistência até a DEC-011.

## Impacto na documentação

- [x] `docs/decisoes/README.md` — DEC-023 fechada; DEC-003 e DEC-011 anotadas
- [x] `docs/produto/requisitos-funcionais.md` — RF-094, RF-132
- [x] `docs/produto/user-stories.md` — US-001, US-046
- [x] `docs/arquitetura/seguranca.md`, `fluxos.md`, `integracoes/mastra.md`
- [x] `packages/agent/README.md`, `packages/whatsapp/README.md`
- [x] `docs/processo/task-ledger.md` — NR-113
- [x] `specs/001-eibuddy-mvp/spec.md` — FR-033

## Quando revisitar

- Ocupação de número ou SIM swap gerar incidente real (voltar à opção A).
- Contador/staff precisarem do canal (quebra “só owner”).
- Lojista multi-loja exigir seletor no WhatsApp (quebra “primeira empresa”).
- RNF-018 doer no `findByPhone` (aí cache Redis com invalidação).
- DEC-003 fechar — o adapter real entra atrás da mesma porta, sem reler esta
  ADR, salvo se o provedor exigir um segundo identificador (WABA por loja).
