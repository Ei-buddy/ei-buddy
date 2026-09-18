# Feature Specification: Contexto de conversa isolado por empresa (NR-062)

**Feature Branch**: `feat/NR-062-contexto-conversa-isolado`

**Created**: 2026-09-17

**Status**: Draft

**Input**: User description: "NR-062 — agent: contexto de conversa isolado por empresa. Trilha 2 (Plataforma & Integrações), 3 dias. Dep. NR-060, NR-121. US-051, RF-105, RF-106, ADR-0016."

**Ledger**: [NR-062](../../docs/processo/task-ledger.md) — `agent`: contexto de conversa isolado por empresa (3 dias; dep. NR-060 ✅, NR-121 ✅).

**Fonte de verdade**: esta spec amarra o recorte da NR-062 já documentado em `docs/` para o fluxo Spec Kit (`/speckit-plan`, `/speckit-tasks`, `/speckit-implement`). Não substitui os catálogos permanentes. Em conflito de detalhe, prevalecem a [constitution](../../.specify/memory/constitution.md), o [escopo do MVP](../../docs/produto/escopo-mvp.md), as ADRs do assistente e os IDs `US-xxx` / `RF-xxx` / `RNF-xxx`.

| Artefato permanente                                                                                                               | Papel nesta spec                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [US-051](../../docs/produto/user-stories.md#us-051--manter-o-contexto-da-conversa)                                                | Jornada e critérios de aceite do contexto                                                         |
| [RF-105, RF-106](../../docs/produto/requisitos-funcionais.md)                                                                     | Requisitos rastreáveis cobertos por esta fatia                                                    |
| [RNF-035](../../docs/produto/requisitos-nao-funcionais.md)                                                                        | Conteúdo de conversa retido pelo mínimo declarado, com expurgo verificável                        |
| [RNF-075](../../docs/produto/requisitos-nao-funcionais.md)                                                                        | Ao modelo vai o mínimo necessário                                                                 |
| [ADR-0016](../../docs/decisoes/adr/0016-memoria-da-conversa-tabelas-nossas.md) / [DEC-011](../../docs/decisoes/README.md#dec-011) | O quê, onde, chave, janela de 12, idle de 2 h, retenção de 30 dias; sem Memory do framework       |
| [ADR-0012](../../docs/decisoes/adr/0012-identidade-do-canal-whatsapp.md)                                                          | Chave lógica: empresa + canal + interlocutor                                                      |
| [NR-060 / spec 002](../002-agent-mastra-runtime/spec.md)                                                                          | Laço de mensagem já existe; nesta fatia o histórico multi-turno ainda não era aceite              |
| [NR-121 / spec 003](../003-studio-harness/spec.md)                                                                                | Harness de engenharia exercita o mesmo laço; o contexto MUST valer ali também                     |
| [NR-061 / spec 004](../004-sensitive-action-confirm/spec.md)                                                                      | Confirmação é máquina à parte (TTL 5 min); pode já ter criado só a identidade da conversa         |
| Constitution — Produto / I / IV                                                                                                   | Nunca perguntar o que já se sabe; app e conversa usam os mesmos casos de uso; isolamento por loja |

## Escopo desta fatia

**Entra (NR-062):**

1. A conversa **lembra** o que acabou de ser dito naquele fio, o bastante para resolver referência ("ele", "essa venda") **sem** a Cláudia repetir nome, valor ou item.
2. O contexto é **daquela loja e daquele interlocutor naquele canal**. Outra loja não lê, não herda e não aplica o histórico da primeira.
3. Conversa **parada por 2 horas** deixa de ser contexto ativo: referência antiga **não** é aplicada em silêncio a um pedido novo — o assistente pede de novo.
4. Só o recorte recente viaja para a interpretação da linguagem: no máximo as **últimas 12 mensagens** da conversa vigente (ou menos, se o idle tiver cortado antes). Histórico antigo continua guardado até o prazo de retenção, mas **não** vai inteiro ao provedor de modelo.
5. Corpos de mensagem com mais de **30 dias** são **expurgados** por rotina verificável. Efeito de negócio (venda, cadastro, cobrança) **não** some com o chat.
6. O histórico **sobrevive** a reinício do serviço. Os dois harnesses de engenharia (HTTP de teste e painel) da **mesma** loja e da **mesma** conversa compartilham o mesmo fio.

**Fica para tarefas seguintes (não é critério de pronto desta spec):**

| Fora agora                                                        | Onde                                               |
| ----------------------------------------------------------------- | -------------------------------------------------- |
| Confirmação persistente (TTL 5 min, ambíguo = não)                | NR-061 (US-050 / RF-103–104) — máquina à parte     |
| Consultas estoque / a pagar / fiado dedicadas                     | NR-115                                             |
| Foto de código, cadastros extras, baixas, cancelar/devolver venda | NR-116–118                                         |
| Criar compromisso por mensagem                                    | NR-119                                             |
| Recuperação auxiliar (candidatos / trechos, sem virar saldo)      | NR-120 (ADR-0017)                                  |
| Identidade WhatsApp real + adapter Meta                           | NR-113, NR-046                                     |
| Canal do lojista em produção                                      | fora desta fatia (ADR-0010: harness de engenharia) |
| Memory / Storage / recall semântico do framework de agente        | fora por decisão (ADR-0010 / ADR-0016)             |
| Perfil de preferências, fine-tune ou treino com conversa          | fora (ADR-0016: "aprendizado" = só turno)          |

O laço "mensagem → intenção → capacidade → caso de uso" **já é aceite da NR-060**. Cobrança e venda nesta fatia anterior assumiam o cliente identificável **na própria mensagem**. O que esta fatia **fecha** é US-051 de ponta a ponta: lembrar no fio ativo, isolar por loja, cortar idle, limitar o que vai à interpretação, expurgar no prazo.

**Definition of Done (merge):** no harness, depois de falar de um cliente, "manda a cobrança pra ele" resolve quem é "ele" (ou pede esclarecimento se ainda estiver ambíguo) **sem** a lojista repetir o nome; após 2 h sem mensagem, a mesma frase **não** aplica o cliente antigo em silêncio; loja B nunca lê nem herda o fio da loja A; no máximo 12 mensagens da conversa vigente entram no contexto enviado à interpretação; corpos com mais de 30 dias desaparecem no expurgo e o efeito de negócio permanece; o histórico sobrevive a reinício e é o mesmo nos dois harnesses.

## User Scenarios & Testing _(mandatory)_

Persona das jornadas de aceite: **Cláudia** (P1, papel `owner`) — o texto e os efeitos são os dela. Quem dispara as mensagens nesta fatia continua sendo **desenvolvedor do projeto** nos harnesses da NR-060/NR-121 (fixture), não a lojista em produção.

### User Story 1 - Resolver "ele" e "essa venda" no fio ativo (Priority: P1)

A Cláudia acaba de falar de um cliente — ou de uma venda. Na mensagem seguinte ela diz "manda a cobrança pra ele" ou "cancela essa". O assistente **já sabe** de quem se trata: não pede o nome de novo. Se a referência ainda puder ser duas pessoas ou duas vendas, ele pergunta qual, em vez de arriscar a errada.

**Why this priority**: é o coração da US-051 e do RF-105. Sem isso, cada turno recomeça do zero e a constitution ("nunca perguntar o que já se sabe") falha no canal principal.

**Independent Test**: dois turnos na mesma conversa ativa — primeiro ancora a entidade, o segundo usa só o pronome — e a intenção aponta para a mesma entidade; se houver dois candidatos, pede desambiguação e não executa a errada.

**Acceptance Scenarios** (US-051 · RF-105):

1. **Given** que a Cláudia acabou de identificar um cliente na conversa vigente, **When** diz "manda a cobrança pra ele" ainda no contexto ativo, **Then** o assistente trata "ele" como aquele cliente (e segue o portão de confirmação já existente, se a ação mexer em valor ou falar com terceiro).
2. **Given** que a mensagem anterior falou de uma venda concreta, **When** ela diz "essa" / "essa venda" ainda no contexto ativo, **Then** o assistente ancora naquela venda, sem pedir o identificador de novo.
3. **Given** dois clientes possíveis para o mesmo pronome no recorte ativo, **When** ela diz "ele", **Then** o assistente pede para escolher e **não** aplica um dos dois em silêncio.
4. **Given** um pedido em que o nome já vem na própria mensagem, **When** não há histórico, **Then** o laço continua funcionando como na NR-060 — contexto é acréscimo, não pré-requisito.

---

### User Story 2 - Uma loja não herda a conversa da outra (Priority: P1)

Duas empresas de fixture conversam em paralelo. A Cláudia da loja A falou do João. A loja B diz "manda a cobrança pra ele". O assistente da loja B **não** conhece o João da loja A. Tentativa de ler o histórico alheio falha como "não existe" — nunca como "existe e você não pode".

**Why this priority**: isolamento de tenant é ameaça existencial (constitution IV, RF-106). Histórico de conversa sem recorte por loja vira vazamento novo — pior do que número errado.

**Independent Test**: duas fixtures, dois fios; anáfora só resolve dentro da própria loja; leitura cruzada não devolve corpo nem entidade da outra.

**Acceptance Scenarios** (US-051 · RF-106):

1. **Given** loja A com cliente João no fio ativo e loja B sem esse cliente no próprio fio, **When** a loja B envia "manda a cobrança pra ele", **Then** o assistente **não** ancora no João da loja A — pede de novo ou trata como intenção sem âncora.
2. **Given** as duas lojas com fios ativos distintos, **When** cada uma consulta o próprio contexto, **Then** cada uma só vê o que foi dito na sua conversa.
3. **Given** qualquer tentativa de ler mensagens ou resolver referência da outra empresa, **When** o sistema responde, **Then** o resultado é ausência (não encontrado), nunca o texto nem a entidade alheia.

---

### User Story 3 - Depois de 2 horas, não aplicar o contexto antigo (Priority: P1)

A Cláudia falou do João, foi atender o balcão e só voltou **mais de 2 horas** depois. Manda "manda a cobrança pra ele". O assistente **não** assume que "ele" ainda é o João: pede de novo. Se ela continuar o fio na hora (minutos, não horas), a referência continua valendo.

**Why this priority**: RF-106 exige expirar contexto antigo antes de aplicá-lo a ação nova. Anáfora velha num caixa compartilhado lança cobrança na pessoa errada.

**Independent Test**: ancorar entidade, avançar o relógio **além de 2 h sem mensagem**, repetir a frase com pronome → não aplica a âncora antiga; repetir com relógio ainda dentro de 2 h → aplica.

**Acceptance Scenarios** (US-051 · RF-106):

1. **Given** uma conversa parada por mais de 2 horas, **When** a Cláudia volta e pede uma ação com referência ("ele", "essa venda"), **Then** o contexto antigo **não** é aplicado silenciosamente — o assistente pede de novo ou trata como intenção sem âncora.
2. **Given** a mesma âncora com menos de 2 horas desde a última mensagem, **When** ela usa o pronome, **Then** a referência resolve como na User Story 1.
3. **Given** o idle já cortou o contexto ativo, **When** ela identifica de novo o cliente na mensagem seguinte, **Then** as mensagens **depois** desse recomeço voltam a poder usar anáfora entre si (o corte não "envenena" o fio novo).
4. **Given** uma confirmação pendente da fatia de ação sensível, **When** passam 2 horas de conversa ociosa, **Then** essa pendência **não** ganha vida extra: continua com o prazo curto dela (minutos), independente do idle de contexto. Idle corta anáfora; não estende nem encurta o "sim".

---

### User Story 4 - Só o recorte recente vai à interpretação (Priority: P2)

A Cláudia conversou bastante. O assistente continua útil com o que acabou de ser dito, mas **não** despeja a conversa inteira no provedor de linguagem. Passado o teto, a âncora mais antiga pode cair — e aí o remédio é perguntar, não "lembrar tudo".

**Why this priority**: RNF-075 (mínimo ao modelo) e o teto numérico da ADR-0016. Sem teto, o canal vira vazamento contínuo de dado pessoal a subprocessador.

**Independent Test**: um fio com mais de 12 mensagens vigentes envia à interpretação no máximo as 12 mais recentes; referência que só existia nas mais antigas pede esclarecimento em vez de adivinhar.

**Acceptance Scenarios** (RF-105 · RNF-075):

1. **Given** uma conversa vigente com mais de 12 mensagens, **When** chega um turno novo ainda no contexto ativo, **Then** a interpretação usa no máximo as **12** mais recentes — o restante permanece na conversa até o expurgo, mas não viaja neste turno.
2. **Given** uma âncora que já saiu dessas 12, **When** a Cláudia usa só o pronome, **Then** o assistente pede de novo; MUST NOT aumentar o recorte "só dessa vez".
3. **Given** idle que já cortou o contexto ativo, **When** o turno novo é interpretado, **Then** as mensagens ociosas **não** entram como se ainda fossem contexto ativo (o recorte pode ser menor que 12).

---

### User Story 5 - Depois de 30 dias, o texto da conversa some (Priority: P2)

Passaram 30 dias. O texto daquelas mensagens **não** fica no banco. A venda que a Cláudia lançou naquele dia **continua** no negócio. Auditoria de efeito não depende do chat.

**Why this priority**: RNF-035 é MUST; a ADR-0016 tornou o prazo de 30 dias aceite desta tarefa. Sem expurgo, o histórico vira retenção indefinida de dado pessoal.

**Independent Test**: gravar mensagens, avançar o relógio além de 30 dias, rodar a rotina de expurgo → corpos desaparecem; registros de venda/cadastro da mesma época permanecem.

**Acceptance Scenarios** (US-051 · RNF-035):

1. **Given** mensagens com mais de 30 dias, **When** roda o expurgo, **Then** os corpos **não** permanecem armazenados.
2. **Given** uma conversa que ficou sem mensagens vigentes após o expurgo, **When** a rotina termina, **Then** essa conversa órfã também não permanece como histórico utilizável.
3. **Given** uma venda (ou cadastro, ou cobrança) feita naqueles dias, **When** o chat é expurgado, **Then** o efeito de negócio e a auditoria desse efeito **permanecem**.
4. **Given** o expurgo executado, **When** alguém tenta usar anáfora daquele texto antigo, **Then** não há âncora — o assistente pede de novo.

---

### User Story 6 - O fio sobrevive ao reinício e é o mesmo nos dois harnesses (Priority: P2)

A Cláudia falou do João no canal HTTP de teste. O serviço reinicia. No painel de engenharia, com a **mesma** loja e o **mesmo** interlocutor, ela diz "ele". O assistente ainda sabe. Não é memória de um processo só.

**Why this priority**: RF-105 falha entre deploys se o contexto for só volátil — o mesmo gap que a NR-060 deixou para confirmação, agora no histórico.

**Independent Test**: ancorar entidade, reiniciar o serviço do harness, usar o pronome no outro harness da mesma conversa → resolve; outra conversa (outro interlocutor) não herda.

**Acceptance Scenarios** (RF-105 · NR-121):

1. **Given** um fio ativo com âncora gravada, **When** o serviço que atende a conversa reinicia e chega uma referência ainda dentro do idle, **Then** a anáfora funciona como se o reinício não tivesse ocorrido.
2. **Given** a mesma loja e o mesmo interlocutor nos dois harnesses (HTTP e painel), **When** a âncora nasce num e a referência chega no outro ainda no contexto ativo, **Then** resolve — o fio é da conversa, não da janela do painel.
3. **Given** a mesma loja com **outro** interlocutor (outro número forjado), **When** usa "ele", **Then** **não** herda a âncora do primeiro fio.

---

### Edge Cases

- **Primeira mensagem da conversa**: sem histórico, o laço da NR-060 vale; ausência de contexto não é erro.
- **Pronome sem âncora no recorte ativo**: pede esclarecimento; MUST NOT inventar cliente, venda ou produto.
- **Vários candidatos no recorte ativo**: desambigua (o mesmo viés de "não arriscar a errada"); zero efeito de mutação até a escolha.
- **Pedido novo que já traz o nome**: usa o que veio na mensagem; o histórico não sobrescreve um identificador explícito e conflitante — em dúvida, pergunta.
- **Idle e confirmação pendente**: prazos independentes. Confirmação continua com o TTL curto dela (5 minutos na fatia de ação sensível). Idle de 2 h corta anáfora, não o "sim".
- **Mais de 12 mensagens**: as mais antigas saem do recorte enviado à interpretação; continuam armazenadas até os 30 dias.
- **Diálogo longo demais para o teto**: o remédio é perguntar, não alargar o recorte.
- **Dois harnesses, mesmo interlocutor**: um fio. Dois interlocutores na mesma loja: dois fios.
- **Loja B lendo loja A**: ausência, nunca o corpo.
- **Reinício no meio do turno**: a mensagem de entrada e a resposta visível que já foram gravadas permanecem; o turno não "relembra" texto que não chegou a ser persistido.
- **Teto de consumo de IA estourado**: degradação já da NR-060; o histórico não é desculpa para mandar o fio inteiro "na última tentativa".
- **Dado pessoal em log**: corpo de mensagem MUST NOT aparecer em log (RNF-034).
- **WhatsApp de produção / celular real do owner**: fora (NR-113/NR-046). O contrato do harness (número forjado + fixture) é o substituto.
- **Recall semântico / busca em conversas antigas para achar saldo**: fora (NR-120). Esta fatia é histórico de turnos do fio ativo, não recuperação auxiliar.
- **Preferências duráveis** ("a Cláudia sempre parcelar em 3×"): fora. Só turno recente.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: O sistema MUST manter o histórico recente da conversa vigente o bastante para resolver referências ("ele", "essa venda") sem a lojista repetir o que já disse naquele fio. (RF-105, US-051)
- **FR-002**: O contexto MUST pertencer a **uma** loja e **uma** conversa (empresa + canal + interlocutor). Loja nenhuma MUST ler, alterar ou aplicar histórico de outra. Recurso de outro tenant MUST parecer inexistente. (RF-106, constitution IV)
- **FR-003**: Consulta e ação no fio ativo MUST poder usar entidades já resolvidas nos turnos recentes (cliente, venda, produto). MUST NOT perguntar de novo o que o recorte ativo já contém de forma inequívoca. (constitution — Produto)
- **FR-004**: Se a referência no recorte ativo for ambígua (dois ou mais candidatos) ou inexistente, o sistema MUST pedir esclarecimento e MUST NOT aplicar uma âncora em silêncio. (RF-105, RF-102 no viés)
- **FR-005**: Identificador explícito na mensagem atual MUST prevalecer sobre anáfora quando os dois conflitarem; em dúvida, o sistema MUST perguntar.
- **FR-006**: Sem mensagem por **2 horas**, a conversa MUST deixar de ser contexto ativo para anáfora: ação ou consulta nova MUST NOT aplicar silenciosamente "ele" / "essa venda" do trecho ocioso. O assistente MUST pedir de novo ou tratar como intenção sem âncora. (RF-106)
- **FR-007**: Mensagens **depois** de um recomeço explícito (a lojista identifica de novo a entidade) MUST poder usar anáfora entre si, mesmo que o trecho anterior tenha sido cortado pelo idle.
- **FR-008**: Na interpretação de cada turno da conversa vigente, o sistema MUST enviar no máximo as **últimas 12 mensagens** (ou menos, se o idle tiver cortado o contexto ativo). Corpo completo de histórico antigo MUST NOT viajar ao provedor de modelo. (RNF-075, ADR-0016)
- **FR-009**: Âncora que já saiu dessas 12 mensagens MUST ser tratada como ausente: o assistente pede de novo. MUST NOT alargar o recorte para "salvar" a anáfora.
- **FR-010**: O histórico da conversa MUST persistir de forma que sobreviva a reinício do serviço que atende a conversa, até o idle cortar o contexto ativo ou o expurgo apagar os corpos. (RF-105)
- **FR-011**: Os dois harnesses de engenharia (canal HTTP de teste da NR-060 e painel da NR-121) MUST compartilhar o mesmo fio quando forem a mesma loja, o mesmo canal e o mesmo interlocutor. (NR-121)
- **FR-012**: Interlocutores distintos na mesma loja MUST ter fios distintos. Anáfora MUST NOT atravessar de um interlocutor para outro.
- **FR-013**: Corpos de mensagem MUST ser expurgados **após 30 dias** por rotina verificável. Conversas que ficarem sem mensagens vigentes MUST deixar de ser histórico utilizável. (RNF-035, US-051)
- **FR-014**: Expurgar o chat MUST NOT apagar efeito de negócio nem auditoria desse efeito (venda, cadastro, cobrança e correlatos continuam nas tabelas de negócio).
- **FR-015**: A máquina de confirmação de ação sensível MUST permanecer independente deste contexto: idle de 2 h MUST NOT estender nem substituir o prazo curto do "sim". Esta fatia MUST NOT redesenhar aceite, recusa, ambiguidade nem os 5 minutos. (NR-061 / RF-103–104)
- **FR-016**: O contexto MUST ser do produto, no mesmo laço da conversa. Memory, Storage ou recall semântico do framework de agente MUST NOT substituir este histórico: não isolam por loja, não expiram em 2 h e não expurgam em 30 dias como o RF-106 / RNF-035 pedem. (ADR-0010, ADR-0016)
- **FR-017**: Esta fatia MUST NOT treinar modelo, guardar perfil de preferências duráveis, nem usar trecho de conversa como fonte de saldo, total ou preço. Números continuam vindo do mesmo caso de uso do aplicativo. (RF-101, constitution I)
- **FR-018**: Se a identidade da conversa (empresa + canal + interlocutor) já existir por causa da confirmação persistente, esta fatia MUST reutilizar esse fio para o histórico — MUST NOT criar um segundo cadastro da mesma conversa. Se ainda não existir, MUST criar o fio ao gravar o primeiro turno.
- **FR-019**: Teste automatizado MUST provar: (a) anáfora no fio ativo; (b) recusa de anáfora ambígua ou ociosa (> 2 h); (c) loja B não lê nem herda loja A; (d) teto de 12 mensagens no recorte enviado à interpretação; (e) corpos desaparecem após 30 dias no expurgo, com efeito de negócio intacto; (f) anáfora sobrevive a reinício na mesma conversa.
- **FR-020**: Corpo de mensagem MUST NOT aparecer em log. (RNF-034)
- **FR-021**: Relógio de idle e de retenção MUST ser o instante do contexto da mensagem (injetável nos testes), não o relógio do avaliador.

### Key Entities

- **Conversa da loja**: o fio daquele interlocutor naquele canal naquela empresa. É o dono do contexto. Duas lojas nunca compartilham conversa; dois interlocutores na mesma loja também não.
- **Turno / mensagem**: o que a lojista ou o assistente disseram naquele fio, com o momento em que foi dito. Pode carregar, junto do texto, as entidades já resolvidas naquele turno (cliente, venda, produto) — sem virar perfil permanente.
- **Contexto ativo**: o recorte recente da conversa vigente usado para anáfora — no máximo 12 mensagens, e somente enquanto não houver 2 horas sem mensagem.
- **Âncora**: a entidade (cliente, venda, produto, …) que um pronome ou demonstrativo pode retomar. Só vale dentro do contexto ativo daquela conversa.
- **Expurgo**: rotina que tira de circulação corpos com mais de 30 dias e conversas que sobrarem sem histórico vigente. Não é exclusão do negócio.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Em 100% dos testes em que a entidade foi ancorada no fio ativo (idle < 2 h, recorte recente), a mensagem seguinte com pronome inequívoco resolve a mesma entidade — sem a lojista repetir o nome.
- **SC-002**: Em 100% dos testes com pronome ambíguo, ocioso (> 2 h) ou sem âncora, o assistente **não** aplica entidade em silêncio (pede de novo ou trata como intenção sem âncora); mutação da errada = zero.
- **SC-003**: Em 100% dos testes de isolamento, a loja B não lê, não herda e não aplica o fio da loja A (resultado = ausência, nunca o texto alheio).
- **SC-004**: Em 100% dos turnos verificados, o recorte enviado à interpretação tem no máximo 12 mensagens da conversa vigente; após idle, as mensagens ociosas não entram como contexto ativo.
- **SC-005**: Em 100% das execuções da rotina após 30 dias, os corpos daquelas mensagens não permanecem armazenados, e 100% dos efeitos de negócio do mesmo período permanecem.
- **SC-006**: Em 100% dos testes de reinício com fio ainda ativo, a anáfora posterior funciona **uma** vez como antes do reinício, inclusive quando a âncora nasceu no outro harness da mesma conversa.
- **SC-007**: Um desenvolvedor reproduz os cenários P1 desta spec nos **dois** harnesses (HTTP e painel) sem WhatsApp de produção e sem usuário final.

## Assumptions

- O laço de mensagem, o catálogo mínimo de capacidades e os harnesses (HTTP + painel) já foram entregues na NR-060 e na NR-121; esta fatia **não** redesenha interpretação de linguagem nem cria tools novas.
- Números da ADR-0016 são o default desta fatia, na ausência de outro valor nos catálogos de RF: **12** mensagens no recorte ativo, **2 horas** de idle, **30 dias** de retenção dos corpos.
- Canal de demonstração continua sendo **somente desenvolvedor** (fixture), como na NR-060/NR-121. WhatsApp de produção não entra. A chave do fio no harness é a mesma disciplina de canal conversacional já usada (empresa + canal + número forjado).
- NR-061 (confirmação persistente) **não** é dependência de merge desta tarefa no ledger. Se a identidade da conversa já existir, o histórico entra nesse fio. Se não existir, esta fatia cria o fio ao gravar turnos. Confirmação continua com TTL próprio (5 minutos no runtime atual).
- Persistência do histórico usa o isolamento por loja já existente no banco de negócio. O lugar das conversas e mensagens já está no catálogo; esta fatia **passa a usá-lo** de verdade (anáfora, idle, teto, expurgo) — não inventa um segundo depósito.
- Memory / Storage / recall semântico do framework de agente **não** atendem RF-105/106: tabelas sem recorte por loja, sem idle de 2 h e sem expurgo de 30 dias nossos. O modelo só interpreta o recorte que **nós** montamos.
- Relógio e data entram como parâmetro do contexto (constitution V); testes de idle e de retenção não dependem de `sleep` real de 2 horas ou 30 dias.
- Entidades já resolvidas no turno (ids de cliente, venda, produto) podem ir junto da mensagem como metadado daquele turno. Isso **não** é perfil de preferências.
- Exportação LGPD do histórico de conversa não é DoD desta fatia (NR-031/086 já existem). Isolamento por loja e expurgo de 30 dias **são** DoD.
- Provedor falso nos testes unitários pode continuar sem histórico real; os testes de contrato desta fatia é que cobrem anáfora, idle, isolamento e expurgo.
- Janela de 12 mensagens pode perder âncora em diálogos longos; isso é aceito. O remédio é pedir esclarecimento (ADR-0016), não aumentar o recorte.
- Idle de 2 h é escolha sem medição de uso real (ADR-0016); alterar o número reabre a ADR, não esta spec por conta própria.

## Dependencies & Out of Scope

**Dependências:** NR-060 ✅ (runtime + laço de mensagem); NR-121 ✅ (harness Studio no mesmo laço); casos de uso de `core` já usados pelas tools; schema de negócio já contém o lugar da conversa isolada por loja.

**Fora de escopo explícito:** redesenhar a máquina de confirmação (NR-061), NR-115–120, NR-113, NR-046, Memory/Storage/recall semântico do framework como memória da loja, RAG como fonte de valor, perfil de preferências, treino de modelo com conversa, qualquer cálculo monetário no caminho do modelo, e o canal do lojista em produção.
