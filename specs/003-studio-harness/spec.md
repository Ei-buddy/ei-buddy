# Feature Specification: Harness Studio de engenharia (NR-121)

**Feature Branch**: `feat/NR-121-harness-studio`

**Created**: 2026-09-17

**Status**: Draft

**Input**: User description: "NR-121 com base na ADR-0010 (rev.), RNF-006. Use /mastra"

**Ledger**: [NR-121](../../docs/processo/task-ledger.md) — `agent`: harness Studio → laço único de mensagem (eng., não lojista) (2 dias; dep. NR-060 ✅).

**Fonte de verdade**: esta spec amarra o recorte da NR-121 já documentado em `docs/` para o fluxo Spec Kit (`/speckit-plan`, `/speckit-tasks`, `/speckit-implement`). Não substitui os catálogos permanentes. Em conflito de detalhe, prevalecem a [constitution](../../.specify/memory/constitution.md), o [escopo do MVP](../../docs/produto/escopo-mvp.md), as ADRs do assistente e os IDs `US-xxx` / `RF-xxx` / `RNF-xxx`.

| Artefato permanente                                                                        | Papel nesta spec                                                                              |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [ADR-0010](../../docs/decisoes/adr/0010-mastra-e-gpt-4o-mini.md) (rev. Studio, 2026-09-16) | Studio entra só como harness de engenharia; não é canal de produção do lojista                |
| [RNF-006](../../docs/produto/requisitos-nao-funcionais.md)                                 | Consulta ≤ 5 s; ação com confirmação ≤ 8 s — medido no harness até existir o webhook de prod  |
| [NR-060 / spec 002](../002-agent-mastra-runtime/spec.md)                                   | Runtime mínimo e canal HTTP de teste já entregues; Studio é o substituto do Zap em engenharia |
| [contrato Mastra](../../docs/arquitetura/integracoes/mastra.md)                            | Harness Studio MUST chamar o mesmo laço; caminho paralelo (confirmação/`core` à parte) é fora |
| Constitution — princípio I                                                                 | App e canal conversacional acionam os **mesmos** casos de uso                                 |

## Escopo desta fatia

**Entra (NR-121):**

1. Painel de harness de engenharia no ambiente local (e, se houver, staging com flag), para a equipe conversar com o assistente **como se fosse o canal de mensagem**, sem WhatsApp de produção.
2. Identidade de fixture: o desenvolvedor escolhe um **preset** (empresa de teste + número de telefone **forjado**) e as mensagens entram no **mesmo laço** já usado pelo canal HTTP de teste da NR-060.
3. Observabilidade do turno: o desenvolvedor vê duração (e, se couber, passos) de cada mensagem, o bastante para julgar [RNF-006](../../docs/produto/requisitos-nao-funcionais.md) antes do webhook real.
4. Porteiro: lojista e produção **não** alcançam este painel; tentativa não executa capacidade nem vaza dado.

**Fica para tarefas seguintes (não é critério de pronto desta spec):**

| Fora agora                                    | Onde                                         |
| --------------------------------------------- | -------------------------------------------- |
| Confirmação persistente em banco              | NR-061                                       |
| Memória / contexto multi-turno com RLS        | NR-062                                       |
| Consultas estoque / a pagar / fiado dedicadas | NR-115                                       |
| Foto de código, cadastros e baixas extras     | NR-116–119                                   |
| RAG auxiliar                                  | NR-120                                       |
| Identidade WhatsApp real (celular do owner)   | NR-113                                       |
| Adapter Meta Cloud + webhook de produção      | NR-046                                       |
| Canal do lojista no produto (app ou WhatsApp) | fora desta fatia por decisão (ADR-0010 rev.) |

O canal HTTP de teste da NR-060 (`POST` autenticado com sessão de fixture) **permanece**. O Studio não o substitui: é o segundo harness, o que simula o turno de mensagem (número forjado) e a inspeção visual do laço.

**Definition of Done (merge):** um desenvolvedor sobe o harness, escolhe um preset de fixture, envia uma consulta e uma ação com confirmação pelo painel, recebe as mesmas respostas/efeitos do canal HTTP de teste, vê a duração do turno, e o caminho está desligado para lojista e para produção.

## User Scenarios & Testing _(mandatory)_

Persona das jornadas: **desenvolvedor do projeto**. A Cláudia continua sendo o cenário de aceite das respostas (números iguais ao app). Nenhum usuário final do produto usa este painel.

### User Story 1 - Conversar no harness como no canal de mensagem (Priority: P1)

A equipe sobe o ambiente e o desenvolvedor abre o painel de harness. Escolhe um preset de empresa de teste (com dados já populados, como na NR-060) e envia "quanto vendi hoje?". Recebe o mesmo texto e os mesmos centavos que o canal HTTP de teste já devolve — sem montar sessão à mão nem esperar o WhatsApp.

**Why this priority**: a revisão da ADR-0010 existe para a cascata E11 andar **antes** do Meta. Sem este painel, o runtime da NR-060 só se exercita por `POST`; o substituto do Zap em engenharia não existe.

**Independent Test**: com runtime local e fixture, uma consulta conhecida no painel produz a mesma resposta (centavos e kind) que a mesma frase no canal HTTP de teste; o lojista não tem URL nem conta que alcance o painel.

**Acceptance Scenarios** (NR-121 · ADR-0010 rev. · RF-096 · RNF-006 em consulta):

1. **Given** o harness ativo em ambiente local e um preset de fixture com vendas do dia, **When** o desenvolvedor envia "quanto vendi hoje?" no painel, **Then** recebe total, quantidade e ticket médio iguais aos do app e iguais aos do canal HTTP de teste da mesma fixture.
2. **Given** o mesmo texto enviado nos dois harnesses (painel e HTTP) na mesma empresa de fixture, **When** as respostas voltam, **Then** os centavos batem e o caminho de execução é o laço único (não um segundo assistente).
3. **Given** provedor falso (sem chave paga), **When** o desenvolvedor usa o painel, **Then** a consulta funciona; ligar o provedor real é configuração, não outro contrato de mensagem.
4. **Given** uma pergunta fora das capacidades atuais, **When** envia no painel, **Then** o assistente lista só o que já sabe fazer e não inventa número.

---

### User Story 2 - Identidade forjada no lugar do WhatsApp (Priority: P1)

O desenvolvedor escolhe um preset que inclui um **número de telefone forjado** (não é o celular de um lojista real). As mensagens entram como turno de canal conversacional daquela fixture. Mutação continua pedindo confirmação explícita no mesmo fio; "sim" executa, ambiguidade e expiração não gravam.

**Why this priority**: o harness precisa antecipar o contrato do webhook (peer + empresa) sem NR-113/NR-046. Número forjado + preset é o que a ADR-0010 revisada manda; `companyId` nunca vem digitado pelo cliente.

**Independent Test**: dois presets (duas empresas de fixture, dois números) isolam dados; número desconhecido ou preset ausente não executa capacidade; confirmação de cadastro/venda no painel só grava após "sim".

**Acceptance Scenarios** (NR-121 · ADR-0010 rev. · RF-103/104 no comportamento já da NR-060):

1. **Given** um preset válido (empresa de fixture + número forjado), **When** o desenvolvedor pede um cadastro ou uma venda no painel, **Then** recebe proposta de confirmação; nada é gravado até o "sim".
2. **Given** "sim" explícito ainda dentro do prazo, **When** envia, **Then** o efeito é o mesmo caso de uso do app (mesmos centavos, mesmo estoque/recebível).
3. **Given** um número forjado que não está em nenhum preset, **When** uma mensagem chega no harness, **Then** o sistema recusa sem executar capacidade e sem vazar dado de outra empresa.
4. **Given** dois presets de empresas distintas, **When** o desenvolvedor troca o preset no painel, **Then** as consultas seguintes só enxergam a empresa do preset atual (isolamento; 404/vazio, nunca dado da outra).

---

### User Story 3 - Ver se o turno cabe no RNF-006 (Priority: P2)

Depois de um turno no painel, o desenvolvedor vê quanto tempo a consulta (e, depois do "sim", a ação) levou. Com provedor real, uma consulta típica aparece em ≤ 5 s e o ciclo de confirmação em ≤ 8 s após o "sim". Se estourar, o dado está visível — não depende de relógio de pulso.

**Why this priority**: RNF-006 é MUST do produto e hoje se mede "do webhook à mensagem enviada". Sem webhook, o harness é o único lugar honesto de medir. Sem observabilidade do turno, a NR-121 entrega conversa e não entrega o requisito que a tarefa cita.

**Independent Test**: um turno de consulta e um turno de ação+confirmação deixam duração visível; com provedor real e carga de desenvolvimento, os tetos de 5 s / 8 s são reproduzíveis ou o estouro fica registrado.

**Acceptance Scenarios** (NR-121 · RNF-006):

1. **Given** um turno de consulta concluído no painel, **When** o desenvolvedor abre a observabilidade daquele turno, **Then** vê a duração entre envio e resposta visível.
2. **Given** provedor real configurado e carga de desenvolvimento, **When** envia uma consulta típica ("quanto vendi hoje?"), **Then** a duração medida é ≤ 5 s.
3. **Given** o mesmo ambiente, **When** confirma uma ação típica ("sim" após proposta de cadastro ou venda), **Then** a duração do ciclo após o "sim" é ≤ 8 s.
4. **Given** um turno que estoura o teto, **When** o desenvolvedor inspeciona, **Then** a duração acima do limite está visível (não se perde no silêncio).

---

### Edge Cases

- Harness aberto em produção, ou URL do painel alcançada por lojista: indisponível; zero execução, zero vazamento.
- Preset ausente, JSON inválido ou empresa de fixture apagada: recusa clara; não cai no laço "como se fosse outra loja".
- Número forjado reutilizado em dois presets: o sistema MUST recusar a ambiguidade ou garantir um único mapeamento — nunca misturar empresas no mesmo número.
- Mensagem vazia ou só ruído: não executa ação; pede reformulação ou lista capacidades.
- Provedor de modelo indisponível: degrada de forma avisada (modo falso ou erro claro), sem gravar valor "no escuro".
- Caminho do painel que chame o modelo **sem** passar pelo laço único (confirmação, catálogo, `core`): proibido; se existir, é defeito desta fatia, não atalho.
- Consumo de IA: continua atribuído à empresa do preset (teto da NR-060); o painel não cria um segundo contador.
- Dado pessoal de lojista real MUST NOT ser usado como número forjado nem como massa do harness (RNF-034).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: O sistema MUST oferecer um painel de harness, restrito a **desenvolvedores do projeto**, no qual se envia texto e se recebe a resposta do assistente. MUST NOT ser canal de produto para o lojista (ADR-0010 rev.).
- **FR-002**: Toda mensagem originada no painel MUST entrar no **mesmo laço de processamento** já usado pelo canal HTTP de teste da NR-060 (interpretação → capacidade tipada → caso de uso). MUST NOT existir um segundo assistente, uma segunda composição de dependências, nem execução de capacidade que desvie da confirmação já definida.
- **FR-003**: O desenvolvedor MUST poder selecionar um **preset de fixture** que amarra, no servidor, empresa de teste + número de telefone forjado. `companyId` / `userId` / papel MUST sair desse preset (ou da resolução de identidade da fixture), **nunca** do texto digitado no painel.
- **FR-004**: Mensagem no painel MUST ser tratada como turno de canal conversacional daquela fixture (o análogo de engenharia do WhatsApp), não como sessão de lojista em produção.
- **FR-005**: Número forjado desconhecido, preset ausente ou mapeamento ambíguo MUST ser recusado sem executar capacidade e sem revelar se outra empresa existe.
- **FR-006**: Isolamento entre presets MUST valer: consulta/ação no preset A MUST NOT ler nem gravar dado do preset B.
- **FR-007**: Mutação e envio a terceiro no painel MUST exigir a mesma confirmação explícita do laço já existente; ambiguidade e expiração MUST resultar em zero efeito.
- **FR-008**: Consulta típica no painel MUST devolver os mesmos centavos que o app e que o canal HTTP de teste, para a mesma fixture e os mesmos dados (RF-101; o assistente não calcula).
- **FR-009**: O painel MUST operar em não-produção. Em produção MUST permanecer desligado. Flag explícita MAY liberar em staging; MUST NOT liberar o painel a usuário final.
- **FR-010**: O ambiente local MUST permitir o painel com provedor falso (sem chave paga). Ligar o provedor real MUST ser configuração, sem mudar o contrato de mensagem.
- **FR-011**: O sistema MUST expor a duração de cada turno do painel (envio → resposta visível), o bastante para verificar RNF-006. Consulta típica com provedor real MUST completar em ≤ 5 s; ação com confirmação MUST completar o ciclo em ≤ 8 s após o "sim", sob carga de desenvolvimento.
- **FR-012**: Consumo de IA no painel MUST continuar atribuído à empresa do preset (teto já da NR-060). O harness MUST NOT burlar o teto.
- **FR-013**: O canal HTTP de teste da NR-060 MUST continuar disponível; o painel é adicional, não substituto daquele contrato.
- **FR-014**: O painel MUST NOT persistir memória de conversa em schema sem `company_id`, MUST NOT usar o servidor do framework como canal do lojista, e MUST NOT ligar recuperação semântica como fonte de saldo ou total (fronteira da ADR-0010 / ADR-0016 / ADR-0017).

### Key Entities

- **Painel de harness**: interface de engenharia para enviar e ler turnos do assistente; não faz parte do produto do lojista.
- **Preset de fixture**: configuração nomeada que amarra empresa de teste, ator (`owner` de fixture) e número de telefone forjado.
- **Número forjado**: identificador de peer usado só em engenharia; não é o celular de um owner real (isso é NR-113).
- **Turno**: uma mensagem de entrada + a resposta visível; carrega duração para RNF-006.
- **Laço único**: o processador de mensagem já entregue na NR-060 — confirmação, catálogo e casos de uso — compartilhado por HTTP de teste, painel e, no futuro, webhook.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Em ambiente local com provedor falso, 100% dos cenários P1 desta spec (consulta no painel = consulta HTTP; cadastro ou venda com confirmação) são reproduzíveis sem chave de provedor externo.
- **SC-002**: Para a mesma fixture e os mesmos dados, os centavos da consulta e da ação confirmada no painel batem com o app e com o canal HTTP de teste em 100% das execuções de verificação (zero divergência).
- **SC-003**: Com provedor real e carga de desenvolvimento, 100% das consultas típicas medidas no painel completam em ≤ 5 s, e 100% dos ciclos de confirmação típicos completam em ≤ 8 s após o "sim" (RNF-006).
- **SC-004**: Em 100% das tentativas sem preset válido, com número forjado desconhecido, por lojista, ou em produção, o sistema recusa sem executar capacidade e sem vazar dado.
- **SC-005**: Em 100% das mutações iniciadas no painel, nenhum efeito é gravado antes do "sim" explícito; ambiguidade e expiração resultam em zero efeito.
- **SC-006**: Após cada turno de aceite, o desenvolvedor consegue ler a duração daquele turno em no máximo uma inspeção no próprio harness (sem cronômetro externo).

## Assumptions

- Runtime mínimo da NR-060 já está na `main`: laço de mensagem, catálogo base, canal HTTP de teste com sessão de fixture, provedor falso no local.
- A revisão da [ADR-0010](../../docs/decisoes/adr/0010-mastra-e-gpt-4o-mini.md) (2026-09-16, Studio) é a decisão desta fatia: o painel de harness (Studio do framework escolhido) substitui o Zap em engenharia; **não** vira plataforma do lojista.
- Presets de contexto de requisição e vistas de traço/duração são capacidades atuais do Studio do framework (documentação 2026-09); o plano usará essas peças **atrás** do laço único, não um agente paralelo.
- Mapeamento número forjado → empresa é **fixture de engenharia**. O diretório de peers de produção (celular do owner) é NR-113.
- RNF-006 nesta fatia mede o harness (envio no painel → resposta visível). A medição "webhook recebido → mensagem enviada" só fica literal quando NR-046 existir; o teto numérico já vale agora.
- Confirmação continua volátil em processo até a NR-061; memória multi-turno até a NR-062. O painel não as antecipa.
- Observabilidade desta fatia é duração (e passos) do turno no harness local. Plataforma hospedada do framework, métricas OLAP e auth EE do Studio **não** entram.
- Massa do harness é sintética; dado de produção não é copiado (RNF-034).
- Pacote `contracts` e composição na API já existentes são reusados; esta fatia não cria caso de uso de negócio novo.

## Dependencies & Out of Scope

**Dependências:** NR-060 ✅ (runtime + canal HTTP de teste); fixture de usuário/empresa já usável.

**Fora de escopo explícito:** NR-061, NR-062, NR-115–120, NR-113, NR-046, Memory/Workflow/RAG do framework como fonte de valor, Studio como URL de produto, auth empresarial do painel em produção, e qualquer cálculo monetário no caminho do modelo.
