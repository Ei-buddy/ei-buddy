# CI/CD

Os pipelines do GitHub Actions, o que cada um barra, e o que ainda não existe.

---

## Visão geral

| Workflow                                                       | Gatilho              | O que faz                                                                                                 | Barra o merge        |
| -------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- | -------------------- |
| [`ci.yml`](../../.github/workflows/ci.yml)                     | PR e push na `main`  | formatação, fronteiras, tipos, lint, testes, build                                                        | ✅                   |
| [`pr-checks.yml`](../../.github/workflows/pr-checks.yml)       | PR aberto ou editado | título, nome da branch, referência à tarefa                                                               | ✅                   |
| [`security.yml`](../../.github/workflows/security.yml)         | PR, push, semanal    | vulnerabilidades, segredos vazados, CodeQL                                                                | ✅ (severidade alta) |
| [`deploy-api.yml`](../../.github/workflows/deploy-api.yml)     | tag / manual         | **esqueleto** — NR-015, alvo [ADR-0015](../decisoes/adr/0015-vps-docker-compose.md)                       | —                    |
| [`deploy-web.yml`](../../.github/workflows/deploy-web.yml)     | tag / manual         | **esqueleto** — NR-015, mesmo compose da VM                                                               | —                    |
| [`mobile-build.yml`](../../.github/workflows/mobile-build.yml) | manual               | **esqueleto** — EAS; nome nas lojas: EiBuddy ([ADR-0011](../decisoes/adr/0011-eibuddy-nome-e-dominio.md)) | —                    |

## `ci.yml` — a verificação principal

Roda com **Postgres 17 e Redis 7 de verdade** como serviços, não com banco
fingido. Metade do que precisamos testar — transação, RLS, restrição de
integridade, concorrência — não existe num banco fingido
([`testes.md`](testes.md#testes-de-integração)).

Etapas, em ordem (as mais baratas primeiro, para falhar rápido):

| #   | Etapa          | Comando             | Barra                                                                                                 |
| --- | -------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | Formatação     | `pnpm format:check` | arquivo fora do padrão do Prettier                                                                    |
| 2   | **Fronteiras** | `pnpm boundaries`   | import que fura a [matriz de dependências](../arquitetura/principios.md#matriz-de-imports-permitidos) |
| 3   | Tipos          | `pnpm typecheck`    | erro de TypeScript                                                                                    |
| 4   | Lint           | `pnpm lint`         | `any`, variável não usada, `catch {}` vazio                                                           |
| 5   | Testes         | `pnpm test`         | teste falhando                                                                                        |
| 6   | Build          | `pnpm build`        | build quebrado                                                                                        |

### A etapa 2 é a mais importante

`pnpm boundaries` é a matriz de
[`principios.md`](../arquitetura/principios.md) traduzida para
[`.dependency-cruiser.cjs`](../../.dependency-cruiser.cjs).

Ela existe porque a promessa central do produto — app e WhatsApp acionam as
mesmas regras — não sobrevive à disciplina individual. Basta um handler
consultar o banco direto, uma vez, com pressa, e a regra passa a existir só
naquela rota.

**Foi testada com uma violação real:**

```
error handler-nao-importa-db: apps/api/src/__violacao_temporaria.ts → packages/db/src/index.ts
```

Uma regra que nunca disparou é uma regra que talvez não funcione.

> [!WARNING]
> **Nunca desative essa etapa para destravar um PR.** Se a fronteira precisa
> mudar, o caminho é abrir um `DEC`, discutir com as três trilhas, e atualizar
> a matriz **e** a configuração no mesmo PR.

## `pr-checks.yml` — convenções

| Verificação                                    | Por quê                                                   |
| ---------------------------------------------- | --------------------------------------------------------- |
| Título do PR passa no commitlint               | usamos squash merge: **o título vira o commit** na `main` |
| Nome da branch bate com `<tipo>/NR-<n>-<slug>` | é o que amarra branch → PR → item do Monday               |
| Título, corpo ou branch cita `NR-xxx`          | todo trabalho sai de uma tarefa do ledger                 |

Verificado: o commitlint rejeita escopo vazio e escopo inexistente
(`feat(pagamentos):` não passa, porque `pagamentos` não é um módulo real), e
aceita `feat(core): registrar venda com cálculo de líquido`.

## `security.yml`

| Job                       | O quê                           | Requisito                                          |
| ------------------------- | ------------------------------- | -------------------------------------------------- |
| Auditoria de dependências | `pnpm audit --audit-level high` | [RNF-029](../produto/requisitos-nao-funcionais.md) |
| Revisão de dependência    | analisa o que o PR adiciona     | idem                                               |
| Varredura de segredos     | gitleaks no histórico           | [RNF-022](../produto/requisitos-nao-funcionais.md) |
| CodeQL                    | análise estática de segurança   | —                                                  |

Roda também **toda segunda de manhã**: dependência vulnerável não espera alguém
abrir PR.

## Hooks locais

O que a CI verifica, o hook verifica antes — em 2 segundos em vez de 3 minutos.

| Hook         | Ferramenta  | Verifica                   |
| ------------ | ----------- | -------------------------- |
| `pre-commit` | lint-staged | formata os arquivos staged |
| `commit-msg` | commitlint  | mensagem no padrão         |

```bash
git commit --no-verify   # pula o hook local; a CI barra do mesmo jeito
```

Antes de pedir revisão, rode o que a CI vai rodar:

```bash
pnpm format:check && pnpm boundaries && pnpm typecheck && pnpm lint && pnpm test
```

## Branch protection

Configuração **manual** no GitHub, em _Settings → Branches → Add rule_ para
`main`. Não dá para versionar; este é o passo a passo.

| Opção                                    | Valor                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Require a pull request before merging    | ✅                                                                                        |
| — Required approvals                     | **1**                                                                                     |
| — Dismiss stale approvals on new commits | ✅                                                                                        |
| — Require review from Code Owners        | ✅                                                                                        |
| Require status checks to pass            | ✅                                                                                        |
| — Require branches to be up to date      | ✅                                                                                        |
| — Checks obrigatórios                    | `Verificar`, `Convencoes`, `Auditoria de dependencias`, `Varredura de segredos`, `CodeQL` |
| Require linear history                   | ✅                                                                                        |
| Do not allow bypassing                   | ✅ (inclusive para administradores)                                                       |
| Allow force pushes                       | ❌                                                                                        |
| Allow deletions                          | ❌                                                                                        |

E em _Settings → General → Pull Requests_:

| Opção                              | Valor                                      |
| ---------------------------------- | ------------------------------------------ |
| Allow merge commits                | ❌                                         |
| Allow squash merging               | ✅ — _default message: pull request title_ |
| Allow rebase merging               | ❌                                         |
| Automatically delete head branches | ✅                                         |

O `default message: pull request title` é o que faz o título do PR virar a
mensagem do commit — e é por isso que `pr-checks.yml` valida o título.

## Deploy — esqueleto até a NR-015

Os workflows de deploy ainda **falham de propósito**, com uma mensagem do que
falta. A [DEC-009](../decisoes/README.md#dec-009) fechou
([ADR-0015](../decisoes/adr/0015-vps-docker-compose.md)): o alvo é a VPS com
`infra/docker-compose.prod.yml`. Preencher os passos é a NR-015.

`deploy-api.yml` (e o compose na VM) precisa:

1. SSH na VPS (ou runner na própria máquina)
2. `docker compose -f infra/docker-compose.prod.yml build` no commit da tag
3. Migrations com `DATABASE_MIGRATION_URL` (papel com `BYPASSRLS`)
4. `up -d` com verificação de `/health`
5. **Reversão** para a imagem/commit anterior se `/health` não passar em 2 minutos ([RNF-064](../produto/requisitos-nao-funcionais.md))

Não há registry obrigatório neste recorte — o build é na VM.

E os requisitos que o deploy precisa atender:

| Requisito                                          | O que exige                                               |
| -------------------------------------------------- | --------------------------------------------------------- |
| [RNF-064](../produto/requisitos-nao-funcionais.md) | todo deploy rastreável ao commit e reversível em ≤ 10 min |
| [RNF-049](../produto/requisitos-nao-funcionais.md) | migration sem bloquear escrita por mais de 30 s           |
| [RNF-015](../produto/requisitos-nao-funcionais.md) | manutenção programada entre 22h e 6h                      |
| [RNF-009](../produto/requisitos-nao-funcionais.md) | disponibilidade ≥ 99,5%                                   |

## Segredos da CI

| Segredo               | Usado por        | Estado                         |
| --------------------- | ---------------- | ------------------------------ |
| `GITHUB_TOKEN`        | gitleaks, CodeQL | automático                     |
| `EXPO_TOKEN`          | build mobile     | ⏳ falta conta EAS             |
| credenciais de deploy | deploy           | ⏳ NR-015 (SSH / acesso à VPS) |

Segredos de produção ficam em _Environments_ com **aprovação obrigatória**, não
em _Repository secrets_: assim um workflow de PR de fork não os alcança.

## Dependabot

[`dependabot.yml`](../../.github/dependabot.yml) — semanal, agrupado.

**Agrupado de propósito:** um PR por grupo, não um por pacote. Dependabot
barulhento vira ruído ignorado, e aí a atualização de segurança passa
despercebida junto com o resto.

`expo` e `react-native` ficam de fora: sobem junto com o SDK, nunca isolados.

## Estado atual

| Item              | Estado                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `ci.yml`          | ✅ escrito; os 6 comandos passam localmente                                                       |
| `pr-checks.yml`   | ✅ escrito; commitlint verificado                                                                 |
| `security.yml`    | ✅ escrito                                                                                        |
| Hooks locais      | ✅ husky + commitlint + lint-staged                                                               |
| Changelog         | ✅ `pnpm changelog` — gerado dos commits ([git-workflow](git-workflow.md#como-cortar-um-release)) |
| `CODEOWNERS`      | 🟡 escrito com placeholders `@TRILHA-1/2/3` — **trocar pelos usuários reais**                     |
| Branch protection | 🔴 manual, ainda não configurada                                                                  |
| Deploy            | 🔴 esqueleto — NR-015, alvo [ADR-0015](../decisoes/adr/0015-vps-docker-compose.md)                |
| Build mobile      | 🔴 esqueleto — falta conta EAS                                                                    |

## Documentos relacionados

- [Git workflow](git-workflow.md) — as convenções que a CI faz valer
- [Code style](code-style.md) — as fronteiras verificadas na etapa 2
- [Testes](testes.md) — o que roda na etapa 5
- [Ambientes](ambientes.md) — variáveis e segredos
