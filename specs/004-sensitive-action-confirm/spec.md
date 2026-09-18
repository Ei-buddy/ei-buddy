# Feature Specification: Confirmação de ação sensível, com expiração (NR-061)

**Feature Branch**: `feat/NR-061-confirmacao-acao-sensivel`

**Created**: 2026-09-17

**Status**: Draft

**Input**: User description: "Precisamos resolver NR-061 — agent: confirmação de ação sensível, com expiração. Trilha 2 (Plataforma & Integrações), 2 dias. Dep. NR-060, NR-121. US-050, RF-103, RF-104."

**Ledger**: [NR-061](../../docs/processo/task-ledger.md) — `agent`: confirmação de ação sensível, com expiração (2 dias; dep. NR-060 ✅, NR-121 ✅).

**Fonte de verdade**: esta spec amarra o recorte da NR-061 já documentado em `docs/` para o fluxo Spec Kit (`/speckit-plan`, `/speckit-tasks`, `/speckit-implement`). Não substitui os catálogos permanentes. Em conflito de detalhe, prevalecem a [constitution](../../.specify/memory/constitution.md), o [escopo do MVP](../../docs/produto/escopo-mvp.md), as ADRs do assistente e os IDs `US-xxx` / `RF-xxx` / `RNF-xxx`.

| Artefato permanente                                                            | Papel nesta spec                                                                                          |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| [US-050](../../docs/produto/user-stories.md#us-050--confirmar-ação-sensível)   | Jornada e critérios de aceite da confirmação                                                              |
| [RF-103, RF-104](../../docs/produto/requisitos-funcionais.md)                  | Requisitos rastreáveis cobertos por esta fatia                                                            |
| [RNF-006](../../docs/produto/requisitos-nao-funcionais.md)                     | Ação com confirmação ≤ 8 s após o "sim"                                                                   |
| [NR-060 / spec 002](../002-agent-mastra-runtime/spec.md)                       | Laço de mensagem e comportamento de confirmação já existem; nesta fatia o armazenamento era volátil       |
| [NR-121 / spec 003](../003-studio-harness/spec.md)                             | Harness de engenharia exercita o mesmo laço; confirmação persistente MUST valer ali também                |
| [ADR-0010](../../docs/decisoes/adr/0010-mastra-e-gpt-4o-mini.md)               | Confirmação **não** é feature do runtime de modelo: é máquina nossa                                       |
| [ADR-0016](../../docs/decisoes/adr/0016-memoria-da-conversa-tabelas-nossas.md) | Confirmação vive na conversa da loja, isolada; histórico/anáfora/idle de 2 h ficam na NR-062              |
| [ADR-0002](../../docs/decisoes/adr/0002-autenticacao-identidade-propria.md)    | Confirmação no mesmo canal **não** é segundo fator                                                        |
| Constitution — Produto / I / IV                                                | Consultar livre; criar/alterar/apagar valor e mensagem a terceiro exigem confirmação; isolamento por loja |

## Escopo desta fatia

**Entra (NR-061):**

1. Toda ação que cria, altera ou apaga valor, ou envia mensagem a terceiro, **resume** o que vai acontecer e **espera confirmação explícita** no mesmo fio da conversa. Nada é gravado antes do "sim".
2. Confirmação pendente **expira** após o prazo; "sim" atrasado não executa. Resposta ambígua conta como **não**.
3. A pendência **sobrevive** a reinício do serviço que atende a conversa: o lojista (ou o desenvolvedor no harness) não perde o pedido só porque o processo caiu.
4. A pendência é **daquela loja e daquela conversa**. Outra loja não confirma, não vê e não executa o pedido da primeira.
5. Consulta continua livre: não pede confirmação.

**Fica para tarefas seguintes (não é critério de pronto desta spec):**

| Fora agora                                                        | Onde                                               |
| ----------------------------------------------------------------- | -------------------------------------------------- |
| Memória / anáfora / idle de 2 h / expurgo de 30 dias              | NR-062 (US-051 / RF-105–106, ADR-0016)             |
| Consultas estoque / a pagar / fiado dedicadas                     | NR-115                                             |
| Foto de código, cadastros extras, baixas, cancelar/devolver venda | NR-116–118                                         |
| Criar compromisso por mensagem                                    | NR-119                                             |
| RAG auxiliar                                                      | NR-120                                             |
| Identidade WhatsApp real + adapter Meta                           | NR-113, NR-046                                     |
| Canal do lojista em produção                                      | fora desta fatia (ADR-0010: harness de engenharia) |
| Aprovação HITL do framework de agente                             | fora por decisão (ADR-0010 / ADR-0016)             |

O comportamento de "pede confirmação / só grava no sim / ambíguo = não / expirado = não" **já é aceite da NR-060** em armazenamento volátil. O que esta fatia **fecha** é US-050 de ponta a ponta: persistência, isolamento por loja e o mesmo contrato nos dois harnesses (HTTP de teste e painel de engenharia).

**Definition of Done (merge):** uma mutação proposta no harness pede confirmação e **não** grava; "sim" dentro do prazo grava pelo mesmo caso de uso do app; ambiguidade e expiração não gravam; após reinício do serviço, pendência ainda válida continua confirmável e pendência vencida não executa; loja B não interfere na pendência da loja A.

## User Scenarios & Testing _(mandatory)_

Persona das jornadas de aceite: **Cláudia** (P1, papel `owner`) — o texto e os efeitos são os dela. Quem dispara as mensagens nesta fatia continua sendo **desenvolvedor do projeto** nos harnesses da NR-060/NR-121 (fixture), não a lojista em produção.

### User Story 1 - Resumir e só executar depois do "sim" (Priority: P1)

A Cláudia pede algo que mexe em dinheiro — cadastrar cliente, lançar venda ou mandar cobrança. O assistente **não** executa: devolve um resumo em português do que vai acontecer e pergunta se confirma. Só depois de um "sim" explícito, ainda no prazo, o efeito aparece (o mesmo do aplicativo). Sem o "sim", o cadastro, a venda e a cobrança **não existem**.

**Why this priority**: é o coração da US-050 e do RF-103. Sem este portão, o canal conversacional vira um atalho inseguro para o caixa.

**Independent Test**: um pedido de mutação devolve proposta e zero efeito; o "sim" seguinte produz exatamente um efeito, igual ao app.

**Acceptance Scenarios** (US-050 · RF-103):

1. **Given** um pedido que cria, altera ou apaga valor (cadastro, venda) ou envia mensagem a terceiro (cobrança), **When** a mensagem chega, **Then** o assistente devolve um resumo legível do que será feito, pergunta confirmação, e **nada** foi gravado nem enviado.
2. **Given** essa proposta ainda no prazo, **When** a Cláudia responde com confirmação explícita ("sim" ou equivalente inequívoco), **Then** o efeito é o mesmo caso de uso do aplicativo (mesmos centavos, mesmo estoque/recebível/envio).
3. **Given** a mesma proposta, **When** ela responde com recusa explícita ("não", "cancela"), **Then** recebe confirmação de que nada foi registrado e o efeito permanece zero.
4. **Given** um resumo de venda, **When** ela compara com o que o app gravaria para os mesmos dados, **Then** os centavos e os itens batem — o assistente não inventa total.

---

### User Story 2 - Pendência que não some no reinício (Priority: P1)

A Cláudia pediu a venda, recebeu o resumo e foi atender o balcão. O serviço que atende a conversa reinicia. Ela volta e manda "sim" ainda dentro do prazo. A venda fecha. Se o prazo já passou, o "sim" **não** fecha nada — ela precisa pedir de novo.

**Why this priority**: é o gap que a NR-060 deixou explícito (armazenamento volátil) e o que a NR-061 existe para fechar. Sem persistência, o portão de segurança some no deploy.

**Independent Test**: propor mutação, reiniciar o serviço do harness, confirmar ainda no prazo → um efeito; repetir com relógio além do prazo → zero efeito.

**Acceptance Scenarios** (US-050 · RF-103 · RF-104):

1. **Given** uma confirmação pendente ainda no prazo, **When** o serviço que atende a conversa reinicia e depois chega "sim", **Then** o efeito é executado como se o reinício não tivesse ocorrido.
2. **Given** a mesma pendência já fora do prazo após o reinício, **When** chega "sim", **Then** o assistente informa que a confirmação expirou, nada foi feito, e pede para enviar o pedido de novo.
3. **Given** duas sessões de harness da **mesma** loja e da **mesma** conversa (canal HTTP de teste e painel de engenharia), **When** a proposta nasce num e o "sim" chega no outro ainda no prazo, **Then** o efeito ocorre uma vez — a pendência é da conversa, não do processo em memória.

---

### User Story 3 - Expirar e tratar ambiguidade como "não" (Priority: P1)

A Cláudia demora demais, ou responde "talvez depois", "ok vamos ver", um emoji, ou qualquer coisa que não seja um sim claro. O assistente **não** arrisca: trata como não, avisa que cancelou, e nada é lançado. Errar para o lado do "não" custa uma pergunta a mais; errar para o lado do "sim" custa um lançamento financeiro.

**Why this priority**: RF-104 é MUST; a constitution manda o mesmo viés. Sem isso, o portão existe só no caminho feliz.

**Independent Test**: três desfechos sem efeito — recusa explícita, texto ambíguo, relógio além do prazo — e um "sim" pontual que executa.

**Acceptance Scenarios** (US-050 · RF-104):

1. **Given** uma confirmação pendente, **When** passa o tempo limite (5 minutos a partir da proposta) e chega qualquer resposta, **Then** nada é executado; se a resposta era só o "sim"/"não" (ou equivalente) ou não parece um pedido novo, o assistente diz que expirou e pede para recomeçar.
2. **Given** uma confirmação pendente ainda no prazo, **When** a resposta não é um sim nem um não inequívoco ("talvez", "depois", "olha isso"), **Then** o assistente trata como recusa, informa que cancelou e pede para enviar o pedido de novo; a pendência **não** permanece aberta (US-050 “pergunta de novo” = recomeçar o pedido, não insistir no mesmo resumo).
3. **Given** uma confirmação já expirada, **When** a Cláudia envia um **pedido novo** (não um sim/não solto), **Then** o assistente não executa a ação velha e trata a mensagem como intenção nova (pode gerar nova proposta, se for mutação).
4. **Given** "sim" ainda no prazo, **When** o ciclo completa, **Then** a duração percebida do "sim" até a resposta com o efeito é ≤ 8 segundos no harness sob carga de desenvolvimento (RNF-006).

---

### User Story 4 - Consultar sem atrito (Priority: P2)

A Cláudia pergunta "quanto vendi hoje?" ou "quem está me devendo?". O assistente responde na hora, **sem** "confirma?". Confirmação é para o que mexe em dinheiro ou fala com terceiro, não para leitura.

**Why this priority**: US-050 distingue consulta de ação; sem este recorte o produto vira um interrogatório.

**Independent Test**: uma consulta conhecida devolve números do mesmo caso de uso do app, com kind de resposta e zero pedido de confirmação.

**Acceptance Scenarios** (US-050 · RF-103 negativo):

1. **Given** uma consulta coberta pelo runtime atual ("quanto vendi hoje?", listagem de quem deve, resumo do mês), **When** envia, **Then** recebe a resposta **sem** pergunta de confirmação e **sem** gravar mutação.
2. **Given** uma confirmação pendente de uma venda, **When** ela ignora o prazo e o pedido expira, **Then** a consulta seguinte continua livre — a expiração não bloqueia leitura.

---

### User Story 5 - Uma loja não confirma a de outra (Priority: P2)

Duas empresas de fixture conversam em paralelo. A proposta da loja A não aparece na loja B. "Sim" na loja B não fecha a venda da loja A. Tentativa de enxergar a pendência da outra loja falha como "não existe" — nunca como "existe e você não pode".

**Why this priority**: isolamento de tenant é ameaça existencial (constitution IV). Persistir a confirmação sem RLS vira vazamento novo.

**Independent Test**: duas fixtures, duas propostas; cada "sim" só afeta a própria loja; leitura cruzada não devolve a pendência alheia.

**Acceptance Scenarios** (RF-103 · isolamento):

1. **Given** loja A com confirmação pendente e loja B sem, **When** a loja B envia "sim", **Then** nada é gravado na loja A e a loja B não recebe o resumo da A.
2. **Given** as duas lojas com pendências distintas, **When** cada uma confirma, **Then** cada efeito ocorre só na própria empresa.
3. **Given** qualquer tentativa de ler ou resolver a pendência da outra empresa, **When** o sistema responde, **Then** o resultado é ausência (não encontrado), nunca o conteúdo da proposta alheia.

---

### Edge Cases

- **Pedido novo enquanto há pendência válida**: a pendência anterior é encerrada **sem executar**; a mensagem nova segue o laço normal (pode gerar nova proposta). Só existe **uma** confirmação aberta por conversa.
- **Dois "sim" seguidos** para a mesma proposta: o primeiro executa; o segundo **não** duplica o efeito (a pendência já foi resolvida).
- **Reinício no meio do "sim"**: a escrita do caso de uso continua idempotente pela chave já exigida em `core`; a confirmação não pode disparar a mesma mutação duas vezes.
- **Teto de consumo de IA estourado**: não executa mutação nem no "sim"; avisa a degradação (já da NR-060); a pendência não vira efeito "no escuro".
- **Cancelamento de venda com nota** (justificativa ao emissor): **fora desta fatia** (NR-118 / US-075). Quando essa ação existir, o **mesmo** portão MUST incluir a justificativa no resumo — o contrato da confirmação precisa caber isso, sem implementar o cancelamento agora.
- **Confirmação no WhatsApp de produção**: fora (NR-113/NR-046). O contrato do harness (número forjado / sessão de fixture) é o substituto.
- **Confirmação não é segundo fator**: quem controla o canal responde o "sim". Troca de número, exportação e anonimização continuam exigindo o aplicativo (ADR-0002). Esta fatia **não** trata confirmação como autenticação.
- **Mensagem vazia / só ruído** com pendência aberta: conta como ambígua → recusa, zero efeito.
- **Relógio**: expiração usa o instante do contexto da mensagem (injetável nos testes), não o relógio do avaliador.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Antes de qualquer ação que crie, altere ou exclua valor, ou envie mensagem a terceiro, o sistema MUST devolver um resumo compreensível do que será executado e MUST exigir confirmação explícita no mesmo canal em que o pedido foi feito. MUST NOT gravar nem enviar nada antes dessa confirmação. (RF-103, US-050)
- **FR-002**: Consulta (leitura do negócio) MUST NOT pedir confirmação. (US-050)
- **FR-003**: Somente resposta inequívoca de aceite ("sim" e equivalentes claros de afirmação) MUST executar a ação proposta. (RF-103)
- **FR-004**: Recusa explícita ("não", "cancela" e equivalentes claros) MUST encerrar a pendência sem executar. (RF-104)
- **FR-005**: Qualquer resposta que não seja aceite nem recusa inequívoca MUST ser tratada como recusa: a pendência encerra, nada é executado, e o assistente informa que cancelou por não ter entendido como confirmação. MUST NOT executar no benefício da dúvida. (RF-104, US-050)
- **FR-006**: Confirmação pendente MUST expirar **5 minutos** após a proposta. Depois do prazo, nenhum "sim" executa aquela ação. O assistente MUST informar que expirou e que o pedido precisa ser enviado de novo, salvo quando a mensagem já for um pedido novo (FR-007). (RF-104)
- **FR-007**: Se a pendência já expirou e a mensagem **não** é um sim/não solto — parece um pedido novo — o sistema MUST encerrar a pendência velha sem executá-la e MUST tratar a mensagem como intenção nova. (US-050)
- **FR-008**: O sistema MUST persistir a pendência de forma que sobreviva a reinício do serviço que atende a conversa, até ser aceita, recusada ou expirar. (RF-103, RF-104; fecha o recorte volátil da NR-060)
- **FR-009**: A pendência MUST pertencer a **uma** loja e **uma** conversa (empresa + canal + interlocutor). Loja nenhuma MUST ler, alterar ou confirmar pendência de outra. Recurso de outro tenant MUST parecer inexistente. (constitution IV)
- **FR-010**: Só MUST haver **uma** pendência aberta por conversa. Novo pedido sensível na mesma conversa MUST encerrar a pendência anterior **sem** executá-la.
- **FR-011**: Aceite, recusa e expiração MUST ficar registrados como decisão daquela pendência (não executou / executou). A linha NÃO é apagada no desfecho: o histórico da proposta permanece na loja.
- **FR-012**: Os dois harnesses de engenharia (canal HTTP de teste da NR-060 e painel da NR-121) MUST compartilhar a mesma pendência da conversa. Confirmar num MUST valer no outro. (NR-121)
- **FR-013**: Execução após o "sim" MUST chamar o **mesmo** caso de uso do aplicativo — o assistente MUST NOT calcular nem gravar por um caminho paralelo. (constitution I, RF-101 / RF-107 já existentes)
- **FR-014**: O resumo da proposta MUST ser o texto que o lojista lê para decidir; MUST caber justificativa ou detalhe obrigatório da ação quando essa ação existir (ex.: cancelamento de venda com nota, US-050). Esta fatia MUST NOT implementar o cancelamento.
- **FR-015**: Confirmação no mesmo canal MUST NOT ser apresentada nem implementada como segundo fator de autenticação. (ADR-0002)
- **FR-016**: A máquina de confirmação MUST ser do produto, no mesmo laço da conversa. Um fluxo de “aprovar a ferramenta no framework de agente” MUST NOT substituir este portão: não isola por loja nem expira como o RF-104 pede. (ADR-0010, ADR-0016)
- **FR-017**: Teste automatizado MUST provar: (a) zero efeito antes do "sim"; (b) zero efeito na ambiguidade; (c) zero efeito na expiração, inclusive após reinício; (d) efeito único no "sim" pontual, inclusive após reinício; (e) loja B não confirma loja A.
- **FR-018**: Após o "sim" pontual, o lojista (ou o desenvolvedor no harness) MUST perceber a conclusão da ação em ≤ 8 segundos sob carga de desenvolvimento. (RNF-006)

### Key Entities

- **Proposta de confirmação**: resumo em português do que será executado, conversa a que pertence, instante em que expira, estado (aberta / aceita / recusada / expirada). Só a aberta pode virar efeito.
- **Conversa da loja**: identidade daquele interlocutor naquele canal naquela empresa. É o dono da pendência. Histórico de mensagens para anáfora **não** é entidade desta fatia.
- **Decisão**: aceite, recusa ou expiração, com o momento em que a pendência deixou de estar aberta.
- **Ação proposta**: a capacidade tipada já existente (cadastro, venda, cobrança, …) e os dados validados — executada só depois do aceite, pelo caso de uso de `core`.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Em 100% das tentativas de mutação cobertas pelo runtime atual (cadastro, venda, cobrança), nenhum efeito é gravado nem enviado antes da confirmação explícita.
- **SC-002**: Em 100% das respostas ambíguas e em 100% dos "sim" após o prazo de 5 minutos, o efeito permanece zero e o lojista é informado em linguagem clara (cancelou / expirou).
- **SC-003**: Em 100% dos testes de reinício com pendência ainda no prazo, o "sim" posterior executa **uma** vez e os centavos batem com o app.
- **SC-004**: Em 100% dos testes de isolamento, a loja B não executa nem lê a pendência da loja A (resultado = ausência, nunca o resumo alheio).
- **SC-005**: 100% das consultas cobertas pelo runtime atual respondem sem pedido de confirmação.
- **SC-006**: O ciclo "sim" → resposta com efeito completa em ≤ 8 segundos no harness de engenharia, sob carga de desenvolvimento (RNF-006).
- **SC-007**: Um desenvolvedor reproduz os cenários P1 desta spec nos **dois** harnesses (HTTP e painel) sem WhatsApp de produção e sem usuário final.

## Assumptions

- O laço de mensagem, o catálogo mínimo de capacidades e o viés "ambíguo = não / TTL 5 min" já foram entregues na NR-060; esta fatia **não** redesenha interpretação de linguagem nem cria tools novas.
- O prazo de 5 minutos é o default já adotado na spec 001 e no runtime atual, na ausência de outro valor nos catálogos de RF.
- Equivalentes de aceite: respostas curtas inequívocas do tipo sim / s / ok / pode / confirmo / confirma / yes. Equivalentes de recusa: não / n / cancela / cancelar / no. Qualquer outra coisa é ambígua. US-050 (“trata como não e pergunta de novo”) nesta fatia significa: encerrar a pendência sem executar e orientar a reenviar o pedido — o mesmo viés já aceito na NR-060 —, não manter a proposta aberta até um sim.
- Canal de demonstração continua sendo **somente desenvolvedor** (fixture), como na NR-060/NR-121. WhatsApp de produção não entra.
- Persistência da pendência usa o isolamento por loja já existente no banco de negócio. A confirmação se liga à **identidade** da conversa (empresa + canal + interlocutor). Se essa conversa ainda não tiver histórico (NR-062), esta fatia pode criar só o registro de identidade necessário — **sem** implementar anáfora, janela de 12 mensagens, idle de 2 h nem expurgo de 30 dias.
- O framework de agente atual oferece pausa de aprovação de ferramenta (HITL: `requireToolApproval` / `requireApproval` / `approveToolCall` / `declineToolCall`). **Não** atende RF-103/104: não isola por empresa, não expira em 5 minutos no canal do lojista e faria a ferramenta gravar no `execute`. O modelo só escolhe a intenção; o efeito continua depois da nossa confirmação.
- Relógio e data entram como parâmetro do contexto (constitution V); testes de expiração não dependem de `sleep` real de 5 minutos.
- Idempotência da escrita continua sendo responsabilidade do caso de uso em `core` (RNF-043); a confirmação não é a chave de idempotência, só o portão.
- Exportação LGPD da tabela de confirmações não é DoD desta fatia (NR-031/086 já existem; o repositório de privacidade ainda marca a tabela como sem caso de uso ligado). Isolamento por loja **é** DoD.
- NR-062 pode, depois, passar a gravar o histórico na mesma conversa; esta fatia não quebra esse encaixe.

## Dependencies & Out of Scope

**Dependências:** NR-060 ✅ (runtime + confirmação volátil); NR-121 ✅ (harness Studio no mesmo laço); casos de uso de `core` já usados pelas tools de mutação; schema de negócio já contém o lugar da confirmação isolada por loja.

**Fora de escopo explícito:** NR-062, NR-115–120, NR-113, NR-046, Memory/HITL/Workflow do framework como portão de valor, qualquer cálculo monetário no caminho do modelo, e tratar "sim" no chat como autenticação forte.
