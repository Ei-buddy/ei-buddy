# Documentação — EiBuddy

Índice completo da documentação do projeto. Cada documento tem **um público e um
dono**; nenhum arquivo serve a dois públicos ao mesmo tempo.

## Como esta documentação é organizada

| Princípio                                | O que significa na prática                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documento de módulo mora junto do código | A arquitetura de cada módulo é o `README.md` do próprio `packages/<x>/` ou `apps/<x>/`, para ser revisada no mesmo PR que muda o código            |
| `docs/` guarda só o transversal          | Aqui fica o que atravessa módulos: contexto, fluxos, dados, segurança, processo                                                                    |
| Sem duplicação                           | [`arquitetura/modulos.md`](arquitetura/modulos.md) é uma tabela-índice que **aponta** para os READMEs de módulo, não os repete                     |
| Decisão aberta ≠ decisão tomada          | O que ainda está em aberto vive em [`decisoes/README.md`](decisoes/README.md); o que foi decidido vira uma ADR em [`decisoes/adr/`](decisoes/adr/) |
| Rastreabilidade por ID                   | História (`US-xxx`) → requisito (`RF-xxx` / `RNF-xxx`) → tarefa (`NR-xxx`) → branch → PR                                                           |

## Índice

### 📦 Produto — _o quê e para quem_

Público: todo o time, fundadores, stakeholders.

| Doc                                                                            | Conteúdo                                                                                      |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [`produto/visao.md`](produto/visao.md)                                         | Problema, público-alvo, proposta de valor, diferencial e métricas de sucesso                  |
| [`produto/personas.md`](produto/personas.md)                                   | Lojista (`owner`); funcionário fora do recorte; contador, cliente final e admin da plataforma |
| [`produto/user-stories.md`](produto/user-stories.md)                           | 13 épicos e 79 histórias com critérios de aceite em Gherkin                                   |
| [`produto/requisitos-funcionais.md`](produto/requisitos-funcionais.md)         | Catálogo `RF-xxx` rastreável a histórias e módulos                                            |
| [`produto/requisitos-nao-funcionais.md`](produto/requisitos-nao-funcionais.md) | Catálogo `RNF-xxx` com métricas verificáveis                                                  |
| [`produto/escopo-mvp.md`](produto/escopo-mvp.md)                               | O que entra e o que **não** entra no MVP, e o roadmap depois dele                             |
| [`produto/glossario.md`](produto/glossario.md)                                 | Linguagem ubíqua: termo de negócio PT-BR ↔ identificador em inglês                            |
| [`produto/wireframes.md`](produto/wireframes.md)                               | Wireframes das 9 telas de módulo, derivados da apresentação comercial                         |

### 🏛 Arquitetura — _como o sistema é construído_

Público: desenvolvedores.

| Doc                                                                      | Conteúdo                                                                     |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [`arquitetura/visao-geral.md`](arquitetura/visao-geral.md)               | Diagramas C4 de contexto e containers, e o raciocínio por trás deles         |
| [`arquitetura/principios.md`](arquitetura/principios.md)                 | Arquitetura hexagonal, regra de dependência e a matriz de imports permitidos |
| [`arquitetura/fluxos.md`](arquitetura/fluxos.md)                         | Diagramas de sequência dos fluxos críticos ponta a ponta                     |
| [`arquitetura/dados.md`](arquitetura/dados.md)                           | Modelo de dados, estratégia multi-tenant, RLS, migrations e auditoria        |
| [`arquitetura/esquema-postgresql.md`](arquitetura/esquema-postgresql.md) | Catálogo alvo com `company_integrations` (snapshot 2026-09-09)               |
| [`arquitetura/db_0909.sql`](arquitetura/db_0909.sql)                     | SQL documental desse catálogo — **não** é migration                          |
| [`arquitetura/seguranca.md`](arquitetura/seguranca.md)                   | Autenticação, autorização, gestão de segredos e conformidade com a LGPD      |
| [`arquitetura/modulos.md`](arquitetura/modulos.md)                       | Tabela-índice de todos os módulos, com fronteiras e donos                    |
| [`arquitetura/integracoes/`](arquitetura/integracoes/)                   | Avaliação e desenho de cada provedor externo — uma página por fornecedor     |
| [`arquitetura/integracoes/mastra.md`](arquitetura/integracoes/mastra.md) | Runtime do assistente: laço `processMessage`, Agent/tools, o que Factory não faz |

### 🔧 Engenharia — _como trabalhamos_

Público: desenvolvedores. **Leitura obrigatória antes do primeiro commit.**

| Doc                                                                  | Conteúdo                                                              |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`engenharia/setup.md`](engenharia/setup.md)                         | Do clone até rodar o projeto localmente                               |
| [`engenharia/git-workflow.md`](engenharia/git-workflow.md)           | Branching, Conventional Commits, PR, merge, tags e release            |
| [`engenharia/code-style.md`](engenharia/code-style.md)               | Formatação, lint, nomenclatura e verificação automática de fronteiras |
| [`engenharia/fluxo-de-trabalho.md`](engenharia/fluxo-de-trabalho.md) | Ciclo diário de uma tarefa, code review e ligação com o Monday        |
| [`engenharia/ambientes.md`](engenharia/ambientes.md)                 | Ambientes e matriz completa de variáveis de ambiente                  |
| [`engenharia/testes.md`](engenharia/testes.md)                       | Que tipo de teste escrever em cada camada, e o que não testar         |
| [`engenharia/ci-cd.md`](engenharia/ci-cd.md)                         | Pipelines do GitHub Actions, gates obrigatórios e deploy              |

### 📋 Processo — _quem faz o quê_

Público: time e gestão.

| Doc                                                        | Conteúdo                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| [`processo/task-ledger.md`](processo/task-ledger.md)       | Backlog completo dividido em 3 trilhas, com dependências |
| [`processo/monday-import.csv`](processo/monday-import.csv) | O mesmo ledger em CSV, pronto para importar no Monday    |
| [`processo/rituais.md`](processo/rituais.md)               | Cerimônias, Definition of Ready e Definition of Done     |

### ⚖️ Decisões — _o que ainda não sabemos_

Público: todo o time.

| Doc                                        | Conteúdo                                                         |
| ------------------------------------------ | ---------------------------------------------------------------- |
| [`decisoes/README.md`](decisoes/README.md) | Decisões pendentes (`DEC-xxx`) e perguntas em aberto (`QST-xxx`) |
| [`decisoes/adr/`](decisoes/adr/)           | Architecture Decision Records — decisões fechadas e imutáveis    |

### 📎 Material de origem

| Arquivo                                                                                                           | O que é                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [`assets/ZapGestor_Apresentacao.pdf`](assets/ZapGestor_Apresentacao.pdf) · [md](assets/zapgestor-apresentacao.md) | Apresentação comercial — fonte primária do escopo de produto                                                                                 |
| [`assets/PagMaxx-Documentacao-da-API.pdf`](assets/PagMaxx-Documentacao-da-API.pdf) · [md](assets/pagmaxx-api.md)  | Documentação da API do PSP — avaliada em [`integracoes/pagmaxx.md`](arquitetura/integracoes/pagmaxx.md)                                      |
| [`assets/Pro Comércio KV Rebranding.pdf`](assets/) · [md](assets/pro-comercio-rebranding.md)                      | Identidade visual ProComércio — paleta provisória em `packages/ui`. Nome do produto: [ADR-0011](decisoes/adr/0011-eibuddy-nome-e-dominio.md) |

Os `.md` ao lado de cada PDF são conversões geradas por
`scripts/pdf_to_md.py <entrada.pdf> <saida.md>` (requer `pypdf`). São **fonte
bruta**, não documentação: extraem texto sem layout. A leitura curada de cada um
está no documento que o referencia.

## Convenções de escrita

- **Idioma:** português (PT-BR) na prosa; **inglês** em todo identificador de
  código, nome de arquivo, variável de ambiente, tabela e endpoint citados.
- **IDs são permanentes.** Um `RF-012` nunca é renumerado nem reaproveitado; se
  o requisito morre, vira `Cancelado` e o número fica queimado.
- **Diagramas em Mermaid**, dentro do próprio Markdown — nada de imagem exportada
  que envelhece separada do texto.
- **Sem futuro incerto.** Se algo ainda não foi decidido, não se escreve como se
  já fosse: abre-se um `DEC-xxx` e referencia-se ele.

## Manutenção

| Quando                                   | O que atualizar                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| PR que muda o comportamento de um módulo | O `README.md` daquele módulo                                                                                     |
| PR que muda uma fronteira entre módulos  | [`arquitetura/principios.md`](arquitetura/principios.md) e/ou [`arquitetura/modulos.md`](arquitetura/modulos.md) |
| PR que adiciona variável de ambiente     | [`engenharia/ambientes.md`](engenharia/ambientes.md) e o `.env.example`                                          |
| Decisão de arquitetura tomada            | Nova ADR em [`decisoes/adr/`](decisoes/adr/) e baixa do `DEC-xxx` correspondente                                 |
| Requisito novo ou alterado               | [`requisitos-funcionais.md`](produto/requisitos-funcionais.md) e a história de origem                            |

O checklist do template de PR cobre esses itens — ver
[`engenharia/git-workflow.md`](engenharia/git-workflow.md#pull-requests).
