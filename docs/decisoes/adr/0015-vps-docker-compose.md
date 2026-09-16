---
adr: 0015
titulo: Produção em VPS com Docker Compose
status: aceita
data: 2026-09-15
decisores:
  - Trilha 2 — Plataforma & Integrações
substitui: null
substituida_por: null
---

# ADR-0015 — Produção em VPS com Docker Compose

|                       |                                     |
| --------------------- | ----------------------------------- |
| **Status**            | Aceita                              |
| **Data**              | 2026-09-15                          |
| **Decisores**         | Trilha 2 — Plataforma & Integrações |
| **Decisão de origem** | [DEC-009](../README.md#dec-009)     |

## Contexto

A [DEC-009](../README.md#dec-009) pedia o alvo de deploy. A recomendação
preliminar era PaaS com Postgres gerenciado: três pessoas sem SRE não
deveriam operar Kubernetes, e o custo de VPS aparece em indisponibilidade,
não na fatura.

Na prática a pilha **já sobe numa VM**. Existe
[`infra/docker-compose.prod.yml`](../../../infra/docker-compose.prod.yml):
build na própria máquina, sem registry; Postgres 17 e Redis 7 na rede
interna; Caddy na 80/443; api, worker e web. O domínio público já é
**eibuddy.com.br** ([ADR-0011](0011-eibuddy-nome-e-dominio.md)).

A decisão atrasada era alinhar o papel com o fato. Os workflows
`deploy-api.yml` e `deploy-web.yml` continuam esqueleto — isso é a
[NR-015](../../processo/task-ledger.md), não motivo para deixar a DEC aberta.

Forças: [RNF-074](../../produto/requisitos-nao-funcionais.md) (custo ≤ 8% da
mensalidade); [RNF-013](../../produto/requisitos-nao-funcionais.md) (RPO ≤ 15
min, RTO ≤ 4 h); [RNF-064](../../produto/requisitos-nao-funcionais.md)
(reversão ≤ 10 min); operação sem pessoa de infra. Better Auth auto-hospedado
([ADR-0003](0003-better-auth-como-prova-de-identidade.md)) já assumia processo
próprio; VPS não o invalida.

## Opções consideradas

### Opção A — PaaS (Railway, Render, Fly.io)

| Prós                                 | Contras                                                  |
| ------------------------------------ | -------------------------------------------------------- |
| Postgres gerenciado e deploy por git | Custo cresce com o sono da máquina, não só com o cliente |
| Menos SSH e menos patch de SO        | Menos controle de _where_ o dado mora                    |
| A recomendação original da DEC       | Migrar a VM que já roda é retrabalho agora               |

### Opção B — Nuvem gerenciada (AWS, GCP)

| Prós                    | Contras                                            |
| ----------------------- | -------------------------------------------------- |
| RDS com PITR de verdade | Superfície e conta que o time não opera hoje       |
| Object storage nativo   | Kubernetes / ECS são o que a DEC pedia para evitar |

### Opção C — VPS + Docker Compose

A VM já está no ar. Compose de produção já descreve a pilha.

| Prós                                                      | Contras                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| Zero migração de runtime; o alvo é o que já existe        | Postgres no volume da VM — PITR (RNF-013) é script nosso, não botão |
| Caddy + Compose batem com TLS e isolamento de porta       | Patch de SO, disco, firewall e restore mensal são operação contínua |
| Better Auth, worker e Redis no mesmo host, latência baixa | Segredo em `.env.production` no disco, não em gerenciador do PaaS   |
| Custo previsível no começo, alinhado a RNF-074            | Uma VM só é ponto único até existir staging e réplica               |

## Decisão

**Escolhemos a opção C**, porque já é o ambiente real, não porque seja a
mais segura a longo prazo.

Produção é **uma VPS** rodando `infra/docker-compose.prod.yml`. Staging, se
existir, é outra VM (ou outro compose), nunca cópia de dado de produção
([RNF-034](../../produto/requisitos-nao-funcionais.md)). O
`infra/docker-compose.yml` local **não** vai para o servidor.

O que foi abdicado: PaaS com Postgres gerenciado no MVP; Kubernetes;
registry obrigatório (o build é na VM). Object storage continua MinIO no
perfil `full` local; em produção o XML de 5 anos ([RNF-037](../../produto/requisitos-nao-funcionais.md))
ainda precisa de destino — isso é da NR-015, não desta ADR.

A NR-015 deixa de esperar decisão e passa a **preencher** o que a VM ainda
não tem: deploy rastreável a partir do GitHub Actions, backup com restore
testado, ensaio de reversão em ≤ 10 min.

## Consequências

### Positivas

- NR-015 fica ⬜. Autenticação e Better Auth não mudam de provedor.
- A documentação deixa de contradizer o servidor que já atende
  `api.eibuddy.com.br`.
- Reversão imediata é `compose up` da imagem anterior, se a NR-015 gravar
  a tag do commit — o teto de 10 min é factível sem PaaS.

### Negativas

- **RNF-013 não vem de graça.** Volume Docker de Postgres não é RDS.
  Sem `pg_basebackup` / WAL arquivado e restore mensal, o requisito está
  furado mesmo com a DEC fechada.
- **Segredo no arquivo da VM.** Não há cofre do provedor. O arquivo fica
  fora do git; rotação continua manual ([`ambientes.md`](../../engenharia/ambientes.md)).
- **Uma máquina só.** Disco cheio, kernel ou o provedor da VPS caem o
  produto. RNF-009 (99,5%) é compromisso operacional, não SLA de PaaS.
- Três pessoas passam a ser as SRE. A DEC avisou isso.

### Neutras

- Caddy termina TLS. Postgres e Redis não publicam porta no host — já está
  no compose de produção.
- `AUTH_PROVIDER=fake` continua recusado em `NODE_ENV=production`.
- [DEC-014](../README.md#dec-014) (tag por app) permanece adiada: um
  compose sobe api, worker e web juntos.

## Impacto na documentação

- [x] `infra/README.md`, `infra/docker-compose.prod.yml`
- [x] `docs/engenharia/ambientes.md`, `ci-cd.md`
- [x] `docs/arquitetura/visao-geral.md`, `seguranca.md`
- [x] `DEC-009` marcada como 🟢 e apontando para esta ADR
- [x] `docs/processo/task-ledger.md` — NR-015 sai de 🚧

## Quando revisitar

- RPO/RTO furados num incidente real, ou restore mensal impossível na VM.
- Custo de operação (horas de pessoas, não só a fatura) passar o de um PaaS
  com Postgres gerenciado.
- Precisar de staging isolado e a segunda VM não aparecer.
- Better Auth ou outro processo próprio ficar inviável no provedor da VPS
  — o gatilho que a ADR-0003 já registrou, agora na direção inversa.
