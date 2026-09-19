# infra

Ambiente local em Docker Compose, e produção na VPS
([ADR-0015](../docs/decisoes/adr/0015-vps-docker-compose.md)).

**Estado:** ✅ ambiente local · ✅ deploy automatizado · ✅ backup com PITR e ensaio mensal · ⬜ NR-015 (destino remoto do backup e do XML fiscal)

## Ambiente local

```bash
pnpm setup        # copia o .env, sobe tudo e espera ficar saudável
pnpm infra:up     # sobe (Postgres + Redis)
pnpm infra:down   # para, mantendo os dados
pnpm infra:reset  # APAGA os volumes e recria
pnpm infra:psql   # abre o psql
pnpm infra:redis  # abre o redis-cli
pnpm infra:logs   # acompanha os logs
```

### Serviços

| Serviço     | Porta       | Perfil | Para quê                          |
| ----------- | ----------- | ------ | --------------------------------- |
| Postgres 17 | 5432        | padrão | dados de negócio, com RLS         |
| Redis 7     | 6379        | padrão | filas e cache                     |
| MinIO       | 9000 / 9001 | `full` | XMLs fiscais, anexos, exportações |
| Mailpit     | 1025 / 8025 | `full` | ver e-mails sem enviar de verdade |

```bash
docker compose -f infra/docker-compose.yml --profile full up -d
```

Os dois primeiros sobem com `--wait`: o comando só retorna quando o healthcheck
passa. Isso evita a classe de erro em que a aplicação sobe antes do banco e
falha por um motivo que parece outro.

### Inicialização do Postgres

[`postgres/init/01-extensions.sql`](postgres/init/01-extensions.sql) roda **uma
única vez**, na criação do volume:

| O quê                                    | Para quê                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pgcrypto`                               | geração de UUID no banco                                                                                                             |
| `unaccent`, `pg_trgm`                    | busca de produto e cliente por nome, sem acento e tolerante a erro de digitação ([RF-029](../docs/produto/requisitos-funcionais.md)) |
| papel `naregua_migrator` com `BYPASSRLS` | migrations precisam enxergar todas as linhas; a aplicação não pode                                                                   |

Para reexecutar: `pnpm infra:reset` (apaga os dados locais).

## Variáveis de produção

**Não monte o `.env.production` a partir do `.env.example`.** Ele é o exemplo de
_desenvolvimento_, e entrega valores que a API recusa em produção
(`AUTH_PROVIDER=fake`, `JWT_SECRET=dev-only-…`). Copiar esse arquivo já derrubou
a produção duas vezes — o sintoma é o site carregando e toda chamada de API
falhando, com `502` em `api.eibuddy.com.br`.

```bash
cp .env.production.example .env.production   # na raiz, fora do git
```

[`.env.production.example`](../.env.production.example) lista cada variável com
o que ela muda em relação ao ambiente local e por quê — inclusive as duas que
mais quebram: o provedor de autenticação e o papel do banco em `DATABASE_URL`
(usar o papel com `BYPASSRLS` faz a API **recusar subir**, de propósito).

Migration **não** sai de `docker compose up`: nenhum container a aplica. Quem
aplica é [`deploy.sh`](deploy.sh), e só por isso o deploy automatizado não
sobe código novo contra schema velho. Subindo o compose na mão, o comando
continua sendo seu:

```bash
pnpm db:migrate
```

A outra coisa que não acontece sozinha está na seção seguinte.

## Primeiro Super Admin

Num banco novo **não existe Super Admin**, e `/admin` fica inacessível para
todo mundo: `platform_admin_grant` exige que quem concede já seja Super Admin
([ADR-0007](../docs/decisoes/adr/0007-super-admin-por-sessao-auditada.md)). O
primeiro é a exceção, e sai por um comando:

```bash
# 1. a pessoa cria a conta normalmente pelo site (/criar-conta)
# 2. promova essa conta — uma vez, por banco:
pnpm db:super-admin fulano@empresa.com.br
```

Lê `DATABASE_MIGRATION_URL` (o papel com `BYPASSRLS`), porque `platform_admins`
tem `FORCE ROW LEVEL SECURITY` sem política — a conexão da aplicação não
enxerga nem escreve nela.

O script **recusa** se já houver Super Admin: a partir do segundo, use a tela
`/admin`, que registra quem concedeu. Ele também não cria conta — promove uma
que já existe.

## Produção — VPS + Compose

Alvo: [ADR-0015](../docs/decisoes/adr/0015-vps-docker-compose.md).
**Este `docker-compose.yml` não é para produção** — use
[`docker-compose.prod.yml`](docker-compose.prod.yml) (Caddy, sem porta pública
em Postgres/Redis).

### Deploy

Dispara por tag `v*` ou à mão, pelo
[`deploy.yml`](../.github/workflows/deploy.yml); a sequência que roda na VM é
[`deploy.sh`](deploy.sh) — build marcado com o commit, migrations, `up -d` e
`/health`, com reversão para o commit anterior se algo falhar. Detalhes em
[ci-cd.md](../docs/engenharia/ci-cd.md#deploy--vps-com-compose).

À mão, na própria máquina, é o mesmo caminho:

```bash
cd /opt/na-regua && git fetch origin && git checkout --detach <commit>
DEPLOY_TAG=<commit> ./infra/deploy.sh
```

Para o workflow alcançar a VM, configure no **Environment** `production` (não
em Repository secrets — assim um PR de fork não os alcança):

| Segredo           | O que é                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `VPS_HOST`        | endereço da máquina                                                                                           |
| `VPS_USER`        | usuário do SSH, com permissão de `docker`                                                                     |
| `VPS_SSH_KEY`     | chave privada correspondente à pública no `authorized_keys` da VM                                             |
| `VPS_KNOWN_HOSTS` | opcional, e recomendado: `ssh-keyscan <host>`. Sem ele, o deploy confia em quem responder na primeira conexão |

E, se a máquina fugir do padrão, as **variables** `VPS_SSH_PORT` (padrão `22`)
e `VPS_DEPLOY_PATH` (padrão `/opt/na-regua`).

O clone na VM precisa conseguir `git fetch` sozinho — deploy key de leitura no
repositório, ou credencial já configurada na máquina.

### Backup e recuperação

`archive_mode=on` no compose arquiva o WAL, e `archive_timeout=900` força a
troca de segmento a cada 15 min — é isso que dá o RPO da
[RNF-013](../docs/produto/requisitos-nao-funcionais.md). Backup diário sozinho
daria RPO de 24 h.

| Script                                 | Quando              | O que faz                                                      |
| -------------------------------------- | ------------------- | -------------------------------------------------------------- |
| [`backup.sh`](backup.sh)               | diário, por cron    | `pg_basebackup` comprimido, apara os antigos e o WAL já inútil |
| [`restore-drill.sh`](restore-drill.sh) | mensal, pelo GitHub | restaura o mais recente num Postgres descartável e confere     |

No cron da VM:

```cron
10 3 * * *  cd /opt/na-regua && ./infra/backup.sh >> /var/log/na-regua-backup.log 2>&1
```

O ensaio mensal roda pelo
[`restore-drill.yml`](../.github/workflows/restore-drill.yml), e **o histórico
desse workflow é o registro** que a [RNF-014](../docs/produto/requisitos-nao-funcionais.md)
pede. Era isso ou uma planilha que alguém lembra de preencher — a execução que
falha aparece sozinha.

> **Backup no mesmo disco não é backup.** Por padrão ele fica só em
> `BACKUP_DIR` (`/var/backups/na-regua`), e o incidente que leva a VM leva os
> dois. Defina `BACKUP_REMOTO` com um destino de [rclone](https://rclone.org)
> — S3, R2, B2, SFTP, tanto faz, e é por isso que é rclone — para o envio
> passar a acontecer no fim de cada backup. **Enquanto isso não existir, a
> RNF-013 continua furada.**

Variáveis: `BACKUP_DIR` (onde), `MANTER` (quantos backups base, padrão `7`),
`BACKUP_REMOTO` (destino do rclone).

Espaço: com `archive_timeout` de 15 min, o pior caso é ~1,5 GB de WAL por dia
mesmo com o banco parado (96 segmentos de 16 MB). O `backup.sh` apara o que já
não serve a nenhum backup retido, mas vale olhar o disco depois do primeiro mês.

O que a NR-015 ainda precisa atender na VM:

| Requisito                                                   | O que exige                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [RNF-009](../docs/produto/requisitos-nao-funcionais.md)     | disponibilidade ≥ 99,5%                                                       |
| [RNF-013](../docs/produto/requisitos-nao-funcionais.md)     | ⚠️ WAL e basebackup prontos; falta `BACKUP_REMOTO` — no mesmo disco não conta |
| ~~[RNF-014](../docs/produto/requisitos-nao-funcionais.md)~~ | ✅ backup diário por cron e ensaio mensal registrado no workflow              |
| [RNF-020](../docs/produto/requisitos-nao-funcionais.md)     | TLS 1.2+ (Caddy); banco e Redis sem exposição pública                         |
| [RNF-037](../docs/produto/requisitos-nao-funcionais.md)     | object storage com retenção de 5 anos para XML fiscal                         |
| ~~[RNF-064](../docs/produto/requisitos-nao-funcionais.md)~~ | ✅ deploy rastreável ao commit e reversível sem rebuild — ver "Deploy" acima  |
| [RNF-074](../docs/produto/requisitos-nao-funcionais.md)     | custo ≤ 8% da mensalidade por empresa ativa                                   |

PaaS com Postgres gerenciado foi abdicado neste recorte. Backup não testado
não é backup: o teste mensal é requisito, não boa prática.

## Documentos relacionados

- [Setup](../docs/engenharia/setup.md) — como usar o ambiente local
- [Dados](../docs/arquitetura/dados.md) — RLS, migrations, backup
- [CI/CD](../docs/engenharia/ci-cd.md) — o que falta nos workflows de deploy
