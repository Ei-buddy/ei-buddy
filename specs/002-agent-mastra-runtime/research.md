# Research: Assistente — runtime mínimo (NR-060)

**Date**: 2026-09-16  
**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Todas as ambiguidades de produto foram resolvidas no `/speckit-clarify`. Aqui fecham escolhas técnicas para implementação.

---

## 1. Estado atual do código vs DoD

**Decision**: Tratar NR-060 como **fechamento de lacunas** sobre o esqueleto já existente (`processMessage`, Mastra LLM, FakeLlm, catálogo parcial, `POST /agent/messages`), não como greenfield.

**Rationale**: README/ADR-0010 e o pacote já descrevem o laço correto (tools Mastra = identidade; execução no catálogo após confirmação). Reescrever dobraria custo e risco de divergir do hexágono.

**Alternatives considered**:

- Greenfield em pacote novo — rejeitado (já há fronteiras e testes).
- Servidor HTTP Mastra como canal — rejeitado (ADR-0010; Studio = NR-121).

**Gaps a fechar**:

| Gap                                              | Spec       | Ação                                                                                                                                   |
| ------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| RF-108 (faturamento, custo, despesas, resultado) | US-053     | Tool `period_summary` (ou renomear uso) → `buildDre` / `dreInputSchema`; `revenue_by_month` deixa de ser a resposta de “resumo do mês” |
| RF-107 cobrança                                  | US-052     | Tool `send_charge` + caso de uso fino em `core` + `MessageSender` falso                                                                |
| RF-149–151                                       | US-077–079 | Tools de recusa tipadas **ou** decisões FakeLlm/Mastra → texto fixo sem efeito; preferir tools `refuse_*` sem `execute` de negócio     |
| Porteiro harness                                 | FR-001b    | Endurecer: não-prod ou flag; documentar fixture; produção já barra `fake`                                                              |
| FakeLlm DoD                                      | SC-001     | Expandir `script()` / reconhecedor só para leituras seguras; mutações só via script nos testes                                         |
| RNF-072/073                                      | FR-020     | Contador por `companyId` + respeito a `AGENT_MONTHLY_BUDGET_CENTS`                                                                     |
| RF-109                                           | dívida     | Não implementar; registrar no ledger/README                                                                                            |

---

## 2. Resumo do período (RF-108)

**Decision**: Acionar `buildDre` (`packages/core`) com `dreInputSchema` / `DreOutput` de `contracts`. Formatador da tool devolve faturamento (receita), custo, despesas e resultado em texto truncável. “Resumo do mês” no FakeLlm aponta para esta tool, não para `revenue_by_month`.

**Rationale**: Comentário em `build-dre.ts` já cita RF-108 e o assistente. `revenueByMonth` soma **vendas**; DRE soma **lançamentos** — perguntas diferentes (`contracts` report vs accounting). RF-108 pede custo/despesas/resultado → DRE.

**Alternatives considered**:

- Estender `revenue_by_month` com custo/despesa — rejeitado (mistura séries incompatíveis).
- LLM “resumir” números — rejeitado (viola RF-101 / constitution III).

---

## 3. Cobrança (RF-107)

**Decision**: Introduzir (ou expor) em `core` um caso de uso do tipo `sendCustomerCharge(ctx, { customerId | phone/name resolvido })` que: (1) lista recebíveis em aberto do cliente; (2) se zero, retorna “nada a cobrar”; (3) senão, envia via porta `MessageSender` (adapter falso em teste) com consentimento exigido pela porta; (4) confirma envio ao operador. Tool `send_charge` com `mutatesValue: true` (envio a terceiro).

**Rationale**: Worker `charge-overdue` é varredura em lote (RF-071), não o disparo pontual da US-052. Reusar a porta `MessageSender` mantém o hexágono; Meta real fica NR-046.

**Alternatives considered**:

- Enfileirar só no worker sem use case — rejeitado (confirmação e mensagem ao lojista ficam soltas).
- Chamar PagMaxx/PSP direto do agent — rejeitado (fora de `core`).

---

## 4. Recusas (RF-149–151)

**Decision**: Três tools (ou uma `refuse_out_of_scope` com enum tipado) cujo `execute` **não** grava nada e só devolve texto padrão orientando o app. Instruções Mastra + FakeLlm roteiam certificado/extrato/“emite nota” para essas tools. Não há schema de upload nesta fatia: pedido em texto basta para o aceite.

**Rationale**: Evita o modelo “inventar” recusa fraca ou, pior, tentar cadastrar emitente. Texto fixo é testável (SC-004).

**Alternatives considered**:

- Só `unknown` + capacidades — rejeitado (não diferencia recusa de compliance de “não entendi”).
- Middleware regex antes do LLM — opcional como reforço; não substitui tools tipadas.

---

## 5. Porteiro do harness (clarificações)

**Decision**:

1. `NODE_ENV === 'production'` → assistente só com `AGENT_PROVIDER=mastra` + chave (já existe); **não** é canal de produto lojista nesta fatia — documentar como eng. até NR-113/121.
2. Em não-produção: `POST /agent/messages` exige sessão autenticada da **fixture** (fluxo: criar user/empresa → popular → login → POST).
3. Flag opcional `AGENT_HARNESS=1` (ou equivalente em `env`) se staging precisar do harness com `NODE_ENV` próximo de prod — default off em produção.
4. Não inventar segundo provedor de auth “só eng”: a fixture **é** um owner de teste; o porteiro é ambiente + não servir produto.

**Rationale**: Alinha FR-001/001b sem contradizer Better Auth existente. “Nenhum usuário final” = não liberar UX de produto; testes usam sessão de fixture.

**Alternatives considered**:

- Header secreto separado da sessão — adiado (complexidade; fixture + não-prod basta no MVP eng.).
- Desligar rota em tudo que não seja `test` — rejeitado (quebra `pnpm dev` harness).

---

## 6. FakeLlm vs Mastra no DoD

**Decision**: SC-001 (100% DoD sem chave) = FakeLlm com reconhecedor de **leituras** + `script()` obrigatório para cadastro/venda/cobrança/recusas nos testes de aceite. SC-006 = um smoke manual/opcional com `AGENT_PROVIDER=mastra` fora da CI.

**Rationale**: Já documentado no FakeLlm: interpretar venda sem modelo é perigoso. CI não deve chamar OpenAI (constitution V / adapters).

**Alternatives considered**:

- Gravar cassettes OpenAI na CI — rejeitado (custo, flaky, segredo).
- Expandir regex para venda completa — rejeitado (RF-100 exige NL real ou script controlado).

---

## 7. Confirmação e TTL

**Decision**: Manter `InMemoryConfirmations` e `CONFIRMATION_TTL_MS = 5 * 60_000`. Persistência = NR-061.

**Rationale**: Spec aceita volátil; código já cobre expiração/ambiguidade.

---

## 8. Consumo de IA (RNF-072/073)

**Decision**: Em `processMessage` / wrapper do `LlmPort.decide`, registrar unidades por `companyId` (chamadas ou tokens estimados). Se `AGENT_MONTHLY_BUDGET_CENTS` definido e estourado → resposta avisando degradação (só FakeLlm ou recusa de generate), **sem** executar mutação.

**Rationale**: Env já existe; falta o contador. Começar simples (contagem de decides) é suficiente para a fatia; refinar tokens depois.

**Alternatives considered**:

- Só log sem teto — rejeitado (FR-020 / RNF-073).
- Billing package completo — fora de escopo (NR-063).

---

## 9. Dependências Mastra / ambiente

**Decision**: Manter `@mastra/core` já no `package.json` do agent; não adicionar `@mastra/server` / Studio. `pnpm install` + `AGENT_PROVIDER=fake` basta para quickstart. Docs: atualizar quickstart da feature e README do agent com fluxo fixture.

**Rationale**: ADR-0010; skill Mastra confirma Agent+tools como biblioteca.

---

## 10. Atualização do ledger

**Decision**: No PR da NR-060, marcar NR-060 ✅ e registrar RF-109 como dívida apontando tarefa futura (comentário no ledger ou nova linha só se o processo exigir — preferir nota na entrega + README agent).

**Rationale**: Convenção do ledger: atualizar no PR.
