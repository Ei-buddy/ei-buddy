# CI/CD

Os pipelines do GitHub Actions, o que cada um barra, e o que ainda não existe.

---

## Visão geral

| Workflow                                                         | Gatilho              | O que faz                                                                                                              | Barra o merge        |
| ---------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------- |
| [`ci.yml`](../../.github/workflows/ci.yml)                       | PR e push na `main`  | formatação, fronteiras, tipos, lint, testes, build                                                                     | ✅                   |
| [`pr-checks.yml`](../../.github/workflows/pr-checks.yml)         | PR aberto ou editado | título, nome da branch, referência à tarefa                                                                            | ✅                   |
| [`security.yml`](../../.github/workflows/security.yml)           | PR, push, semanal    | vulnerabilidades, segredos vazados (dependency review e CodeQL desativados — exigem GHAS pago em repo privado)         | ✅ (severidade alta) |
| [`deploy.yml`](../../.github/workflows/deploy.yml)               | tag `v*` / manual    | build na VPS, migrations, `up -d`, `/health` e reversão ([ADR-0015](../decisoes/adr/0015-vps-docker-compose.md))       | —                    |
| [`deploy-api.yml`](../../.github/workflows/deploy-api.yml)       | manual               | atalho — chama `deploy.yml`                                                                                            | —                    |
| [`deploy-web.yml`](../../.github/workflows/deploy-web.yml)       | manual               | atalho — chama `deploy.yml` (mesmo compose da VM)                                                                      | —                    |
| [`restore-drill.yml`](../../.github/workflows/restore-drill.yml) | mensal / manual      | restaura o backup mais recente num Postgres descartável e confere ([RNF-014](../produto/requisitos-nao-funcionais.md)) | —                    |
| [`mobile-build.yml`](../../.github/workflows/mobile-build.yml)   | manual               | **esqueleto** — EAS; nome nas lojas: EiBuddy ([ADR-0011](../decisoes/adr/0011-eibuddy-nome-e-dominio.md))              | —                    |

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
| ~~Revisão de dependência~~ | ⬜ desativado — exige GitHub Advanced Security, pago pra repo privado de organização (desde que o repo virou privado sob a org Ei-buddy) | idem |
| Varredura de segredos     | gitleaks (binário direto, não a action — v3 dela passou a exigir licença paga) no histórico | [RNF-022](../produto/requisitos-nao-funcionais.md) |
| ~~CodeQL~~                | ⬜ desativado — mesma exigência de GitHub Advanced Security | —                                                  |

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

> **Indisponível no plano atual.** Desde que o repo virou privado sob a
> organização Ei-buddy, `Settings → Branches` retorna "Upgrade to GitHub Pro
> or make this repository public to enable this feature" — branch protection
> exige plano pago pra repo privado de organização. Hoje nenhum check bloqueia
> merge de fato, apesar da tabela abaixo. Configurar assim que o plano
> permitir.

| Opção                                    | Valor                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| Require a pull request before merging    | ✅                                                                        |
| — Required approvals                     | **1**                                                                     |
| — Dismiss stale approvals on new commits | ✅                                                                        |
| — Require review from Code Owners        | ✅                                                                        |
| Require status checks to pass            | ✅                                                                        |
| — Require branches to be up to date      | ✅                                                                        |
| — Checks obrigatórios                    | `Verificar`, `Convencoes`, `Auditoria de dependencias`, `Varredura de segredos` |
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

## Deploy — VPS com Compose

O alvo é a VPS com `infra/docker-compose.prod.yml`
([ADR-0015](../decisoes/adr/0015-vps-docker-compose.md)). Quem dispara é
[`deploy.yml`](../../.github/workflows/deploy.yml), por tag `v*` ou à mão;
`deploy-api.yml` e `deploy-web.yml` são atalhos manuais que chamam o mesmo
workflow — a VM sobe api, worker e web no **mesmo compose**, então não há
deploy separado por app enquanto a [DEC-014](../decisoes/README.md#dec-014)
seguir adiada.

A sequência vive em [`infra/deploy.sh`](../../infra/deploy.sh), versionada,
para poder ser lida e corrigida como código em vez de ficar colada num passo
de YAML. Ela:

1. builda no commit pedido, marcando as imagens com ele (`DEPLOY_TAG`)
2. roda as migrations com `DATABASE_MIGRATION_URL` (papel com `BYPASSRLS`)
3. sobe com `up -d`
4. só termina bem se `/health` responder 200 em até 2 minutos — e `/health` só
   responde 200 com banco **e** Redis de pé

Se qualquer passo falhar, o workflow volta para o commit anterior e sobe de
novo. **Sem rebuild**: a imagem antiga continua na máquina marcada com o commit
dela, e é isso que torna o teto de 10 minutos da
[RNF-064](../produto/requisitos-nao-funcionais.md) factível sem PaaS.

> **A reversão não desfaz migration.** As migrations são forward-only: voltar o
> código não volta o schema, e por isso o rollback roda com `MIGRAR=nao`.
> Migration que precise ser desfeita é migration nova, escrita para isso.

Não há registry obrigatório neste recorte — o build é na VM.

Backup e ensaio de restauração estão em
[`infra/README.md`](../../infra/README.md#backup-e-recuperação). Falta ainda,
na mesma NR-015: o destino remoto do backup (sem ele a
[RNF-013](../produto/requisitos-nao-funcionais.md) segue furada) e o object
storage do XML fiscal de 5 anos
([RNF-037](../produto/requisitos-nao-funcionais.md)) — os dois dependem de
escolher um provedor.

E os requisitos que o deploy precisa atender:

| Requisito                                          | O que exige                                               |
| -------------------------------------------------- | --------------------------------------------------------- |
| [RNF-064](../produto/requisitos-nao-funcionais.md) | todo deploy rastreável ao commit e reversível em ≤ 10 min |
| [RNF-049](../produto/requisitos-nao-funcionais.md) | migration sem bloquear escrita por mais de 30 s           |
| [RNF-015](../produto/requisitos-nao-funcionais.md) | manutenção programada entre 22h e 6h                      |
| [RNF-009](../produto/requisitos-nao-funcionais.md) | disponibilidade ≥ 99,5%                                   |

## Segredos da CI

| Segredo           | Usado por        | Estado                         |
| ----------------- | ---------------- | ------------------------------ |
| `GITHUB_TOKEN`    | CI em geral      | automático                     |
| `EXPO_TOKEN`      | build mobile     | ⏳ falta conta EAS             |
| `VPS_HOST`        | deploy           | endereço da VPS                |
| `VPS_USER`        | deploy           | usuário do SSH                 |
| `VPS_SSH_KEY`     | deploy           | chave privada do deploy        |
| `VPS_KNOWN_HOSTS` | deploy           | opcional — fingerprint do host |

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
