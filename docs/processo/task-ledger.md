# Task Ledger

Backlog completo dividido em três trilhas. **Fonte da verdade versionada** — o
Monday é a visualização; divergiu, o ledger ganha.

Importação: [`monday-import.csv`](monday-import.csv).

---

## Como ler

| Coluna     | Significado                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| **ID**     | `NR-xxx`, permanente. Aparece na branch, no título do PR, no rodapé do commit e no Monday                         |
| **Trilha** | 🔵 1 Núcleo & Dados · 🟠 2 Plataforma & Integrações · 🟢 3 Clientes                                               |
| **Est**    | estimativa em dias. **Acima de 2 dias, a tarefa deve ser quebrada**                                               |
| **Dep**    | tarefas que precisam estar concluídas antes                                                                       |
| **Bloq**   | o que impede: `DEC-xxx` (decisão em aberto) ou `NR-xxx → DEC-xxx` (dependência travada, com a decisão na raiz)    |
| **Status** | ⬜ a fazer, **pode começar hoje** · 🟨 em andamento · ✅ concluída · 🚧 bloqueada, por decisão ou por dependência |

**⬜ é promessa de que dá para pegar agora.** Tarefa cuja dependência está 🚧
também está 🚧, mesmo que nenhuma decisão fale dela diretamente: `Blocked` no
board é "travada por decisão **ou** dependência"
([rituais](rituais.md#estados-no-monday)), e o planejamento manda que ninguém
comece tarefa bloqueada. Deixá-la ⬜ enche o painel de trabalho que não existe.

**Bloqueado ≠ parado.** Quando o bloqueio é escolha de provedor, a porta e os
testes com adapter falso podem ser escritos antes — é exatamente para isso que
os adapters existem
([princípios](../arquitetura/principios.md#3-adapters-isolam-provedores)).
É por isso que NR-040, NR-043 e NR-045 — as três portas com adapter falso —
dependem de `contracts` (NR-005 ✅) e **não** do caso de uso ou do worker que as
consome. A porta é declarada pelo núcleo; a seta aponta para dentro
([princípio 1](../arquitetura/principios.md#1-core-é-o-núcleo)).

## As trilhas

| Trilha                              | Módulos                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| 🔵 **1 — Núcleo & Dados**           | `money` `domain` `contracts` `db` `core`                                             |
| 🟠 **2 — Plataforma & Integrações** | `api` `worker` `agent` `whatsapp` `fiscal` `banking` `billing` `payments` `infra` CI |
| 🟢 **3 — Clientes**                 | `mobile` `web` `ui`                                                                  |

> **A trilha 1 é o gargalo, e agora ela pode andar.** `money`, `domain` e
> `contracts` já existem, e a [DEC-002](../decisoes/README.md#dec-002) fechou:
> `db` começa em NR-007. Enquanto `db` não sair, as outras duas continuam
> dependendo dela — é a fila mais curta para destravar o resto do backlog.

## Painel

|                               | Tarefas | Dias |
| ----------------------------- | ------: | ---: |
| Total                         |      92 |  235 |
| ✅ Concluídas                 |      81 |  197 |
| 🚧 Bloqueadas por decisão     |       6 |   20 |
| 🚧 Bloqueadas por dependência |       2 |    7 |
| ⬜ A fazer, pode começar hoje |       3 |   11 |

> **Números conferidos contra a `main` em 2026-09-12**, não estimados: cada
> ✅ tem commit mesclado com `Refs: NR-xxx` no histórico. O NR-012 é a
> exceção — foi mesclado antes de a convenção de rodapé existir (PR #15).
> As somas saem das linhas deste arquivo e fecham com o
> [`monday-import.csv`](monday-import.csv) que `pnpm ledger:csv` gera.

> **NR-080 entrou aqui depois de já ter sido entregue.** O suporte foi mesclado
> citando um id que não existia neste arquivo, e a NR-081 (baixa e estorno)
> nasceu reusando o mesmo número — dois trabalhos diferentes apontando para um
> id só, que é exatamente o que a convenção "ID nunca é reaproveitado" existe
> para impedir. A colisão foi desfeita renomeando a NR-081, a mais nova, nos
> comentários dela, e registrando as duas tarefas aqui. O `ledger:check` recusa
> id duplicado **entre linhas**; ele não lê comentário de código, e foi por essa
> fresta que o número passou duas vezes.

**A DEC-002 fechou** — [ADR-0001](../decisoes/adr/0001-rls-por-linha.md), RLS
por linha, com o isolamento já materializado em `packages/db` (NR-007) e os
cadastros, vendas e financeiro no schema (NR-008, NR-020) e os casos de uso de
cadastro, o `registerSale` e a movimentação de estoque em `core` (NR-021,
NR-022, NR-023), a agenda no schema (NR-035) e a trilha de auditoria
(NR-025) e as contas a pagar com baixa e estorno (NR-028, NR-029) os
consumidores de fila (NR-041) e o plano de contas com DRE (NR-032).

Dos **38 dias que faltam, 11 podem começar hoje**: NR-044, NR-063 e NR-113. A fila
NR-088–098 (catálogo 0909) está ✅. Sobram 27 dias atrás de decisão (20) ou de
dependência (7).

---

## Sprint 0 — Fundação ✅

| ID     | Tarefa                                                                | Trilha | Módulo         | Est | Dep | Status |
| ------ | --------------------------------------------------------------------- | :----: | -------------- | --: | --- | :----: |
| NR-001 | Workspace pnpm + Turborepo, Docker Compose local, CI, hooks, ESLint   |   🟠   | `repo` `infra` |   3 | —   |   ✅   |
| NR-002 | Base de documentação: produto, arquitetura, engenharia, decisões      |   —    | `docs`         |   4 | —   |   ✅   |
| NR-003 | `packages/money` — centavos, `allocate` sem perda de resto, 21 testes |   🔵   | `money`        |   1 | —   |   ✅   |

## Sprint 1 — Núcleo mínimo

Objetivo: as três trilhas conseguem trabalhar em paralelo sem esperar uma à outra.

| ID     | Tarefa                                                                          | Trilha | Módulo            | Est | Dep    | Bloq                | US/RF                   | Status |
| ------ | ------------------------------------------------------------------------------- | :----: | ----------------- | --: | ------ | ------------------- | ----------------------- | :----: |
| NR-004 | `domain`: cálculo de venda — custo, imposto, tarifa de cartão, parcelas         |   🔵   | `domain`          |   3 | NR-003 | —                   | RF-040, RF-041, RF-038  |   ✅   |
| NR-005 | `contracts`: schemas base (Company, Customer, Product, Sale)                    |   🔵   | `contracts`       |   2 | NR-003 | —                   | RNF-027                 |   ✅   |
| NR-006 | Configuração tipada: validar variáveis de ambiente na inicialização             |   🟠   | `repo`            |   1 | NR-001 | —                   | —                       |   ✅   |
| NR-007 | `db`: estratégia multi-tenant, RLS e teste de isolamento                        |   🔵   | `db`              |   3 | NR-005 | —                   | RF-121, RF-122, RNF-021 |   ✅   |
| NR-008 | `db`: schema de cadastros (companies, users, customers, products)               |   🔵   | `db`              |   2 | NR-007 | —                   | RF-001, RF-009, RF-017  |   ✅   |
| NR-009 | `api`: base — contexto de execução, erro padronizado, validação por `contracts` |   🟠   | `api`             |   2 | NR-005 | —                   | RNF-027, RNF-054        |   ✅   |
| NR-010 | Qualidade: lint com type-checking e piso de cobertura na CI                     |   🟠   | `repo`            |   1 | NR-001 | —                   | RNF-068                 |   ✅   |
| NR-011 | `ui`: tokens de design (cor, tipografia, espaçamento)                           |   🟢   | `ui`              |   2 | —      | **DEC-001**/QST-011 | RNF-055                 |   ✅   |
| NR-012 | `mobile`: shell de navegação e sessão                                           |   🟢   | `mobile`          |   3 | NR-011 | DEC-008             | US-059                  |   ✅   |
| NR-013 | `web`: shell de layout e sessão                                                 |   🟢   | `web`             |   2 | NR-011 | —                   | US-059                  |   ✅   |
| NR-014 | Autenticação: login, papéis, usuário em várias empresas                         |   🟠   | `api` `core` `db` |   5 | NR-009 | —                   | RF-119, RF-120, RF-005  |   ✅   |
| NR-015 | `infra`: definir hospedagem e preencher os workflows de deploy                  |   🟠   | `infra`           |   3 | —      | **DEC-009**         | RNF-064, RNF-013        |   🚧   |

## Sprint 2 — Cadastros e venda

Objetivo: registrar uma venda de ponta a ponta pelo aplicativo.

| ID     | Tarefa                                                                      | Trilha | Módulo         | Est | Dep            | Bloq | US/RF                  | Status |
| ------ | --------------------------------------------------------------------------- | :----: | -------------- | --: | -------------- | ---- | ---------------------- | :----: |
| NR-020 | `db`: schema de vendas e financeiro                                         |   🔵   | `db`           |   3 | NR-008         | —    | RF-027–044, RF-063     |   ✅   |
| NR-021 | `core`: casos de uso de cadastro (empresa, cliente, produto)                |   🔵   | `core`         |   3 | NR-008         | —    | RF-001–019             |   ✅   |
| NR-022 | `core`: `registerSale` — transação única com estoque, recebível e auditoria |   🔵   | `core`         |   4 | NR-020, NR-004 | —    | RF-034–039, RNF-046    |   ✅   |
| NR-023 | `core`: movimentação de estoque e ajuste com autoria                        |   🔵   | `core`         |   2 | NR-021         | —    | RF-022–024             |   ✅   |
| NR-024 | `domain`: desconto, limite por papel, troco                                 |   🔵   | `domain`       |   2 | NR-004         | —    | RF-030, RF-031, RF-035 |   ✅   |
| NR-025 | `core`: trilha de auditoria somente-inserção                                |   🔵   | `core`         |   2 | NR-020         | —    | RF-123, RF-124         |   ✅   |
| NR-026 | `api`: rotas de cadastro                                                    |   🟠   | `api`          |   2 | NR-021, NR-009 | —    | RF-001–019             |   ✅   |
| NR-027 | `api`: rota de venda com chave de idempotência                              |   🟠   | `api`          |   2 | NR-022         | —    | RF-036, RNF-043        |   ✅   |
| NR-030 | `api`: observabilidade — `requestId`, log estruturado, rastreamento         |   🟠   | `api` `worker` |   2 | NR-009         | —    | RNF-058, RNF-059       |   ✅   |
| NR-070 | `mobile`: cadastro de produto com leitor de código de barras                |   🟢   | `mobile`       |   3 | NR-026         | —    | US-009, RF-017         |   ✅   |
| NR-071 | `mobile`: carrinho, seleção de cliente e fechamento de venda                |   🟢   | `mobile`       |   5 | NR-027         | —    | US-014–019             |   ✅   |
| NR-072 | `web`: backoffice de cadastros                                              |   🟢   | `web`          |   3 | NR-026         | —    | E1, E2, E3             |   ✅   |

## Sprint 3 — Fiscal e financeiro

Objetivo: emitir NFC-e e controlar contas a pagar e receber.

| ID     | Tarefa                                                                | Trilha | Módulo            | Est | Dep    | Bloq | US/RF                  | Status |
| ------ | --------------------------------------------------------------------- | :----: | ----------------- | --: | ------ | ---- | ---------------------- | :----: |
| NR-028 | `core`: contas a pagar e a receber, com recorrência                   |   🔵   | `core`            |   3 | NR-020 | —    | RF-055–067             |   ✅   |
| NR-029 | `core`: baixa, baixa parcial e estorno                                |   🔵   | `core`            |   2 | NR-028 | —    | RF-059, RF-066, RF-067 |   ✅   |
| NR-040 | `fiscal`: porta `InvoiceIssuer` + adapter falso                       |   🟠   | `fiscal` `core`   |   2 | NR-005 | —    | RF-045                 |   ✅   |
| NR-041 | `worker`: consumidores de fila (emissão, mensagem, cobrança)          |   🟠   | `worker`          |   3 | NR-040 | —    | RNF-004, RF-130        |   ✅   |
| NR-042 | `fiscal`: adapter real, contingência e guarda de XML                  |   🟠   | `fiscal`          |   5 | NR-040 | —    | RF-045–054             |   ✅   |
| NR-043 | `payments`: porta `PaymentGateway` + adapter falso                    |   🟠   | `payments` `core` |   2 | NR-005 | —    | RF-063                 |   ✅   |
| NR-044 | `payments`: adapter Asaas — Pix, boleto, link, cartão online, webhook |   🟠   | `payments`        |   4 | NR-043 | —    | RF-034, RF-068         |   ⬜   |
| NR-073 | `mobile`: pagamento, resumo com líquido e margem                      |   🟢   | `mobile`          |   3 | NR-071 | —    | US-018–020             |   ✅   |
| NR-074 | `web`: contas a pagar e a receber                                     |   🟢   | `web`             |   4 | NR-029 | —    | E6, E7                 |   ✅   |
| NR-081 | Baixa e estorno de título ligados de verdade, no web e no mobile      |   🟢   | `web` `mobile`    |   3 | NR-074 | —    | RF-059, RF-066, RF-067 |   ✅   |

## Sprint 4 — WhatsApp e assinatura

Objetivo: operar o ERP por mensagem e cobrar a mensalidade.

| ID     | Tarefa                                                        | Trilha | Módulo                     | Est | Dep            | Bloq             | US/RF                  | Status |
| ------ | ------------------------------------------------------------- | :----: | -------------------------- | --: | -------------- | ---------------- | ---------------------- | :----: |
| NR-031 | `core`: exportação completa e anonimização (LGPD)             |   🔵   | `core`                     |   3 | NR-028         | —                | RF-125–128             |   ✅   |
| NR-045 | `whatsapp`: porta `MessageSender` + adapter falso             |   🟠   | `whatsapp` `core`          |   2 | NR-005         | —                | RF-015                 |   ✅   |
| NR-046 | `whatsapp`: adapter real, webhook e consentimento             |   🟠   | `whatsapp`                 |   4 | NR-045         | **DEC-003**      | RF-016                 |   🚧   |
| NR-113 | Canal WhatsApp: celular do owner é o vínculo; PeerDirectory   |   🟠   | `core` `api` `agent` `web` |   3 | NR-014, NR-084 | —                | RF-094, RF-095, RF-132 |   ⬜   |
| NR-060 | `agent`: runtime com tools geradas de `contracts`             |   🟠   | `agent`                    |   5 | NR-046, NR-005 | NR-046 → DEC-003 | RF-096–102, 108, 109   |   🚧   |
| NR-061 | `agent`: confirmação de ação sensível, com expiração          |   🟠   | `agent`                    |   2 | NR-060         | NR-060 → DEC-003 | RF-103, RF-104         |   🚧   |
| NR-062 | `agent`: contexto de conversa isolado por empresa             |   🟠   | `agent`                    |   3 | NR-060         | **DEC-011**      | RF-105, RF-106         |   🚧   |
| NR-063 | `billing`: assinatura, trial, inadimplência e estado restrito |   🟠   | `billing`                  |   4 | NR-044         | —                | RF-110–118             |   ⬜   |
| NR-075 | `web`: planos, assinatura e cupom                             |   🟢   | `web`                      |   3 | NR-063         | DEC-012          | E12                    |   🚧   |

## Sprint 5 — Bancos e relatórios

| ID     | Tarefa                                                         | Trilha | Módulo         | Est | Dep    | Bloq        | US/RF          | Status |
| ------ | -------------------------------------------------------------- | :----: | -------------- | --: | ------ | ----------- | -------------- | :----: |
| NR-032 | `core`: plano de contas, classificação e DRE simplificado      |   🔵   | `core`         |   4 | NR-028 | —           | RF-081–088     |   ✅   |
| NR-033 | `core`: conciliação com sugestão por valor e data              |   🔵   | `core`         |   3 | NR-032 | —           | RF-078–080     |   ✅   |
| NR-047 | `banking`: importação de OFX/CSV                               |   🟠   | `banking`      |   3 | NR-033 | —           | RF-076, RF-077 |   ✅   |
| NR-048 | `banking`: Open Finance                                        |   🟠   | `banking`      |   4 | NR-047 | **DEC-005** | RF-074, RF-075 |   🚧   |
| NR-076 | `web`: conciliação bancária                                    |   🟢   | `web`          |   3 | NR-033 | —           | US-038         |   ✅   |
| NR-077 | Relatórios: DRE, ranking e faturamento, no app e no assistente |   🟢   | `web` `mobile` |   4 | NR-032 | —           | US-041, US-053 |   ✅   |

## Backlog

| ID     | Tarefa                                                          | Trilha | Módulo                  | Est | Dep    | Bloq        | US/RF                  | Status |
| ------ | --------------------------------------------------------------- | :----: | ----------------------- | --: | ------ | ----------- | ---------------------- | :----: |
| NR-016 | `CHANGELOG` gerado dos commits + processo de release            |   🟠   | `repo`                  |   1 | —      | —           | —                      |   ✅   |
| NR-034 | `core`: agenda e lembretes                                      |   🔵   | `core`                  |   2 | —      | —           | RF-089–093             |   ✅   |
| NR-035 | `db`: schema de agenda (`appointments`)                         |   🔵   | `db`                    |   1 | NR-008 | —           | RF-089, RF-090         |   ✅   |
| NR-036 | `api`: rotas de agenda                                          |   🟠   | `api`                   |   1 | NR-035 | —           | RF-089–093             |   ✅   |
| NR-037 | `db`: repositórios da venda e trilha de estoque                 |   🔵   | `db`                    |   2 | NR-020 | —           | RF-024, RNF-046        |   ✅   |
| NR-049 | E2E do caminho crítico (3 fluxos)                               |   🟠   | `repo`                  |   3 | NR-071 | **DEC-003** | RNF-068                |   🚧   |
| NR-078 | `mobile`: agenda                                                |   🟢   | `mobile`                |   2 | NR-036 | —           | US-043–045             |   ✅   |
| NR-079 | `web`: conteúdo real da landing                                 |   🟢   | `web`                   |   1 | —      | —           | —                      |   ✅   |
| NR-080 | Suporte: schema, casos de uso, rotas e web                      |   🔵   | `db` `core` `api` `web` |   3 | NR-008 | —           | US-062                 |   ✅   |
| NR-082 | `mobile`: suporte                                               |   🟢   | `mobile`                |   2 | NR-080 | —           | US-062                 |   ✅   |
| NR-083 | Sessão persistente e revogável, e desaceleração no banco        |   🔵   | `db` `core` `api`       |   3 | NR-014 | —           | RF-119, RF-120         |   ✅   |
| NR-084 | Better Auth como provedor de identidade, em schema próprio      |   🟠   | `api` `db`              |   3 | NR-083 | —           | RF-005, RF-119, RF-120 |   ✅   |
| NR-085 | Cookies, privacidade e termos: páginas e inventário com portão  |   🟢   | `web` `docs`            |   2 | —      | —           | RF-125, RNF-029        |   ✅   |
| NR-086 | Direitos do titular: exportação completa e anonimização ligadas |   🔵   | `db` `api` `web`        |   3 | NR-031 | —           | RF-125, RF-127, RF-128 |   ✅   |
| NR-087 | Trilha de auditoria persistente, e dentro da transação          |   🔵   | `db` `core` `api`       |   3 | NR-025 | —           | RF-123, RF-124, US-061 |   ✅   |

## Sprint 6 — Catálogo 0909

Objetivo: o banco vivo é o recorte `db_0909.sql` no domínio, com identidade,
sessão, cofre e extrato da `main` às margens. Baseline novo; IDs antigos não
voltam a ⬜.

| ID     | Tarefa                                                                                     | Trilha | Módulo                                       | Est | Dep                                    | Bloq | US/RF                      | Status |
| ------ | ------------------------------------------------------------------------------------------ | :----: | -------------------------------------------- | --: | -------------------------------------- | ---- | -------------------------- | :----: |
| NR-088 | Adendo oficial 0909 + plataforma, DEC-019/ADR-0006, abrir NR-089–098                       |   —    | `docs`                                       |   1 | —                                      | —    | RNF-048                    |   ✅   |
| NR-089 | `db`: baseline 0001–0007 (0909 + identidade/sessão/cofre/banco); apaga 0001–0025 velhos    |   🔵   | `db`                                         |   2 | NR-088                                 | —    | RF-121, RF-122, RNF-021    |   ✅   |
| NR-090 | `db`: repositórios de cadastro no shape 0909 (endereço, produto, categoria)                |   🔵   | `db`                                         |   2 | NR-089                                 | —    | RF-001, RF-009, RF-017     |   ✅   |
| NR-091 | `db` + `contracts`: venda, itens, pagamentos PSP, estoque, idempotência                    |   🔵   | `db` `contracts`                             |   2 | NR-089                                 | —    | RF-034–039, RNF-046        |   ✅   |
| NR-092 | `db` + `contracts`: `ledger_accounts`, `outstanding_cents`, `settlements` unificados       |   🔵   | `db` `contracts`                             |   2 | NR-089                                 | —    | RF-055–067, RF-081         |   ✅   |
| NR-093 | `db`: `invoices` 0909 + `company_integrations` convivendo com o cofre fiscal               |   🔵   | `db`                                         |   2 | NR-089                                 | —    | RF-004, RF-045–054         |   ✅   |
| NR-094 | `db` + `contracts`: `ticket_messages`, status EN de suporte, `audit_logs`                  |   🔵   | `db` `contracts`                             |   2 | NR-089                                 | —    | US-062, RF-123, RF-124     |   ✅   |
| NR-095 | `db`: conciliação nas FKs novas + inventário da exportação LGPD                            |   🔵   | `db`                                         |   2 | NR-090, NR-092                         | —    | RF-078–080, RF-125, RF-127 |   ✅   |
| NR-096 | `api`: composition e rotas cujo SQL/contrato mudou                                         |   🟠   | `api`                                        |   2 | NR-090, NR-091, NR-092, NR-093, NR-094 | —    | RF-001–019, RF-036         |   ✅   |
| NR-097 | `web` + `mobile`: vocabulário e campos (venda, suporte, endereço, categoria)               |   🟢   | `web` `mobile`                               |   2 | NR-096                                 | —    | US-014–019, US-062         |   ✅   |
| NR-098 | Merge do baseline na `main` e `infra:reset` no setup                                       |   🟠   | `repo` `infra`                               |   1 | NR-095, NR-096, NR-097                 | —    | RNF-048                    |   ✅   |
| NR-099 | Tema claro do painel: alternancia com persistencia e paridade AA de contraste              |   🟢   | `web` `ui`                                   |   1 | —                                      | —    | RNF-055                    |   ✅   |
| NR-100 | Polish do painel: som e animacao na venda fechada, skeleton e mascote nos vazios           |   🟢   | `web`                                        |   1 | —                                      | —    | RNF-055                    |   ✅   |
| NR-101 | Tutorial guiado no primeiro login: spotlight pelo dashboard e pela barra lateral           |   🟢   | `web`                                        |   1 | —                                      | —    | —                          |   ✅   |
| NR-102 | Corrige o tema claro: sidebar/topbar e ~20 preenchimentos que so funcionavam no escuro     |   🟢   | `web`                                        |   1 | —                                      | —    | RNF-055                    |   ✅   |
| NR-103 | Logo "Ei Buddy" no painel so atualiza a tela — nao navega mais pro site institucional      |   🟢   | `web`                                        |   1 | —                                      | —    | —                          |   ✅   |
| NR-104 | Sino com aviso de cliente inativo, meta diaria e checklist de primeiros passos             |   🟢   | `web`                                        |   2 | —                                      | —    | —                          |   ✅   |
| NR-105 | Super Admin: "entrar como" auditado (ADR-0007), do banco ao painel                         |   🔵   | `db` `contracts` `core` `api` `web`          |   4 | —                                      | —    | RF-131                     |   ✅   |
| NR-106 | DEC-021: conexao entre usuarios por proximidade adiada para a Fase 4 (Rede)                |   —    | `docs`                                       |   1 | —                                      | —    | —                          |   ✅   |
| NR-107 | Conexao entre usuarios por proximidade: busca cross-tenant e pedido auditado (ADR-0008)    |   🔵   | `db` `contracts` `core` `api` `web`          |   5 | —                                      | —    | RF-01–05 (spec)            |   ✅   |
| NR-108 | Sugestao de conexao por filtragem colaborativa de ramo, sem IA (ADR-0009)                  |   🔵   | `db` `contracts` `core` `api` `web`          |   1 | NR-107                                 | —    | RF-01 (spec, aditivo)      |   ✅   |
| NR-109 | Quadro de CRM: pendencias e contatos em Kanban, do banco ao mobile (comentario e equipe)   |   🟢   | `db` `contracts` `core` `api` `web` `mobile` |   4 | —                                      | —    | —                          |   ✅   |
| NR-110 | Custos fixos: cadastro, edicao e "gerar contas do mes", do banco a tela                    |   🟢   | `db` `contracts` `core` `api` `web`          |   4 | NR-077                                 | —    | —                          |   ✅   |
| NR-111 | Pre-lancamento: landing sem acesso, lista de espera e painel de respostas do Super Admin   |   🟢   | `db` `contracts` `core` `api` `web`          |   5 | —                                      | —    | —                          |   ✅   |
| NR-112 | Painel da lista de espera: acesso provisorio por chave, sem esperar o primeiro Super Admin |   🟢   | `api` `web`                                  |   1 | NR-111                                 | —    | —                          |   ✅   |

---

## Caminho crítico

O que atrasa o MVP inteiro se atrasar:

```mermaid
flowchart LR
    N3["NR-003<br/>money ✅"] --> N4["NR-004<br/>domain ✅"]
    N3 --> N5["NR-005<br/>contracts ✅"]
    N5 --> N7["NR-007<br/>db + RLS ✅"]
    N7 --> N8["NR-008<br/>cadastros ✅"]
    N8 --> N20["NR-020<br/>vendas ✅"]
    N4 --> N22
    N20 --> N22["NR-022<br/>registerSale ✅"]
    N22 --> N27["NR-027<br/>rota de venda"]
    N27 --> N71["NR-071<br/>PDV mobile"]
    N22 --> N40["NR-040<br/>porta fiscal ✅"]
    N40 --> N42["NR-042<br/>NFC-e<br/>✅"]

    style N42 fill:#7c2d12,color:#fff
    style N3 fill:#14532d,color:#fff
    style N4 fill:#14532d,color:#fff
    style N5 fill:#14532d,color:#fff
    style N40 fill:#14532d,color:#fff
    style N7 fill:#14532d,color:#fff
    style N8 fill:#14532d,color:#fff
    style N20 fill:#14532d,color:#fff
    style N22 fill:#14532d,color:#fff
```

**NR-007 era o nó mais crítico do projeto, e está feito.** O isolamento por RLS
vive em `packages/db`: a função `enable_tenant_isolation`, o `withTenant` que
liga o `ExecutionContext` à política, e doze testes contra Postgres de verdade
provando que empresa não lê, grava, altera nem apaga linha de outra
([ADR-0001](../decisoes/adr/0001-rls-por-linha.md)).

**O `registerSale` está feito** — a transação única que grava venda, itens,
pagamentos, recebíveis e a baixa de estoque juntos, com idempotência pela chave
do contexto e rollback provado em teste (RNF-046).

**A NR-027 destravou, e o nó encolheu.** Esta nota dizia que a rota de venda
não era executável porque `packages/db` não implementava porta nenhuma. Isso
mudou: `createSaleUnitOfWork` e `createUserDirectory` existem agora, e a
NR-027 foi feita contra o repositório **real** — Postgres, transação com tenant
definido, idempotência pelo índice único.

A configuração de venda (alíquota, tarifas de cartão, teto de desconto) segue
sem tabela, e por isso a rota usa `createDefaultSaleSettings` de `core` — que
é o que a própria porta `CompanySettingsRepository` prevê ("quem implementa
hoje devolve a configuração que tiver"). Quando as tabelas existirem, muda uma
função na raiz de composição.

**O que continua bloqueado:** a NR-026 (rotas de cadastro) e a NR-036 (rotas de
agenda) precisam de repositórios de cliente, produto e compromisso, e nenhum
existe. Segue como **pendência de planejamento**: nenhuma tarefa do ledger cria
esses repositórios, e uma rota ligada a um _fake_ não é uma rota.

## Bloqueios por decisão

| Decisão                                                                                  | Diretas                | Em cascata | Dias parados |
| ---------------------------------------------------------------------------------------- | ---------------------- | ---------: | -----------: |
| [DEC-007](../decisoes/README.md#dec-007) LLM ✅ Mastra + `gpt-4o-mini`                   | — (NR-060 via DEC-003) |          — |            0 |
| [DEC-004](../decisoes/README.md#dec-004) fiscal ✅                                       | — (NR-042 ✅)          |          — |            0 |
| [DEC-003](../decisoes/README.md#dec-003) WhatsApp                                        | NR-046                 |          2 |           11 |
| [DEC-010](../decisoes/README.md#dec-010) cobrança ✅                                     | — (NR-063 ⬜)          |          — |            0 |
| [DEC-006](../decisoes/README.md#dec-006)/[DEC-015](../decisoes/README.md#dec-015) PSP ✅ | — (NR-044 ⬜)          |          — |            0 |
| [DEC-005](../decisoes/README.md#dec-005) Open Finance                                    | NR-048                 |          — |            4 |
| [DEC-003](../decisoes/README.md#dec-003) fluxo 3 do E2E                                  | NR-049                 |          — |            3 |
| [DEC-009](../decisoes/README.md#dec-009) hospedagem                                      | NR-015                 |          — |            3 |
| [DEC-011](../decisoes/README.md#dec-011) contexto da conversa                            | NR-062                 |          — |            3 |
| [DEC-012](../decisoes/README.md#dec-012) usuário e cupons                                | NR-075                 |          — |            3 |
| [DEC-001](../decisoes/README.md#dec-001) nome/marca                                      | — (NR-011 ✅)          |          — |            0 |

> **Bloqueio de tarefa não é bloqueio de trabalho.** Quebrando as tarefas na
> costura da porta — como a NR-042 fez de fato com a DEC-004 — cerca de 19 dos
> 27 dias voltam ao quadro sem decidir nada. Ver
> [destravar-os-bloqueios.md](destravar-os-bloqueios.md).

**Dos 38 dias-desenvolvedor que restam, 11 estão liberados** — NR-044, NR-063 e
NR-113.
Os outros 27 continuam atrás de decisão (20) ou de dependência (7).

A de maior alcance que ainda trava o assistente é a
[DEC-003](../decisoes/README.md#dec-003) (WhatsApp + runtime do agente em
cascata + fluxo 3 do E2E): a [DEC-007](../decisoes/README.md#dec-007) fechou
pela [ADR-0010](../decisoes/adr/0010-mastra-e-gpt-4o-mini.md) (Mastra +
`gpt-4o-mini`). O cérebro tem runtime; o canal não.

Cada tarefa é contada **uma vez**, na decisão que aparece na sua própria coluna
`Bloq`. Uma tarefa pode estar atrás de mais de uma: NR-075 espera a DEC-012 e,
via NR-063, o adapter de cobrança — somar as duas contaria o mesmo dia duas vezes.

**Nenhuma decisão restante domina como a DEC-002 dominava.** A maior é a
[DEC-003](../decisoes/README.md#dec-003). O bloqueio continua
espalhado — o que antes permitia tocar código enquanto se decidia, e agora
significa apenas que nenhuma decisão isolada resolve o impasse.

A [DEC-008](../decisoes/README.md#dec-008) fechou pela
[ADR-0002](../decisoes/adr/0002-autenticacao-identidade-propria.md) e devolveu
6 dias — `NR-013` e `NR-014`. Vale registrar como ela fechou, porque o padrão
serve para as que faltam: a decisão travada era **qual provedor**, e o que
travava o código era **quem é dono do papel e da sessão**. Separadas, a segunda
foi decidida na hora e a primeira virou escolha de configuração que espera a
[DEC-009](../decisoes/README.md#dec-009) sem parar nada.

A [DEC-001](../decisoes/README.md#dec-001) fechou pela
[ADR-0011](../decisoes/adr/0011-eibuddy-nome-e-dominio.md): produto **EiBuddy**,
domínio **eibuddy.com.br**. NR-011 já tinha sido entregue com a paleta
provisória de
[`packages/ui/src/tokens/color.ts`](../../packages/ui/src/tokens/color.ts).
O retrabalho que resta é visual (tokens), não naming.

## Carga por trilha

| Trilha                          | Tarefas | Dias | Observação                                         |
| ------------------------------- | ------: | ---: | -------------------------------------------------- |
| 🔵 1 — Núcleo & Dados           |      33 |   83 | Sugestão de conexão (NR-108) somou ao NR-107       |
| 🟠 2 — Plataforma & Integrações |      29 |   78 | NR-113 (identidade do canal, ADR-0012)             |
| 🟢 3 — Clientes                 |      27 |   68 | lista de espera de pré-lançamento (NR-111, NR-112) |
| Compartilhada                   |       3 |    6 | documentação (NR-002, NR-088, NR-106)              |

Somando: **235 dias-desenvolvedor** em 92 tarefas. Com 3 pessoas, isso é cerca
de 13 semanas de trabalho — desde que nada fique bloqueado, o que não é o caso
hoje.

A trilha 3 não está mais ociosa por falta de `ui`: NR-011 e NR-012 saíram com a
paleta provisória. O que resta dela depende de schema — de NR-020 em diante —
mas depender não é estar bloqueada: com a DEC-002 fechada, é fila, não parede.

## Convenções

| Regra                                           | Motivo                                                   |
| ----------------------------------------------- | -------------------------------------------------------- |
| Tarefa acima de 2 dias é quebrada               | estimativa grande é estimativa errada                    |
| Toda tarefa tem `US-xxx` ou `RF-xxx`            | trabalho sem requisito é trabalho sem critério de pronto |
| Tarefa bloqueada referencia a `DEC-xxx`         | e a `DEC` referencia a tarefa de volta                   |
| ID nunca é reaproveitado                        | tarefa cancelada fica como cancelada; o número queima    |
| Tarefa com dependência 🚧 também é 🚧           | ⬜ promete que dá para começar hoje                      |
| Painel e cargas conferem com as linhas          | soma errada é pior que soma nenhuma                      |
| Este arquivo é atualizado **no PR**, não depois | ledger desatualizado é pior que ledger nenhum            |

## Documentos relacionados

- [`monday-import.csv`](monday-import.csv) — o mesmo ledger, para importar
- [Rituais](rituais.md) — DoR, DoD, cerimônias
- [Fluxo de trabalho](../engenharia/fluxo-de-trabalho.md) — o ciclo de uma tarefa
- [Decisões](../decisoes/README.md) — o que está bloqueando
