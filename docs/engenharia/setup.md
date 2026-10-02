# Setup do ambiente

Do clone até `pnpm dev` rodando. **Alvo: 10 minutos.**

Se algum passo aqui falhar ou demorar mais que isso, é bug de onboarding —
abra uma tarefa. [RNF-070](../produto/requisitos-nao-funcionais.md) exige que o
ambiente local suba com um comando e **sem nenhuma credencial de produção**.

---

## Pré-requisitos

| Ferramenta | Versão           | Como instalar                                                |
| ---------- | ---------------- | ------------------------------------------------------------ |
| Node.js    | ≥ 22 (usamos 24) | `nvm install` — lê o [`.nvmrc`](../../.nvmrc)                |
| pnpm       | ≥ 11             | `corepack enable && corepack prepare pnpm@11.7.0 --activate` |
| Docker     | qualquer recente | Docker Desktop ou OrbStack                                   |
| Git        | qualquer recente | —                                                            |

Nada de Postgres ou Redis instalados na máquina: os dois sobem em container.

## Passo a passo

```bash
git clone <url> na-regua && cd na-regua
pnpm install
pnpm setup
```

O `pnpm setup` faz três coisas e diz o que fez:

1. Copia [`.env.example`](../../.env.example) para `.env` (não sobrescreve um existente)
2. Sobe Postgres e Redis e **espera ficarem saudáveis**
3. Imprime os próximos comandos

Depois:

```bash
pnpm dev
```

| Serviço  | Onde                  | O quê                             |
| -------- | --------------------- | --------------------------------- |
| api      | http://localhost:3333 | REST, webhooks, runtime do agente |
| web      | http://localhost:3000 | backoffice, catálogo, landing     |
| worker   | —                     | consome as filas                  |
| Postgres | `localhost:5432`      | usuário/senha/base: `naregua`     |
| Redis    | `localhost:6379`      | —                                 |

Confira que subiu inteiro:

```bash
curl -s localhost:3333/health | jq
```

```json
{
  "status": "ok",
  "uptimeSeconds": 8,
  "checks": {
    "database": { "ok": true, "latencyMs": 24, "version": "PostgreSQL 17.11" },
    "redis": { "ok": true, "latencyMs": 11 }
  }
}
```

`/health` responde **503** se qualquer dependência estiver fora. Health check
que sempre devolve 200 não serve para nada.

## O aplicativo mobile

```bash
pnpm --filter @na-regua/mobile dev
```

Abre o Expo; leia o QR Code com o app **Expo Go**, ou tecle `i` (simulador iOS)
ou `a` (emulador Android).

> [!NOTE]
> O [`.npmrc`](../../.npmrc) fixa `node-linker=hoisted`. Isso **não é
> preferência**: o Metro, empacotador do Expo, não resolve o store simbólico do
> pnpm, e sem essa linha o app quebra ao importar qualquer pacote do workspace.
> Não remova.

## Comandos

### Dia a dia

| Comando                           | O quê                                               |
| --------------------------------- | --------------------------------------------------- |
| `pnpm dev`                        | sobe tudo                                           |
| `pnpm --filter @na-regua/api dev` | sobe só um app                                      |
| `pnpm test`                       | testes dos pacotes afetados                         |
| `pnpm typecheck`                  | checagem de tipos do monorepo                       |
| `pnpm lint`                       | lint                                                |
| `pnpm format`                     | formata com Prettier                                |
| `pnpm boundaries`                 | **verifica a matriz de dependências** entre módulos |

### Infraestrutura

| Comando            | O quê                                              |
| ------------------ | -------------------------------------------------- |
| `pnpm infra:up`    | sobe Postgres e Redis, esperando ficarem saudáveis |
| `pnpm infra:down`  | para (mantém os dados)                             |
| `pnpm infra:reset` | **apaga os volumes** e sobe do zero                |
| `pnpm infra:logs`  | acompanha os logs                                  |
| `pnpm infra:ps`    | estado dos containers                              |
| `pnpm infra:psql`  | abre o `psql` no banco local                       |
| `pnpm infra:redis` | abre o `redis-cli`                                 |

O baseline de schema é 0001–0007 (ADR-0006). Volume local que ainda tem
`schema_migrations` 0001–0025 **não aplica**: o runner recusa checksum/versão
que não existem mais. Depois de puxar o catálogo 0909, todo o time roda
`pnpm infra:reset` e `pnpm db:migrate`.

### Serviços opcionais

O perfil `full` adiciona object storage e servidor de e-mail locais:

```bash
docker compose -f infra/docker-compose.yml --profile full up -d
```

| Serviço | Onde                  | Para quê                                    |
| ------- | --------------------- | ------------------------------------------- |
| MinIO   | http://localhost:9001 | XMLs fiscais, anexos, exportações           |
| Mailpit | http://localhost:8025 | ver e-mails enviados, sem mandar de verdade |

## Provedores externos em desenvolvimento

Todos os adapters sobem em **modo falso** até haver credencial. LLM já tem
provedor escolhido ([ADR-0010](../decisoes/adr/0010-mastra-e-gpt-4o-mini.md));
WhatsApp e Open Finance ainda não. O falso vale para todos:

```bash
PAYMENTS_PROVIDER=fake
WHATSAPP_PROVIDER=fake
FISCAL_PROVIDER=fake
BANKING_PROVIDER=fake
```

**O sistema sobe e funciona localmente sem nenhuma credencial.** Isso é
deliberado: nenhum desenvolvedor precisa de conta em fornecedor para trabalhar,
e ninguém tem motivo para colocar credencial de produção na máquina. O
assistente é a exceção de rota: `OPENAI_API_KEY` é opcional no parse e só
é necessária para o harness montar. Sem ela a API escuta e
`POST /agent/messages` responde 503.

### Testar webhook local

Os provedores exigem URL **HTTPS pública** — `localhost` é recusado no cadastro
(vale para [PagMaxx](../arquitetura/integracoes/pagmaxx.md) e para o WhatsApp).
Use um túnel:

```bash
cloudflared tunnel --url http://localhost:3333
# ou
ngrok http 3333
```

Cadastre a URL gerada no portal do provedor e coloque-a em
`PUBLIC_WEBHOOK_URL` no `.env`.

## Estrutura do que roda

```
pnpm dev
├── @na-regua/api      :3333   Fastify  ─┬─→ Postgres :5432
├── @na-regua/worker           BullMQ   ─┴─→ Redis    :6379
└── @na-regua/web      :3000   Next.js  ────→ api

pnpm --filter @na-regua/mobile dev   Expo (à parte, exige aparelho ou simulador)
```

## Problemas comuns

| Sintoma                                                 | Causa                                   | Solução                                                                       |
| ------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm setup` diz que o Docker não está rodando          | Docker Desktop fechado                  | abra e rode de novo                                                           |
| `/health` com `database.ok: false`                      | infra no ar?                            | `pnpm infra:ps`; se preciso `pnpm infra:up`                                   |
| `DATABASE_URL nao definida`                             | falta o `.env`                          | `pnpm setup`                                                                  |
| Porta 5432 ocupada                                      | Postgres instalado na máquina           | mude `POSTGRES_PORT` no `.env` e ajuste `DATABASE_URL`                        |
| Metro não acha um pacote do workspace                   | `node-linker=hoisted` sumiu do `.npmrc` | restaure e rode `pnpm install`                                                |
| `Cannot find name 'LayoutProps'` na web                 | tipos de rota do Next não gerados       | `pnpm --filter @na-regua/web typecheck` (roda `next typegen` antes)           |
| `Queue name cannot contain :`                           | nome de fila com `:`                    | BullMQ reserva `:`; use `dominio-acao`                                        |
| Banco em estado estranho após mudança de schema         | volume antigo                           | `pnpm infra:reset` — **apaga os dados locais**                                |
| Erro de build de dependência nativa após `pnpm install` | script de postinstall bloqueado         | aprove em `allowBuilds` no [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) |

## Estado atual do projeto

Seja realista sobre o que existe hoje:

| Componente                 | Estado                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Workspace, infra local, CI | ✅ funcionando                                                                               |
| `packages/money`           | ✅ implementado, 21 testes                                                                   |
| Demais pacotes             | 🔴 placeholder — cada `index.ts` aponta a decisão ou tarefa que o destrava                   |
| `apps/api`                 | 🟡 sobe, com `/health` real; sem rotas de negócio                                            |
| `apps/worker`              | 🟡 conecta e registra as filas; sem consumidores                                             |
| `apps/web`, `apps/mobile`  | 🟡 scaffold                                                                                  |
| Banco de dados             | 🔴 **sem schema** — destrava em `NR-007` ([ADR-0001](../decisoes/adr/0001-rls-por-linha.md)) |

O que fazer a seguir está no [Task Ledger](../processo/task-ledger.md).

## Antes do primeiro commit

Leia, nesta ordem:

1. [`git-workflow.md`](git-workflow.md) — branches, commits, PR
2. [`code-style.md`](code-style.md) — estilo e fronteiras entre módulos
3. [`../arquitetura/principios.md`](../arquitetura/principios.md) — as regras que a CI faz valer

Ou a versão de uma tela: [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
