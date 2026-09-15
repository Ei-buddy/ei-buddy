<!--
SYNC IMPACT REPORT
- Version change: 1.0.0 → 1.0.1
- Modified principles: none
- Added sections: none
- Removed sections: none
- Follow-up TODOs: none. DEC-001 fechou (ADR-0011): produto EiBuddy,
  domínio eibuddy.com.br; pacotes permanecem @na-regua/*.
-->

# EiBuddy Constitution

Governança do repositório `na-regua`. O produto se chama **EiBuddy**
([ADR-0011](../../docs/decisoes/adr/0011-eibuddy-nome-e-dominio.md)); o
domínio público é **eibuddy.com.br**. Os pacotes permanecem `@na-regua/*`,
atrelados ao repositório — trocar a marca MUST NOT exigir rename de
workspace.

Esta constitution extrai as regras **não negociáveis** de `docs/`. Detalhe
operacional, ADRs, RNFs e o ledger continuam sendo a fonte da verdade
especializada; em conflito de prazo ou conveniência, este documento prevalece.

## Core Principles

### I. Um núcleo, dois canais

App e WhatsApp MUST acionar os **mesmos** casos de uso, com as mesmas
validações, os mesmos cálculos e a mesma trilha de auditoria. Não existe regra
de negócio duplicada entre canais.

- Todo caso de uso MUST viver em `packages/core`. Um handler HTTP, uma tool do
  agente ou um job MUST fazer só três coisas: validar a entrada com
  `contracts`, montar o `ExecutionContext` e chamar o caso de uso.
- `core` MUST NOT saber de qual canal veio a requisição além do campo
  `channel` no contexto (`app` | `whatsapp` | `api` | `job`).
- `apps/*` MUST NOT importar `packages/domain`. Cálculo chamado direto pelo
  cliente é cálculo que o outro canal não faz igual.
- Autorização por papel MUST ser verificada em `core`, nunca só no handler.
  Se a checagem ficar na rota HTTP, o WhatsApp não a aplica.
- Toda funcionalidade nova MUST responder: como isso é acionado por mensagem?
  Recorte de cobertura do assistente no MVP está em
  [`escopo-mvp.md`](../../docs/produto/escopo-mvp.md).

**Rationale:** o diferencial do produto não é ter chatbot; é a equivalência
estrutural entre canais. Sem este princípio, os caminhos divergem e o lojista
descobre no caixa.

**Verificação:** revisão de PR (caso de uso fora de `core`);
`pnpm boundaries`; testes de contrato HTTP e de tools do agente sobre o mesmo
schema.

### II. Hexágono e fronteiras verificáveis

As setas apontam para dentro. Nada no núcleo conhece o que está fora dele. A
matriz de imports em [`principios.md`](../../docs/arquitetura/principios.md)
é a fonte da verdade; `dependency-cruiser` a traduz em código (RNF-065).

Quatro proibições:

1. Nenhum handler importa `packages/db`. Só a raiz de composição
   (`composition.ts`) instancia banco e adapters e os injeta em `core`.
2. `apps/*` não importa `packages/domain`.
3. `packages/domain` não importa nada com I/O, framework, relógio ou rede
   (RNF-066). Data e aleatoriedade entram como parâmetro.
4. Adapter (`fiscal`, `whatsapp`, `banking`, `billing`, `payments`) não
   importa `packages/core` como runtime — só implementa portas que `core`
   declara.

Regras correlatas:

- `packages/contracts` é o contrato único: um schema Zod por operação, usado
  na validação HTTP, nos tipos TypeScript e nas tools do agente. Mudança em
  `contracts` MUST ser revisada pelas **três trilhas**.
- Provedor externo MUST ser trocável alterando apenas o adapter, sem tocar em
  `core` ou `domain` (RNF-067). Porta e testes com adapter falso MUST poder
  existir antes da escolha do fornecedor.
- Nenhuma rota chega à lógica de negócio sem schema Zod (RNF-027).
- Exceção de fronteira MUST NOT ser feita por prazo. O caminho é `DEC` →
  discussão das três trilhas → ADR, atualizando matriz **e** CI no mesmo PR.
  Uma exceção que não está na matriz é violação.

**Nunca** desative `pnpm boundaries` para destravar um PR.

**Rationale:** disciplina individual não sustenta a equivalência entre canais.
Basta um handler consultar o banco uma vez, com pressa, e a regra passa a
existir só naquela rota.

**Verificação:** `pnpm boundaries` bloqueia o merge; revisão humana pega
lógica que deveria estar em `core` e ficou no handler.

### III. Integridade financeira

Dinheiro, estoque e obrigação fiscal não admitem versão parcial.

- Todo valor monetário MUST ser `Money` (inteiro em centavos). Ponto
  flutuante em dinheiro é proibido (RNF-044). Soma de parcelas MUST ser
  exatamente o total (RNF-045).
- Venda, baixa de estoque e criação de recebível MUST ocorrer na mesma
  transação. Quem abre e fecha a transação é o caso de uso, nunca o
  repositório (RNF-046).
- Escrita que envolve valor MUST ser idempotente por chave de idempotência
  (RNF-043). Reenvio de PDV com rede instável MUST NOT duplicar venda.
- Venda registrada MUST NOT ser apagada: correção é cancelamento ou
  devolução (RNF-040). Auditoria de dado de negócio é somente-inserção
  (RNF-047).
- Emissão fiscal MUST NOT bloquear o fechamento da venda; roda de forma
  assíncrona (RNF-004). XML de nota MUST ser guardado pelo prazo legal
  (RNF-037).
- Cálculo de custo, imposto e tarifa de cartão MUST acontecer no fechamento
  da venda, em `domain`, sem intervenção do operador. Sem esse cálculo o
  produto é um caderno digital.

**Rationale:** o lojista precisa poder desfazer sem medo, e o caixa precisa
fechar até o centavo. Float, estado parcial e delete de venda destroem as
duas coisas.

**Verificação:** lint de `Money`; testes de propriedade em `money` e
`domain`; teste de falha no meio da transação em `core`; ausência de
`DELETE` em vendas.

### IV. Isolamento de tenant no banco

Uma loja enxergar dados de outra é a ameaça existencial (T1). Isolamento
MUST ser imposto pelo PostgreSQL via RLS, não pela disciplina da aplicação
(RNF-021, [ADR-0001](../../docs/decisoes/adr/0001-rls-por-linha.md)).

- Toda tabela de negócio MUST ter `company_id NOT NULL` e política RLS com
  `FORCE ROW LEVEL SECURITY`.
- `companyId` MUST ser resolvido da autenticação e injetado no
  `ExecutionContext`. Nenhum endpoint aceita `companyId` no corpo ou na
  query.
- Consulta sem `app.company_id` de sessão MUST falhar (RF-121). Falhar é
  melhor que retornar tudo.
- Recurso de outro tenant MUST responder **404**, nunca 403.
- Teste automatizado na CI MUST tentar ler dado de outro `company_id` e
  falhar. Sem esse teste, "temos RLS" é fé.
- `platform_admin` MUST NOT acessar dado de tenant sem registro auditado
  (RF-131, RNF-030).

**Rationale:** filtro só na aplicação é a opção que acontece por omissão, e
é a única inaceitável. Um `WHERE` esquecido vaza dados entre lojas e encerra
o produto.

**Verificação:** testes de isolamento em `core`/`db` contra Postgres real;
teste por rota de que `companyId` do cliente é ignorado.

### V. Teste que prova comportamento

Teste existe para mudar código sem medo. Teste que só verifica que uma
função foi chamada MUST NOT ser aceito: quebra no refactor e passa com o
comportamento errado.

- `domain` e `money` MUST ter cobertura ≥ 90%; `core` ≥ 70% (RNF-068). O
  piso vive no `vitest.config.ts` de cada pacote, não só na CI.
- Toda regra de negócio MUST ter teste unitário sem banco nem rede
  (RNF-069). Relógio e data MUST ser injetados.
- Integração de `core`, `db`, `api` e `worker` MUST rodar contra Postgres
  real. Banco fingido não prova transação, RLS, restrição nem concorrência.
- Regra financeira MUST incluir teste de propriedade (parcela, imposto,
  tarifa, rateio), não só exemplos escolhidos.
- Adapter real MUST NOT entrar na CI. A CI prova o contrato da porta com
  adapter falso e webhooks gravados; sandbox de provedor é agendado.
- E2E MUST ficar restrito ao caminho crítico. Suíte verde que prova mock é
  pior que suíte nenhuma.
- Dado de produção MUST NOT ser copiado para teste (RNF-034).

**Rationale:** portão que só existe no servidor é portão descoberto tarde;
teste que não dá coragem de refatorar só custa manutenção.

**Verificação:** `pnpm test` na máquina e na CI; cobertura abaixo do piso
barra o merge.

## Produto, Segurança e Integrações

### Produto

- Público-alvo do MVP: comércio varejista de pequeno porte no Brasil, com
  CNPJ, Simples Nacional. Fora do alvo: indústria, atacado complexo,
  múltiplas filiais.
- A conversa é a interface principal; o app existe para o que é melhor na
  tela (código de barras, relatório, fechamento).
- Consultar é livre. Criar, alterar ou apagar valor, e enviar mensagem a
  terceiro, MUST exigir confirmação explícita. Confirmação pendente expira;
  resposta ambígua conta como não.
- Nunca perguntar o que já se sabe (cadastro, histórico ou conversa).
- O lojista é dono dos dados: exportação completa MUST estar disponível
  (RNF-050). Sequestro de dados como retenção é proibido.
- O produto MUST NOT ser, no MVP: plataforma de atendimento ao cliente
  final, marketplace, sistema contábil ou instituição de pagamento.
- Item listado em "Fora do MVP" MUST NOT entrar por conveniência de sprint.
  Expansão de escopo MUST passar por atualização de
  [`escopo-mvp.md`](../../docs/produto/escopo-mvp.md) e do ledger.
- Funcionalidade que não atende o problema da
  [visão](../../docs/produto/visao.md) MUST NOT entrar no MVP.

### Segurança e privacidade

Controles detalhados em [`seguranca.md`](../../docs/arquitetura/seguranca.md).
Não negociáveis:

- Segredo MUST NOT entrar em código, log ou variável versionada (RNF-022).
  Varredura na CI é bloqueante.
- Senha MUST usar hash Argon2id ou bcrypt, nunca reversível (RNF-023).
  Falha de login MUST NOT revelar se o usuário existe (RF-120).
- Webhook de terceiro MUST verificar assinatura e rejeitar o restante
  (RNF-028).
- Dado pessoal MUST NOT aparecer em log (RNF-034). Mensagem a cliente
  final MUST exigir consentimento registrado (RNF-032).
- Certificado A1 MUST ficar cifrado em repouso, com chave separada do banco
  (RNF-024).
- Número de WhatsApp prova continuidade de conversa, não identidade forte.
  Confirmação no mesmo canal MUST NOT ser tratada como segundo fator
  ([ADR-0002](../../docs/decisoes/adr/0002-autenticacao-identidade-propria.md)).
  Vincular número, trocar conta de repasse, exportar ou
  anonimizar a base MUST exigir sessão do aplicativo (segundo canal).
- O operador da loja é o `owner`. Não há usuário `staff` neste recorte
  ([US-003](../../docs/produto/user-stories.md#us-003--convidar-equipe)).
  Autorização por papel continua em `core` (`owner`, `platform_admin`);
  ocultar custo/margem para `staff` MUST NOT ser tratado como entrega.

### Integrações e operação

- Timeout explícito e repetição com espera crescente em toda chamada a
  provedor externo (RNF-011). Indisponibilidade de um provedor MUST NOT
  derrubar o restante (RNF-010).
- Toda fila MUST ter fila de descarte visível e reprocessável (RNF-062).
- Log estruturado JSON com `requestId`, `companyId` e `userId` (RNF-058).
- Consumo de IA por empresa MUST ter teto configurável (RNF-073); custo de
  IA MUST permanecer ≤ 15% da mensalidade (RNF-072).
- Stack de referência: pnpm workspaces + Turborepo, Fastify, BullMQ,
  PostgreSQL + Drizzle com RLS, Zod, Expo, Next.js. Troca de peça MUST
  preservar as portas de `core`.

## Engenharia e Qualidade

### Trilhas e fluxo

Três trilhas por **camada**, não por funcionalidade: Núcleo & Dados;
Plataforma & Integrações; Clientes. Qualquer pessoa pode mexer em qualquer
módulo; o dono da trilha revisa.

- `main` MUST estar sempre pronta para deploy. Trunk-based; sem `develop`.
- Branch MUST seguir `<tipo>/NR-<n>-<slug>`, viver ≤ 2 dias e visar
  ≤ 400 linhas de diff. Sempre rebase da `main`, nunca merge da `main` para
  dentro da branch.
- Draft PR desde o primeiro push. Merge é **squash**, histórico linear.
  Urgência MUST NOT suspender revisão.
- Conventional Commits; título do PR é o commit da `main`. `Refs: NR-xxx`
  obrigatório. Idioma da descrição: PT-BR.
- Uma tarefa `Working on it` por pessoa.

### Definition of Ready

Uma tarefa só pode ser pega se:

- tem `US-xxx` ou `RF-xxx` vinculado;
- tem critério de aceite com **pelo menos um caminho de erro**;
- não tem `DEC-xxx` bloqueante, ou o escopo é a parte que não depende dela;
- dependências `NR-xxx` estão concluídas;
- cabe em ≤ 2 dias;
- módulo dono está definido.

### Definition of Done

Uma tarefa só vai para `Done` se:

- CI verde: formatação, fronteiras, tipos, lint, testes, build;
- PR aprovado e mergeado com squash;
- testes na camada certa, incluindo um caso de erro;
- README do módulo atualizado se o comportamento mudou;
- variável de ambiente nova em `docs/engenharia/ambientes.md` **e** no
  `.env.example`;
- decisão de arquitetura virou ADR ou `DEC`;
- [task ledger](../../docs/processo/task-ledger.md) atualizado no mesmo PR;
- nenhum `TODO` novo sem tarefa correspondente.

O ledger versionado é a fonte da verdade; o Monday é visualização. Divergiu,
o ledger ganha.

### Portões de CI

Merge MUST exigir: `format:check`, `boundaries`, `typecheck`, `lint`,
`test`, `build`; checagens de PR (título, branch, `NR-xxx`); auditoria de
dependência em severidade alta; varredura de segredos. Bypass de check
vermelho para "destravar" é violação desta constitution.

Revisão de PR MUST começar por: módulo certo → fronteira → caminho de
erro → `Money` → testes que provam algo. Estilo por último, e só o que o
Prettier não pega. Comentário de revisão MUST dizer por quê e propor
alternativa; `nit:` marca o que não bloqueia.

### Documentação e rastreabilidade

- História (`US-xxx`) → requisito (`RF-xxx` / `RNF-xxx`) → tarefa
  (`NR-xxx`) → branch → PR. IDs são permanentes; número queimado não se
  reaproveita.
- Prosa em PT-BR; identificadores, arquivos, tabelas, endpoints e variáveis
  em inglês. Um termo de negócio, um identificador — ver
  [`glossario.md`](../../docs/produto/glossario.md).
- Documento de módulo mora no `README.md` do pacote. `docs/` guarda só o
  transversal. Sem duplicação.
- Decisão aberta ≠ decisão tomada. O que não foi decidido vira `DEC-xxx` ou
  `QST-xxx`; o que foi decidido vira ADR. Decisão tomada em conversa e não
  registrada **não foi tomada**.
- Specs, plans e tasks do Spec Kit MUST citar os IDs de requisito afetados
  e MUST NOT contradizer esta constitution nem o recorte de MVP.

## Governance

Esta constitution prevalece sobre prazo, preferência pessoal e prática
ad hoc. Complexidade extra MUST ser justificada por requisito rastreável
(`RF`, `RNF` ou ADR). YAGNI: o que está em "Fora do MVP" não se implementa
"já que estamos aqui".

### Emenda

1. Abrir `DEC-xxx` em [`docs/decisoes/README.md`](../../docs/decisoes/README.md)
   com o custo de manter a regra atual.
2. Discutir com as três trilhas (e fundadores, se a mudança for de produto
   ou marca).
3. Se aceita: ADR em `docs/decisoes/adr/`, atualização desta constitution e
   da documentação afetada **no mesmo PR**.
4. PR de emenda MUST declarar o tipo de bump (MAJOR / MINOR / PATCH) e o
   impacto em specs Spec Kit em andamento.

Emenda MUST NOT ser feita só no código ou só num README de módulo.

### Versionamento

`CONSTITUTION_VERSION` segue SemVer:

| Bump  | Quando                                                                |
| ----- | --------------------------------------------------------------------- |
| MAJOR | Remoção ou redefinição incompatível de princípio                      |
| MINOR | Novo princípio ou seção, ou expansão material de regra existente      |
| PATCH | Esclarecimento, correção de texto, refinamentos sem mudança semântica |

`RATIFICATION_DATE` é a adoção original e não muda. `LAST_AMENDED_DATE` é
a data da última emenda.

### Conformidade

- Todo PR MUST ser revisado contra os princípios I–V e contra o DoD.
- Feature Spec Kit (`/speckit-specify`, `/speckit-plan`, `/speckit-tasks`,
  `/speckit-implement`) MUST aderir a esta constitution. Conflito MUST ser
  resolvido em favor da constitution, ou por emenda formal antes da
  implementação.
- Violação detectada em revisão MUST ser corrigida no mesmo PR ou virar
  tarefa `NR-xxx` explícita — nunca `TODO` solto.
- A revisão semanal de decisões (sexta, 15 min) é o ritual que impede
  decisão por omissão. Pular de forma reiterada é falha de governança, não
  de calendário.
- Guidance operacional: [`docs/README.md`](../../docs/README.md),
  [`docs/arquitetura/principios.md`](../../docs/arquitetura/principios.md),
  [`docs/engenharia/fluxo-de-trabalho.md`](../../docs/engenharia/fluxo-de-trabalho.md).

**Version**: 1.0.1 | **Ratified**: 2026-09-11 | **Last Amended**: 2026-09-11
