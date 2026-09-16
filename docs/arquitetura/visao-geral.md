# Arquitetura — visão geral

Diagramas [C4](https://c4model.com/) de nível 1 (contexto) e 2 (containers). O
nível 3 (componentes) vive no README de cada módulo — ver
[`modulos.md`](modulos.md).

As regras que sustentam esta arquitetura estão em
[`principios.md`](principios.md). Este documento mostra **o quê**; aquele
explica **por quê**.

---

## Nível 1 — Contexto

Quem usa o sistema e com que sistemas externos ele fala.

```mermaid
flowchart TB
    LOJISTA(["👤 Lojista<br/><i>dona da loja</i>"])
    FUNC(["👤 Funcionário<br/><i>balcão</i>"])
    CLIENTE(["👤 Cliente final<br/><i>compra na loja</i>"])
    ADMIN(["👤 Admin da plataforma"])

    SYS["<b>EiBuddy</b><br/>ERP operável por app<br/>e por WhatsApp"]

    SEFAZ["🏛 SEFAZ<br/><i>autorização de NFC-e/NFS-e</i>"]
    META["💬 Provedor WhatsApp<br/><i>envio e recebimento</i>"]
    OF["🏦 Open Finance<br/><i>extrato bancário</i>"]
    PSP["💳 PSP / Adquirente<br/><i>tarifas e repasses</i>"]
    LLM["🤖 OpenAI<br/><i>gpt-4o-mini via Mastra</i>"]
    SAAS["💰 Cobrança SaaS<br/><i>mensalidade</i>"]

    LOJISTA -->|app e WhatsApp| SYS
    FUNC -->|app| SYS
    ADMIN -->|backoffice| SYS
    SYS -->|cobrança, comprovante, nota| CLIENTE

    SYS <-->|emite e cancela nota| SEFAZ
    SYS <-->|mensagens| META
    SYS <-->|consulta extrato| OF
    SYS <-->|tarifas e conciliação| PSP
    SYS <-->|interpreta intenção| LLM
    SYS <-->|assinatura| SAAS
```

**Seis integrações externas, cada uma atrás de um adapter.** Fiscal (Focus NFe),
PSP/mensalidade (Asaas), LLM (Mastra + `gpt-4o-mini`,
[ADR-0010](../decisoes/adr/0010-mastra-e-gpt-4o-mini.md)) e WhatsApp
([ADR-0014](../decisoes/adr/0014-meta-cloud-api.md), Meta Cloud API) já
fecharam. Open Finance ([DEC-005](../decisoes/README.md#dec-005)) continua
aberto. O trabalho de `core` e `domain` não espera essa decisão.

## Nível 2 — Containers

```mermaid
flowchart TB
    subgraph clientes["Clientes"]
        MOBILE["📱 <b>apps/mobile</b><br/>Expo / React Native<br/><i>PDV, código de barras</i>"]
        WEBAPP["🖥 <b>apps/web</b><br/>Next.js<br/><i>backoffice, catálogo, landing</i>"]
        WPP["💬 WhatsApp<br/><i>conversa do lojista</i>"]
    end

    subgraph backend["Backend"]
        API["⚙️ <b>apps/api</b><br/>Fastify<br/><i>REST + webhooks + runtime do agente</i>"]
        WORKER["🔁 <b>apps/worker</b><br/>BullMQ<br/><i>filas e jobs agendados</i>"]
    end

    subgraph logica["Lógica compartilhada"]
        CORE["<b>packages/core</b> — casos de uso"]
        DOMAIN["<b>packages/domain</b> — regras puras"]
        AGENT["<b>packages/agent</b> — tools e confirmações"]
        CONTRACTS["<b>packages/contracts</b> — schemas Zod"]
    end

    subgraph dados["Dados"]
        PG[("🐘 PostgreSQL<br/><i>dados de negócio + RLS</i>")]
        REDIS[("⚡ Redis<br/><i>filas e cache</i>")]
        BLOB[("📦 Object storage<br/><i>XMLs, anexos, exportações</i>")]
    end

    subgraph externos["Provedores externos"]
        EXT["fiscal · whatsapp · banking<br/>billing · LLM"]
    end

    MOBILE -->|HTTPS| API
    WEBAPP -->|HTTPS| API
    WPP -->|webhook| API
    API -->|mensagem| WPP

    API --> CORE
    API --> AGENT
    WORKER --> CORE
    AGENT --> CORE
    CORE --> DOMAIN
    API -.->|valida| CONTRACTS
    AGENT -.->|gera tools| CONTRACTS

    API -->|enfileira| REDIS
    WORKER -->|consome| REDIS
    CORE --> PG
    CORE --> BLOB
    CORE -.->|via portas| EXT
    WORKER -.->|via portas| EXT
```

### Por que estes containers

| Container      | Existe porque                                                                                                                    | Alternativa descartada                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `apps/api`     | Um único ponto de entrada para app, web e webhooks, com autenticação e contexto de tenant em um lugar só                         | Um serviço por domínio — complexidade de operação que 3 devs e zero clientes não pagam |
| `apps/worker`  | Emissão fiscal não pode bloquear a venda ([RNF-004](../produto/requisitos-nao-funcionais.md)); cobrança e lembrete são agendados | Fazer tudo síncrono na API — quebra RNF-003 e RNF-004                                  |
| `apps/mobile`  | O PDV é no balcão, com código de barras e rede instável ([RNF-051](../produto/requisitos-nao-funcionais.md))                     | Web responsiva — não resolve leitor nativo nem operação offline                        |
| `apps/web`     | Backoffice, relatório e conciliação são trabalho de tela grande                                                                  | Só mobile — conciliar extrato no celular é hostil                                      |
| PostgreSQL     | Dado financeiro exige transação e integridade; RLS dá isolamento no banco ([RNF-021](../produto/requisitos-nao-funcionais.md))   | NoSQL — sem transação multi-tabela, a atomicidade de RNF-046 vira código de aplicação  |
| Redis          | Fila para emissão, mensagens e jobs; cache de leitura quente                                                                     | Fila no próprio Postgres — viável, mas piora o pico de mensagens de RNF-018            |
| Object storage | XML fiscal por 5 anos ([RNF-037](../produto/requisitos-nao-funcionais.md)), anexos e exportações                                 | Guardar no banco — caro e pesado para backup                                           |

### O runtime do agente mora na API

O `packages/agent` roda **dentro** de `apps/api`, não como serviço separado.
O Mastra entra só como biblioteca (`Agent` + `createTool`); `processMessage`
é o dono do laço (confirmação, execução em `core`). Não há Workflow nem
Factory no caminho do lojista. **Studio** é harness de engenharia
([NR-121](../processo/task-ledger.md)), não canal de produção — ver
[`integracoes/mastra.md`](integracoes/mastra.md).

Motivo: o agente precisa do mesmo contexto de execução, da mesma autenticação e
das mesmas portas de `core` que uma requisição HTTP. Separá-lo criaria uma
segunda composição de dependências — e é assim que os dois canais começam a
divergir, que é exatamente o que a arquitetura existe para impedir.

Quando o volume justificar processo separado, o `agent` já é um pacote isolado:
a mudança é de empacotamento, não de código de negócio.

## Fluxo de uma requisição

Os dois canais convergem no mesmo caso de uso:

```mermaid
flowchart LR
    subgraph app["Canal app"]
        A1["POST /v1/sales"] --> A2["valida<br/>contracts"] --> A3["monta<br/>ExecutionContext"]
    end
    subgraph wpp["Canal WhatsApp"]
        W1["webhook"] --> W2["agent interpreta"] --> W3["confirmação<br/>do usuário"] --> W4["monta<br/>ExecutionContext"]
    end
    A3 --> UC["<b>core.registerSale()</b>"]
    W4 --> UC
    UC --> D["domain: calcula<br/>custo, imposto, tarifa"]
    UC --> DB[("db: venda + estoque<br/>+ recebível + auditoria<br/><i>uma transação</i>")]
    UC --> Q["fila: emitir nota"]
```

A diferença entre os canais termina em `ExecutionContext` — `channel: 'app'` ou
`channel: 'whatsapp'`. Daí para frente é o mesmo código, inclusive as
validações e a auditoria.

## Decisões estruturais tomadas

| Decisão                | Escolha                    | Por quê                                                                                                                                                        |
| ---------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organização do código  | Monorepo                   | Contrato compartilhado entre 4 apps; mudança em `contracts` precisa ser atômica                                                                                |
| Gerenciador de pacotes | pnpm + Turborepo           | Cache de tarefas e execução por pacote afetado; `node-linker=hoisted` por causa do Metro/Expo                                                                  |
| Linguagem              | TypeScript em todo o stack | Um tipo de venda compartilhado entre backend, app e agente                                                                                                     |
| Estilo de API          | REST                       | Público e superfície pequenos; GraphQL não se paga aqui                                                                                                        |
| ORM                    | Drizzle                    | SQL explícito e tipado, essencial para trabalhar com RLS sem surpresa                                                                                          |
| Isolamento             | RLS no PostgreSQL          | Isolamento que não depende de o desenvolvedor lembrar do `WHERE` — [ADR-0001](../decisoes/adr/0001-rls-por-linha.md)                                           |
| Validação              | Zod em `contracts`         | O mesmo schema serve a HTTP, tipos e tools do agente                                                                                                           |
| Runtime do agente      | Mastra + `gpt-4o-mini`     | Tools em Zod; RAG auxiliar com store nosso — [ADR-0010](../decisoes/adr/0010-mastra-e-gpt-4o-mini.md), [ADR-0017](../decisoes/adr/0017-rag-com-tools-e-rls.md) |
| Recuperação (RAG)      | Store nosso + RLS          | Chunk não é saldo/total — [ADR-0017](../decisoes/adr/0017-rag-com-tools-e-rls.md)                                                                              |
| Memória da conversa    | Tabelas nossas + RLS       | Sem Memory Mastra; 12 msgs / 2 h idle / 30 dias — [ADR-0016](../decisoes/adr/0016-memoria-da-conversa-tabelas-nossas.md)                                       |
| WhatsApp               | Meta Cloud API             | Um WABA da plataforma — [ADR-0014](../decisoes/adr/0014-meta-cloud-api.md)                                                                                     |
| Hospedagem             | VPS + Docker Compose       | A VM que já roda — [ADR-0015](../decisoes/adr/0015-vps-docker-compose.md)                                                                                      |

## Decisões estruturais ainda em aberto

Estas **não** estão decididas e não devem ser assumidas em código:

| Tema         | Decisão                                  | Impacto se decidida errado            |
| ------------ | ---------------------------------------- | ------------------------------------- |
| Open Finance | [DEC-005](../decisoes/README.md#dec-005) | Extrato ao vivo vs. só OFX/CSV no MVP |

Memória da conversa fechou — [ADR-0016](../decisoes/adr/0016-memoria-da-conversa-tabelas-nossas.md).

## Documentos relacionados

- [Princípios](principios.md) — as regras que estruturam tudo isso
- [Fluxos](fluxos.md) — as sequências detalhadas
- [Dados](dados.md) — modelo, multi-tenant e RLS
- [Segurança](seguranca.md) — autenticação, autorização e LGPD
- [Módulos](modulos.md) — o detalhe de cada caixa destes diagramas
