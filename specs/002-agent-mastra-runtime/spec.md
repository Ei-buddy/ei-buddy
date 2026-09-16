# Feature Specification: Assistente — runtime mínimo (NR-060)

**Feature Branch**: `feat/NR-060-runtime-agente`

**Created**: 2026-09-16

**Status**: Draft

**Input**: User description: "estamos iniciando a NR-060, precisamos iniciar o ambiente do framework mastra e montarmos plano para resolver US-047–049, US-052, US-053, RF-096–102, 107–109, 136, 149–151"

**Ledger**: [NR-060](../../docs/processo/task-ledger.md) — `agent`: runtime mínimo + tools base geradas de `contracts` (5 dias; dep. NR-005 ✅).

**Fonte de verdade**: esta spec amarra o recorte da NR-060 já documentado em `docs/` para o fluxo Spec Kit (`/speckit-plan`, `/speckit-tasks`, `/speckit-implement`). Não substitui os catálogos permanentes. Em conflito de detalhe, prevalecem a [constitution](../../.specify/memory/constitution.md), o [escopo do MVP](../../docs/produto/escopo-mvp.md), as ADRs do assistente e os IDs `US-xxx` / `RF-xxx` / `RNF-xxx`.

| Artefato permanente                                                                                                                              | Papel nesta spec                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| [US-047–049, 052, 053, 077–079](../../docs/produto/user-stories.md)                                                                              | Jornadas e critérios de aceite do canal conversacional        |
| [RF-096–102, 107–109, 136, 149–151](../../docs/produto/requisitos-funcionais.md)                                                                 | Requisitos rastreáveis cobertos por esta fatia                |
| [ADR-0010](../../docs/decisoes/adr/0010-mastra-e-gpt-4o-mini.md)                                                                                 | Runtime e modelo iniciais; Studio só como harness (NR-121)    |
| [ADR-0016](../../docs/decisoes/adr/0016-memoria-da-conversa-tabelas-nossas.md) / [ADR-0017](../../docs/decisoes/adr/0017-rag-com-tools-e-rls.md) | Memória e RAG **fora** desta fatia (NR-062 / NR-120)          |
| [packages/agent README](../../packages/agent/README.md)                                                                                          | Contrato do pacote: o agente não calcula                      |
| Constitution — princípio I                                                                                                                       | App e canal conversacional acionam os **mesmos** casos de uso |

## Clarifications

### Session 2026-09-16

- Q: Para considerar a NR-060 pronta para merge, quais jornadas desta spec precisam passar nos testes de aceite? → A: C — Tudo na spec, inclusive US-053 completo (RF-108 e RF-109); DoD = ledger literal
- Q: Quando o relatório for grande demais para uma mensagem no canal de teste (API), como o detalhe deve ser entregue junto com o resumo? → A: C — Só resumo truncado no texto nesta fatia; arquivo/link (RF-109) fica dívida técnica explícita
- Q: Quem pode usar o canal de teste do assistente (mensagem autenticada na API) nesta fatia? → A: Somente desenvolvedores do projeto; nenhum usuário final do produto. Para exercitar o laço, o desenvolvedor cria usuário/empresa de teste, popula dados e autentica como essa fixture.
- Q: Como o sistema deve reconhecer que quem fala com o assistente nesta fatia é desenvolvedor (e não um usuário da loja)? → A: A — Harness só em não-produção (ou flag); a sessão usada nos testes é de **fixture** criada pelo desenvolvedor, nunca conta real de lojista em produção
- Q: Se o desenvolvedor perguntar estoque, contas a pagar ou saldo de cliente nesta fatia (US-065–067), o que o assistente deve responder? → A: A — Só listar capacidades disponíveis nesta fatia, sem mencionar o que virá depois

## Escopo desta fatia

**Entra (NR-060):**

1. Ambiente do runtime do assistente operacional no monorepo (pacote `agent` composto pela API), com modo local sem provedor pago e modo real configurável.
2. Laço de mensagem → interpretação → tool tipada → caso de uso de `core` (leituras imediatas; mutações só após confirmação explícita).
3. Catálogo mínimo de capacidades alinhado a US-047–049, US-052, US-053 e às recusas US-077–079 (RF-149–151).
4. Schemas das tools derivados dos mesmos contratos já usados pela API — sem definição paralela de campos.

**Fica para tarefas seguintes (não é critério de pronto desta spec):**

| Fora agora                                    | Onde                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| Confirmação persistente em banco              | NR-061 (US-050 / RF-103–104) — nesta fatia a confirmação pode ser volátil em processo |
| Memória / contexto multi-turno com RLS        | NR-062 (US-051 / RF-105–106)                                                          |
| Harness Studio para engenharia                | NR-121                                                                                |
| Consultas estoque / a pagar / fiado dedicadas | NR-115 (US-065–067)                                                                   |
| Foto de código, cadastros e baixas extras     | NR-116–119                                                                            |
| RAG auxiliar                                  | NR-120                                                                                |
| Identidade WhatsApp + Meta Cloud              | NR-113, NR-046                                                                        |

Canal de demonstração nesta fatia: **somente desenvolvedores do projeto** exercitam o assistente. **Nenhum usuário final do produto** (lojista real) usa o canal — as jornadas da Cláudia são cenários de aceite. Fluxo de teste: o desenvolvedor **cria usuário e empresa de fixture**, adiciona dados necessários, **autentica como essa fixture** e envia mensagens no harness (não-produção ou flag). O WhatsApp de produção e o acesso do owner real ficam para NR-113/NR-046 (Studio de eng. em NR-121).

**Definition of Done (merge):** jornadas P1, US-052 (cobrança) e US-053 no eixo **RF-108** (resumo com faturamento, custo, despesas e resultado), demonstráveis por desenvolvedor no canal de teste. **RF-109** (arquivo ou link para detalhe grande) fica como **dívida técnica explícita** nesta fatia: o canal de teste devolve só resumo truncado no texto; o caminho arquivo/link entra em tarefa seguinte da cascata do agente (sem bloquear o merge da NR-060).

## User Scenarios & Testing _(mandatory)_

Persona das jornadas: Cláudia (P1, papel `owner`) — usada como **cenário de aceite**. Quem dispara as mensagens nesta fatia é **desenvolvedor do projeto**, não a lojista. Números e efeitos financeiros **sempre** vêm dos mesmos casos de uso do aplicativo.

### User Story 1 - Runtime pronto para interpretar e agir (Priority: P1)

A equipe sobe o ambiente do assistente e um **desenvolvedor** consegue enviar uma mensagem de teste: o sistema interpreta a intenção, escolhe uma capacidade tipada e responde. Em ambiente local, isso funciona sem chave de provedor (provedor falso). Com provedor real configurado, o mesmo laço usa o modelo decidido na ADR-0010. Usuário final não tem acesso a este canal nesta fatia.

**Why this priority**: sem runtime operacional, nenhuma história conversacional é demonstrável; é o pré-requisito da cascata E11.

**Independent Test**: com empresa e sessão de teste, uma mensagem de consulta conhecida produz resposta coerente; uma mensagem sem intenção reconhecida lista o que o assistente sabe fazer, sem inventar dado.

**Acceptance Scenarios** (fundação NR-060 · RF-096, RF-097 · RNF-006 em consulta):

1. **Given** o runtime ativo em modo local, **When** um desenvolvedor envia "quanto vendi hoje?" no canal de teste (com contexto de empresa de fixture), **Then** recebe total do período, quantidade de vendas e ticket médio vindos do mesmo caso de uso do app.
2. **Given** uma pergunta fora das capacidades, **When** envia, **Then** o assistente declara o que sabe fazer e **não** inventa números nem ações.
3. **Given** provedor real configurado, **When** a mesma consulta é enviada, **Then** o caminho de execução (tool → `core`) é o mesmo do modo local — só a interpretação da linguagem muda de origem.
4. **Given** qualquer resposta com valor monetário, **When** o lojista compara com o relatório/app, **Then** os centavos batem (o assistente não calcula).

---

### User Story 2 - Consultar o negócio por mensagem (Priority: P1)

A Cláudia pergunta em linguagem natural e recebe números da loja sem abrir o app: vendas do dia e quem está devendo.

**Why this priority**: é a promessa diária do canal (US-047); valida que leitura conversacional não abre caminho paralelo aos relatórios.

**Independent Test**: duas consultas típicas ("quanto vendi hoje?", "quem está me devendo?") devolvem dados iguais aos do app para a mesma empresa e período.

**Acceptance Scenarios** (US-047 · RF-096, RF-097):

1. **Given** vendas no dia, **When** pergunta quanto vendeu hoje, **Then** recebe total, número de vendas e ticket médio do mesmo caso de uso do app.
2. **Given** clientes com títulos em aberto, **When** pergunta quem está devendo, **Then** recebe inadimplentes com valor e atraso/vencimento coerentes com o app.
3. **Given** pergunta de estoque, contas a pagar ou saldo de carteira, **When** envia nesta fatia, **Then** o assistente responde como intenção não coberta: declara **somente** as capacidades já disponíveis (vendas, inadimplentes, cadastro, venda, cobrança, resumo, etc.), **sem** antecipar US-065–067 nem inventar consulta.

---

### User Story 3 - Cadastrar cliente por mensagem (Priority: P1)

A Cláudia cadastra um cliente pela conversa sem interromper o atendimento. O assistente mostra o que entendeu, pede confirmação e respeita duplicidade.

**Why this priority**: desbloqueia venda conversacional (precisa de cliente) e prova mutação com confirmação + mesmo `core` do app (US-048).

**Independent Test**: mensagem com nome e telefone → proposta → confirmação → cliente criado; telefone duplicado avisa e oferece caminho.

**Acceptance Scenarios** (US-048 · RF-098, RF-099 · confirmação volátil ok nesta fatia):

1. **Given** "cadastra o João, 11 98888-7777", **When** envia, **Then** o assistente resume nome/telefone e pede confirmação explícita antes de gravar.
2. **Given** confirmação explícita, **When** responde, **Then** o cliente é criado pelo mesmo caso de uso do app e ela recebe aviso de sucesso.
3. **Given** telefone já cadastrado, **When** confirma, **Then** é avisada do duplicado e escolhe o que fazer (sem criar às cegas).
4. **Given** resposta ambígua à confirmação, **When** o assistente interpreta, **Then** trata como recusa e pergunta de novo (nada é gravado).

---

### User Story 4 - Lançar venda por mensagem (Priority: P1)

A Cláudia registra a venda pela conversa: cliente, itens, quantidades, valores, forma de pagamento (incluindo desconto, misto/parcelado e fiado com as mesmas recusas do app). Produto ambíguo exige desambiguação. Totais e estoque saem do mesmo fechamento do aplicativo; NFC-e, se couber, é efeito da venda — não comando avulso.

**Why this priority**: caminho crítico do diferencial "um núcleo, dois canais" (US-049 / RF-101).

**Independent Test**: frase de venda completa → resumo com líquido → confirmação → venda e estoque iguais ao app; produto ambíguo lista opções; fiado sem cliente é recusado.

**Acceptance Scenarios** (US-049 · RF-100, RF-101, RF-102, RF-136 · RF-151 como efeito):

1. **Given** "venda pro João: 2 camisetas M a 49,90, pagou no Pix", **When** envia, **Then** vê cliente, itens, total, pagamento e líquido para confirmar.
2. **Given** confirmação, **When** responde, **Then** a venda é criada com os mesmos cálculos do app e o estoque baixa.
3. **Given** produto ambíguo, **When** o assistente não decide, **Then** pergunta qual, listando opções.
4. **Given** venda sem produto cadastrado, **When** confirma item avulso com descrição e valor, **Then** registra como no app.
5. **Given** desconto em % ou valor, **When** aplica na conversa, **Then** o total recalcula; desconto maior que o total é recusado.
6. **Given** pagamento misto ou crédito parcelado, **When** confirma, **Then** valem as mesmas regras de soma, parcelas e tarifa do app.
7. **Given** pagamento em fiado sem cliente identificado, **When** tenta fechar, **Then** o fechamento é recusado.
8. **Given** loja apta a emitir, **When** a venda fecha, **Then** a nota entra como efeito do mesmo fluxo de venda do app — sem a lojista pedir "emite a nota".

---

### User Story 5 - Enviar cobrança por mensagem (Priority: P2)

A Cláudia dispara cobrança no momento em que lembra. Recebe confirmação do envio; sem dívida, é informada.

**Why this priority**: fecha o ciclo "quem deve → cobrar" (US-052); depende do catálogo e da porta de mensagem, não do Meta em produção.

**Independent Test**: "manda a cobrança pro João" com dívida → confirmação → envio (adapter real ou falso) + aviso à lojista; sem dívida → mensagem clara.

**Acceptance Scenarios** (US-052 · RF-107):

1. **Given** cliente com dívida e canal de envio disponível (incluindo adapter falso em teste), **When** confirma o disparo, **Then** a cobrança é enviada ao cliente e a lojista recebe confirmação do envio.
2. **Given** cliente sem dívida, **When** pede cobrança, **Then** o assistente informa que não há o que cobrar e nada é enviado.

---

### User Story 6 - Receber relatório por mensagem (Priority: P2)

A Cláudia pede "resumo do mês" e recebe faturamento, custo, despesas e resultado. Se o detalhe for grande demais para uma mensagem, nesta fatia ela recebe o resumo truncado no texto (sem arquivo/link ainda).

**Why this priority**: SHOULD no catálogo de produto; **RF-108 é obrigatório no DoD da NR-060**. RF-109 (arquivo/link) foi rebaixado a dívida técnica explícita na clarificação 2026-09-16.

**Independent Test**: pedido de resumo do período devolve os quatro eixos; volume alto ainda responde com resumo truncado legível, sem falhar.

**Acceptance Scenarios** (US-053 · RF-108; RF-109 diferido):

1. **Given** movimento no mês, **When** pede "resumo do mês", **Then** recebe faturamento, custo, despesas e resultado coerentes com o app.
2. **Given** relatório grande demais para uma mensagem, **When** pede, **Then** recebe resumo truncado no texto (sem arquivo/link nesta fatia); a lacuna RF-109 fica registrada como dívida, não como falha de aceite.

---

### User Story 7 - Recusar o que não entra no Zap (Priority: P1)

A Cláudia tenta operações sensíveis ou fora do recorte conversacional; o assistente recusa e aponta o app — sem guardar certificado, sem importar extrato, sem emitir/cancelar nota por comando avulso.

**Why this priority**: protege segurança e integridade fiscal (US-077–079); falhar aqui é risco de compliance, não só de UX.

**Independent Test**: três pedidos proibidos produzem recusa explícita e zero efeito colateral.

**Acceptance Scenarios** (US-077–079 · RF-149, RF-150, RF-151):

1. **Given** pedido para enviar certificado A1, senha ou cadastrar emitente (ou arquivo que parece certificado), **When** chega, **Then** o assistente recusa, não guarda o material e orienta o app.
2. **Given** pedido para importar OFX/CSV, Open Finance ou conciliar (ou arquivo de extrato), **When** chega, **Then** recusa e nada é importado.
3. **Given** "emite a NFC-e da venda X" ou "cancela a nota" sem cancelar a venda, **When** envia, **Then** recusa e explica que a nota segue a venda / o cancelamento da venda.

---

### Edge Cases

- Tentativa de uso do canal de teste por usuário final: recusada; sem execução e sem vazamento.
- Harness chamado em produção sem flag/autorização de engenharia: indisponível; sem efeito.
- Mensagem vazia ou só ruído: não executa ação; pede reformulação ou lista capacidades.
- Confirmação pendente expirou (TTL desta fatia): nada é executado; lojista precisa recomeçar o pedido.
- Dois produtos com nome parecido: nunca escolhe sozinho — desambigua (RF-102).
- Intenção misturada ("cadastra e já vende"): ou conduz em etapas com confirmações, ou pede para separar — não grava venda sem confirmação da venda.
- Provedor de modelo indisponível: degrada de forma avisada (modo falso ou erro claro), sem gravar valor "no escuro".
- Consumo de IA: medição por empresa desde o primeiro uso real; teto configurável com aviso (RNF-072, RNF-073) — sem surpresa de conta.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: O sistema MUST aceitar uma mensagem de texto no canal de teste **restrito a desenvolvedores do projeto** (via fixture) e devolver uma resposta de texto. MUST NOT liberar o assistente como produto a usuários finais nesta fatia.
- **FR-001a**: Conta real de lojista / sessão de produção MUST NOT alcançar o harness; tentativa fora do porteiro MUST ser recusada (sem executar capacidade nem vazar dados).
- **FR-001b**: O harness MUST operar apenas em não-produção **ou** atrás de flag explícita. O fluxo de aceite MUST permitir: criar usuário/empresa de teste, popular dados, autenticar como essa fixture e enviar mensagens. Em produção, o endpoint MUST permanecer desligado até o canal real / Studio de eng. (NR-113 / NR-121).
- **FR-002**: O sistema MUST interpretar consultas em linguagem natural e respondê-las exclusivamente a partir dos casos de uso de `core` já usados pelo app (RF-096).
- **FR-003**: Quando a intenção não for reconhecida — inclusive estoque, contas a pagar ou saldo de carteira (US-065–067 fora desta fatia) — o sistema MUST declarar **apenas** as capacidades já disponíveis nesta fatia e MUST NOT inventar dados, ações nem prometer funcionalidades futuras (RF-097).
- **FR-004**: O sistema MUST extrair dados de cadastro de cliente a partir de linguagem natural e propor o cadastro antes de gravar (RF-098).
- **FR-005**: O fluxo conversacional MUST detectar duplicidade de cliente com a mesma regra do app (RF-099).
- **FR-006**: O sistema MUST interpretar venda em linguagem natural (cliente, itens, quantidades, valores, forma de pagamento) e apresentar resumo para confirmação (RF-100).
- **FR-007**: Registrar venda pelo assistente MUST usar exatamente o mesmo caso de uso do aplicativo — mesmos cálculos, estoque, recebíveis e efeitos fiscais (RF-101).
- **FR-008**: Quando o produto informado corresponder a mais de um cadastro, o sistema MUST solicitar desambiguação listando opções (RF-102).
- **FR-009**: O sistema MUST interpretar desconto, pagamento misto/parcelado e fiado na venda por mensagem com as mesmas recusas do app (RF-136).
- **FR-010**: Antes de qualquer ação que crie, altere, exclua valor ou envie cobrança a terceiro, o sistema MUST exigir confirmação explícita; resposta ambígua conta como recusa; confirmação pendente expira (comportamento US-050 — armazenamento volátil aceitável nesta fatia; persistência é NR-061).
- **FR-011**: O sistema MUST disparar cobrança pelo assistente e confirmar o envio à lojista; sem dívida, MUST informar e não enviar (RF-107).
- **FR-012**: O sistema MUST gerar resumo de período com faturamento, custo, despesas e resultado (RF-108).
- **FR-013**: Quando o relatório exceder o que cabe em uma mensagem, o sistema MUST nesta fatia entregar resumo truncado no texto; entrega por arquivo ou link (RF-109) está **fora do aceite de merge** e MUST ser registrada como dívida técnica explícita.
- **FR-014**: O sistema MUST recusar certificado A1, senha e cadastro de emitente pelo canal conversacional, orientando o app (RF-149).
- **FR-015**: O sistema MUST recusar importação de extrato, Open Finance e conciliação pelo canal conversacional, orientando o app (RF-150).
- **FR-016**: O sistema MUST recusar comando avulso de emitir ou cancelar nota; nota só como efeito da venda ou do cancelamento da venda (RF-151).
- **FR-017**: Toda capacidade tipada do assistente MUST validar entrada com o mesmo contrato de schema já usado pela API correspondente — sem segundo conjunto de campos.
- **FR-018**: O assistente MUST NOT calcular totais, impostos, tarifas, parcelas ou margens; esses valores MUST vir do domínio via casos de uso.
- **FR-019**: O ambiente de desenvolvimento MUST permitir exercitar o laço completo sem provedor pago (provedor falso), e MUST permitir ligar o provedor real por configuração sem mudar o contrato de mensagem.
- **FR-020**: Consumo de IA MUST ser atribuível por empresa; teto configurável MUST degradar com aviso em vez de conta surpresa (RNF-072, RNF-073).

### Key Entities

- **Mensagem de entrada**: texto enviado por **desenvolvedor** no canal de teste, com empresa/ator de fixture no contexto; carrega a intenção a interpretar.
- **Capacidade (tool)**: ação tipada (consulta, cadastro, venda, cobrança, relatório, recusa) com schema de entrada compartilhado com a API e indicação se mexe em valor.
- **Proposta de confirmação**: resumo legível do que será executado, estado pendente, expiração; só vira efeito após "sim" explícito.
- **Resposta ao lojista**: texto (e, se couber, referência a arquivo/link) gerado a partir do resultado do caso de uso — não a partir de cálculo do modelo.
- **Contexto de execução**: empresa, usuário/papel e canal — o mesmo envelope que o app usa para autorização em `core`.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Em ambiente local com provedor falso, 100% dos cenários de aceite desta spec — P1, US-052 e US-053/RF-108 — são reproduzíveis por mensagem de teste sem chave de provedor externo (RF-109 não faz parte deste critério).
- **SC-002**: Para a mesma empresa e os mesmos dados, o total/líquido reportado em "quanto vendi hoje?" e o líquido da venda confirmada por mensagem batem com o app em 100% das execuções de verificação (zero divergência de centavos).
- **SC-003**: Em 100% das tentativas de mutação (cadastro, venda, cobrança), nenhum efeito é gravado antes da confirmação explícita; ambiguidade e expiração resultam em zero efeito.
- **SC-004**: Em 100% dos pedidos cobertos por RF-149–151, a resposta é recusa + orientação ao app, sem persistir certificado/extrato e sem emitir/cancelar nota por comando.
- **SC-005**: Consulta típica responde em até 5 segundos no canal de teste sob carga de desenvolvimento (RNF-006); ação com confirmação completa o ciclo de confirmação em até 8 segundos após o "sim".
- **SC-006**: Desenvolvedor consegue ligar o provedor real por configuração e repetir ao menos uma consulta e uma venda de ponta a ponta no mesmo contrato de mensagem usado no modo falso — sem liberar o canal a usuário final.

## Assumptions

- Runtime e modelo inicial já estão decididos ([ADR-0010](../../docs/decisoes/adr/0010-mastra-e-gpt-4o-mini.md)): biblioteca no pacote `agent`, composto pela API; modelo `openai/gpt-4o-mini` configurável; **não** servidor HTTP Mastra como canal do lojista; Studio fica para NR-121.
- Canal WhatsApp de produção (Meta) e vínculo por celular do owner ficam para NR-113/NR-046.
- O canal de teste desta fatia é **somente para desenvolvedores do projeto**; nenhum usuário final do produto o utiliza. Fluxo: criar fixture (usuário/empresa + dados) → autenticar como fixture → exercitar mensagens (clarificação 2026-09-16).
- Porteiro do harness: só não-produção (ou flag); produção desligada até NR-113/NR-121. A sessão nos testes é da **fixture**, não de conta real de lojista (clarificação 2026-09-16).
- Confirmação volátil em memória de processo é aceitável para demonstrar US-048/049/052 nesta fatia; NR-061 promove persistência e endurece US-050.
- Memória multi-turno ("manda a cobrança pra ele") e RAG auxiliar ficam para NR-062 e NR-120; cobrança nesta fatia assume cliente identificável na própria mensagem ou no estado mínimo necessário ao teste.
- Casos de uso de `core` para venda, cliente, recebíveis e resumo de faturamento já existem (trilhas anteriores); esta fatia os **aciona**, não os reimplementa.
- Adapter falso de envio de mensagem cobre RF-107 em teste até o Meta estar ligado.
- Consultas dedicadas de estoque / a pagar / saldo (US-065–067) não fazem parte do DoD; nesta fatia caem em RF-097 — só listar capacidades atuais, sem roadmap (clarificação 2026-09-16).
- Pacote `contracts` (NR-005 ✅) é a fonte dos schemas das tools.
- Apesar de US-053 ser SHOULD no MoSCoW do produto, o DoD desta fatia **exige** RF-108 (clarificação: alinhar merge ao ledger NR-060 no eixo de resumo).
- RF-109 (arquivo/link para relatório grande) é **dívida técnica explícita** desta fatia: no canal de teste basta resumo truncado no texto (clarificação 2026-09-16).

## Dependencies & Out of Scope

**Dependências:** NR-005 ✅; composição na API; casos de uso de `core` já entregues para os fluxos acima.

**Fora de escopo explícito:** NR-061, NR-062, NR-115–121, NR-113, NR-046, Memory/Workflow/RAG do framework como fonte de saldo ou total, qualquer cálculo monetário no caminho do modelo, e a entrega RF-109 (arquivo/link de relatório) — dívida registrada, não DoD.
