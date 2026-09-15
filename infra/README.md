# infra

Ambiente local em Docker Compose, e — quando
[DEC-009](../docs/decisoes/README.md#dec-009) fechar — a infraestrutura de
staging e produção.

**Estado:** ✅ ambiente local funcionando · 🚧 produção bloqueada por DEC-009 · `NR-015`

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

Duas coisas que **não** acontecem sozinhas depois de subir os containers:

```bash
pnpm db:migrate                          # nenhum container aplica migrations
pnpm db:super-admin voce@empresa.com.br  # o primeiro Super Admin (ADR-0007)
```

## Produção — ainda não existe

Bloqueado por [DEC-009](../docs/decisoes/README.md#dec-009). **Este
`docker-compose.yml` não é para produção** — não tem TLS, nem backup, nem
segredo gerenciado, nem limite de recurso.

Quando a decisão fechar, o que a infraestrutura precisa atender:

| Requisito                                               | O que exige                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| [RNF-009](../docs/produto/requisitos-nao-funcionais.md) | disponibilidade ≥ 99,5%                                             |
| [RNF-013](../docs/produto/requisitos-nao-funcionais.md) | RPO ≤ 15 min, RTO ≤ 4 h — Postgres com recuperação a ponto no tempo |
| [RNF-014](../docs/produto/requisitos-nao-funcionais.md) | backup diário, **com restauração testada mensalmente**              |
| [RNF-020](../docs/produto/requisitos-nao-funcionais.md) | TLS 1.2+; banco e Redis sem exposição pública                       |
| [RNF-037](../docs/produto/requisitos-nao-funcionais.md) | object storage com retenção de 5 anos para XML fiscal               |
| [RNF-064](../docs/produto/requisitos-nao-funcionais.md) | deploy rastreável ao commit e reversível em ≤ 10 min                |
| [RNF-074](../docs/produto/requisitos-nao-funcionais.md) | custo ≤ 8% da mensalidade por empresa ativa                         |

**Recomendação:** PaaS com Postgres gerenciado. Três desenvolvedores sem SRE não
devem operar Kubernetes — o custo aparece em indisponibilidade, não na fatura.

Backup não testado não é backup: o teste mensal é requisito, não boa prática.

## Documentos relacionados

- [Setup](../docs/engenharia/setup.md) — como usar o ambiente local
- [Dados](../docs/arquitetura/dados.md) — RLS, migrations, backup
- [CI/CD](../docs/engenharia/ci-cd.md) — o que falta nos workflows de deploy
