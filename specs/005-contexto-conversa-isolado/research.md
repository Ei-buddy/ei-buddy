# Research: Contexto de conversa isolado por empresa (NR-062)

**Date**: 2026-09-17  
**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Ambiguidades de produto já fecharam na spec e na [ADR-0016](../../docs/decisoes/adr/0016-memoria-da-conversa-tabelas-nossas.md). Aqui fecham escolhas técnicas sobre o código atual (NR-060/121 + stub de identidade da NR-061).

---

## 1. Onde o histórico mora

**Decision**: Gravar turnos na tabela `messages` já existente, pendurados na **mesma** row de `conversations` que a NR-061 cria no `put` da confirmação. Porta `ConversationStore` em `core`; implementação em `db` com `withTenant`; `packages/agent` **não** importa `db`. `InMemoryConversationStore` só no teste unitário do laço.

**Rationale**:

- ADR-0016 e o [contrato de identidade](../004-sensitive-action-confirm/contracts/conversation-identity.md) já disseram: NR-062 grava `messages` nessa row. Segunda tabela ou Redis seria o recorte que a ADR rejeitou.
- O hexágono da NR-061 (porta em `core`, fake no `agent`, Postgres no `db`, composition instancia) é o precedente. Copiar o desenho evita um segundo estilo de persistência no assistente.
- Memory/Storage Mastra em `public` quebram ADR-0001 (sem `company_id`) e ADR-0010.

**Alternatives considered**:

- `@mastra/memory` / Storage PG do framework — rejeitado (ADR-0016 opção B).
- Redis / memória de processo — rejeitado (RF-105 falha no deploy; ADR opção C).
- Porta só em `agent`, sem `core` — rejeitado (expurgo é job; worker chama caso de uso, não o runtime do assistente).

---

## 2. Identidade: `number_from`, não rename para `peer`

**Decision**: Manter a coluna `conversations.number_from` (0007) e o UNIQUE parcial da 0018 `(company_id, channel, number_from) WHERE deleted_at IS NULL`. Mapear `chaveDaConversa` exatamente como a NR-061:

| `conversationKey`          | channel    | `number_from` |
| -------------------------- | ---------- | ------------- |
| `app:{companyId}:{userId}` | `app`      | `{userId}`    |
| `wa:{companyId}:{peer}`    | `whatsapp` | `{peer}`      |

Extrair o upsert (SELECT vigente → INSERT … ON CONFLICT DO NOTHING → SELECT de novo) para um módulo compartilhado em `db` (`conversation-identity.ts`), usado por confirmação **e** histórico. Sem migration de rename.

**Rationale**: o schema real e a NR-061 já chamam a coluna `number_from`. O [esquema.md](../../docs/arquitetura/esquema-postgresql.md) diz `peer` — atualizar o doc nesta fatia, não o catálogo. Rename agora brigaria com o UNIQUE da 0018 e com o store de confirmação.

**Alternatives considered**:

- `ALTER … RENAME number_from TO peer` — rejeitado nesta fatia (custo sem ganho de comportamento; ADR usa “peer” como conceito, não como identificador SQL obrigatório).
- Aceitar `number_from` nulo — rejeitado (UNIQUE parcial não cobre NULL; fail-closed igual à NR-061).

---

## 3. HTTP `app` e Studio `wa` não cruzam

**Decision**: Dois harnesses só compartilham histórico quando a **identidade** é a mesma (`company_id` + `channel` + `number_from`). `POST /agent/messages` continua `channel: 'app'` + `userId`; Studio continua `channel: 'whatsapp'` + número forjado. **Não** unificar chaves nesta fatia.

A US6 da spec (“falou no HTTP, continuou no painel”) lê-se com o FR-011: mesmo interlocutor **no mesmo canal**. Teste de “os dois harnesses” = duas chamadas a `processMessage` com a **mesma** `IncomingMessage` identity, ou dois POSTs HTTP, ou dois turnos Studio no mesmo preset — não um POST `app` seguido de chat `wa`.

**Rationale**: o contrato 004 **proíbe** tratar HTTP e Studio como a mesma row; `chaveDaConversa` e a ADR-0016 incluem o canal na chave; confirmação já se isola assim. Unificar agora misturaria pendência e histórico sem requisito de produto (o lojista em produção terá um canal só).

**Alternatives considered**:

- Forçar HTTP a `whatsapp` + peer forjado — rejeitado (reabre o contrato 002).
- Chave só `companyId+peer` ignorando canal — rejeitado (contradiz ADR-0016 e a 0018).

---

## 4. Janela, idle e a mesma row

**Decision**:

1. **Mesma conversa vigente** enquanto `deleted_at IS NULL`. Idle **não** cria row nova e **não** apaga mensagens.
2. `loadActive(companyId, conversationKey, now)`:
   - acha a row vigente (mesmo upsert/SELECT da identidade);
   - se não há mensagens, devolve `[]`;
   - se `now - max(created_at)` das mensagens vigentes **> 2 h**, devolve `[]` (contexto inativo);
   - senão devolve as **últimas 12** (`ORDER BY created_at DESC LIMIT 12`, depois ordem cronológica para o modelo).
3. Mensagens **depois** de um recomeço (nova âncora no texto) entram no recorte assim que passam a ser as mais recentes — o trecho ocioso simplesmente não é carregado.
4. Constantes injetáveis no store/runtime: `idleMs = 2h`, `window = 12`. Testes avançam `ctx.now`.

**Rationale**: ADR-0016: “a conversa deixa de ser ativa **para anáfora**”; “ou menos, se o idle tiver cortado antes”. RF-106 pede não aplicar contexto antigo, não destruir o fio. FR-007 (anáfora no recomeço) cai naturalmente: só o pós-idle entra nas 12.

**Alternatives considered**:

- Fechar a row no idle (`deleted_at`) e abrir outra — rejeitado (quebra o stub da confirmação ainda pendente nos 5 min; idle 2 h ≫ TTL 5 min, mas misturar ciclos é frágil).
- Contar tokens em vez de 12 mensagens — rejeitado (ADR: revisitar só com volume medido).

---

## 5. Como o histórico chega no `decide`

**Decision**: Estender `LlmPort.decide` com `history: readonly { role, body }[]` (já recortado pelo store). `processMessage` carrega **antes** do `decide`, **não** no caminho de confirmação pendente (`sim`/`não` não chama o modelo).

- **MastraLlm**: inclui o recorte no `generate` (lista de mensagens se a API atual aceitar; senão prefixo compacto no texto, ainda limitado às 12). `maxSteps: 1` permanece. **Não** ligar `@mastra/memory`.
- **FakeLlm**: o reconhecedor de leitura **ignora** history (frases completas continuam a casar). Testes de anáfora injetam um `LlmPort` stub que **lê** o history e devolve a tool com o id ancorado — isso é o que prova RF-105 na CI, não o regex do falso.
- Provedor real + “ele” é smoke manual no harness (como RNF-006), fora da Actions.

`tool_calls` jsonb da mensagem do assistente (e, se houver, da user após execute) guarda ids já resolvidos naquele turno (`customerId`, `saleId`, `productId` quando a tool os tiver). O stub de teste pode ler isso; o modelo vê o **texto**, não um perfil permanente.

**Rationale**: constitution V — teste que só “chama generate” não prova anáfora. Stub + janela limitada prova o contrato. O falso não deve “adivinhar João” por regex de pronome (risco de mutação errada, o mesmo viés da NR-060).

**Alternatives considered**:

- Resolver “ele” em código determinístico no `processMessage` — rejeitado como produto (é trabalho do modelo); ok só no **stub de teste**.
- Memory Mastra thread — rejeitado (ADR-0016).
- Mandar o fio inteiro — rejeitado (RNF-075 / teto 12).

---

## 6. Quando gravar o turno

**Decision**: Depois de cada resposta visível (`answer` / `clarify` / `unknown` / `confirmation`), persistir **duas** linhas vigentes: `user` (texto de entrada) e `assistant` (texto da resposta). `ignored` (peer desconhecido) **não** grava. Caminho de confirmação (`sim`/`não`/ambíguo/expirado) também grava — é turno do fio, mesmo sem `decide`.

Falha ao persistir **não** desfaz o efeito de negócio já executado (a venda não depende do chat). Loga sem o corpo (RNF-034) e segue. Teste cobre o happy path; não há transação única chat+venda (venda já tem a transação dela em `core`).

**Rationale**: anáfora precisa do que a lojista **e** o assistente disseram. Amarrar `INSERT messages` na transação da venda misturaria chat com caixa e violaria “expurgo não apaga venda”.

**Alternatives considered**:

- Só gravar user — rejeitado (o modelo precisa da resposta anterior para “essa”).
- Gravar antes do `decide` só o user — possível, mas a janela do **próximo** turno ficaria sem o assistente atual; gravar o par no fim é um write.

---

## 7. Expurgo (RNF-035)

**Decision**:

1. Caso de uso em `core`: `purgeConversationHistory(deps, ctx)` com `ctx.now` injetado, `channel: 'job'`.
2. Mensagens com `created_at <= now - 30 dias` e `deleted_at IS NULL`: **DELETE** (não há FK de `confirmations` para `messages`; o corpo não pode permanecer — US-051).
3. Conversas vigentes **sem** mensagens restantes: `deleted_at = now` (não DELETE da row — `confirmations.conversation_id` é `ON DELETE RESTRICT`). UNIQUE parcial da 0018 permite nova identidade depois.
4. Venda, cadastro, `audit_logs` **intocados**.
5. Fila BullMQ `conversation-purge` (kebab-case, sem `:`). Consumidor fino, no molde de `charge-overdue`: ignora payload, chama o caso de uso. `removeOnFail: false` (RNF-062). Agendamento = o mesmo padrão da varredura diária já existente (não inventar cron novo). CI prova o caso de uso + repositório com relógio injetado, não o calendário.

Índice novo (0019): `messages (company_id, conversation_id, created_at DESC) WHERE deleted_at IS NULL` — janela e idle sem seq scan.

**Rationale**: “corpos não permanecem” = DELETE, não `body = ''` com texto ainda recuperável no WAL da aplicação. Soft-delete da conversa preserva o histórico de confirmação. Job verificável é o aceite da ADR; a regra mora em `core` para o worker não decidir retenção.

**Alternatives considered**:

- Só `deleted_at` nas messages mantendo `body` — rejeitado (o texto continua no banco; falha US-051).
- `body = ''` + `deleted_at` — aceitável se DELETE assustar; preferir DELETE por simplicidade (sem FK).
- Expurgar só quando o lojista pede — rejeitado (RNF-035 é rotina, não self-service).

---

## 8. Isolamento e 404

**Decision**: Todo método do store recebe `companyId` explícito e roda em `withTenant`. Leitura/append/expurgo de outra loja = ausência / no-op, nunca o corpo. Teste Postgres com duas empresas (mesmo padrão da NR-061). `companyId` do Studio request context continua ignorado.

**Rationale**: constitution IV; spec FR-002/SC-003.

---

## 9. Confirmação permanece outra máquina

**Decision**: Idle 2 h **não** altera `expiresAt` de 5 min. `loadActive` **não** roda no ramo `tratarConfirmacao`. Esta fatia não mexe em aceite/recusa/ambíguo. Se a identidade ainda não existir (primeiro turno só de consulta), o store de histórico faz o **mesmo** upsert — consulta também cria o fio.

**Rationale**: spec FR-015; ADR-0016 item 5.

---

## 10. Docs e ledger no mesmo PR

**Decision**: Atualizar `packages/agent/README.md` (NR-062 feito; 12 / 2 h / 30 d), `docs/arquitetura/integracoes/mastra.md`, `docs/arquitetura/esquema-postgresql.md` (`number_from` + UNIQUE 0018), nota em `privacy-repository` (“caso de uso ligado”), ledger NR-062 → ✅. Sem variável de ambiente nova (números são constantes da ADR). Sem Memory Mastra no README como “próximo passo desta fatia”.

**Rationale**: DoD da constitution; harness muda o contrato do módulo. Números fixos na ADR não merecem env neste recorte (revisar a ADR para mudar).
