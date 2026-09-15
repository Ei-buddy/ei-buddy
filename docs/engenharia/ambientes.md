# Ambientes e variáveis

Os ambientes do sistema e a matriz completa de variáveis de ambiente.

---

## Ambientes

| Ambiente       | Para quê                    | Dados                               | Provedores externos |
| -------------- | --------------------------- | ----------------------------------- | ------------------- |
| **local**      | desenvolvimento na máquina  | descartáveis, gerados               | modo `fake`         |
| **staging**    | validação antes de produção | sintéticos, nunca cópia de produção | homologação/sandbox |
| **production** | clientes reais              | reais                               | produção            |

> [!WARNING]
> **Dado de produção nunca é copiado para staging ou local.** Não é excesso de
> zelo: contém CPF, telefone e valor de venda de pessoas reais
> ([RNF-034](../produto/requisitos-nao-funcionais.md), LGPD). Precisa de massa
> realista? gere sintética a partir do schema.

**Staging e production ainda não existem** — dependem de
[DEC-009](../decisoes/README.md#dec-009). O domínio público de produção é
**eibuddy.com.br** ([ADR-0011](../decisoes/adr/0011-eibuddy-nome-e-dominio.md)).

## Regras

| Regra                                                                | Requisito                                          |
| -------------------------------------------------------------------- | -------------------------------------------------- |
| Segredo nunca em código, `.env` versionado ou log                    | [RNF-022](../produto/requisitos-nao-funcionais.md) |
| `.env.example` só com nomes e valores falsos                         | —                                                  |
| Desenvolvedor nunca usa credencial de produção                       | [RNF-070](../produto/requisitos-nao-funcionais.md) |
| Variável nova entra **no mesmo PR** em `.env.example` e nesta página | checklist do PR                                    |
| Aplicação **falha ao subir** se faltar variável obrigatória          | falhar cedo, não na primeira requisição            |
| Segredo rotacionado a cada 90 dias, ou imediatamente sob suspeita    | —                                                  |

O último item merece ênfase: **suspeita de vazamento é motivo suficiente para
rotacionar**. Não se investiga primeiro para decidir depois.

---

## Matriz de variáveis

Legenda: **Obr.** obrigatória · **Seg.** é segredo (nunca em log, nunca versionada)

### Aplicação

| Variável    | Obr. | Seg. | local                   | Descrição                                    |
| ----------- | :--: | :--: | ----------------------- | -------------------------------------------- |
| `NODE_ENV`  |  ✅  |      | `development`           | `development` \| `production` \| `test`      |
| `LOG_LEVEL` |      |      | `debug`                 | `debug` \| `info` \| `warn` \| `error`       |
| `TZ`        |      |      | `America/Sao_Paulo`     | fuso de exibição. Armazenamento é sempre UTC |
| `API_PORT`  |      |      | `3333`                  | porta da api                                 |
| `API_URL`   |  ✅  |      | `http://localhost:3333` | URL base da api, usada por web e mobile      |
| `WEB_PORT`  |      |      | `3000`                  | porta da web                                 |

### Dados

| Variável                                        | Obr. | Seg. | local                                                 | Descrição                                     |
| ----------------------------------------------- | :--: | :--: | ----------------------------------------------------- | --------------------------------------------- |
| `DATABASE_URL`                                  |  ✅  |  🔒  | `postgresql://naregua:naregua@localhost:5432/naregua` | conexão da aplicação — **sujeita a RLS**      |
| `DATABASE_MIGRATION_URL`                        |  ✅  |  🔒  | `postgresql://naregua_migrator:...`                   | papel com `BYPASSRLS`, **só** para migrations |
| `REDIS_URL`                                     |  ✅  |  🔒  | `redis://localhost:6379`                              | filas e cache                                 |
| `POSTGRES_USER` / `_PASSWORD` / `_DB` / `_PORT` |      |  🔒  | `naregua` / `naregua` / `naregua` / `5432`            | lidos pelo `docker-compose.yml` local         |
| `REDIS_PORT`                                    |      |      | `6379`                                                | idem                                          |

**Dois papéis de banco, de propósito:** a aplicação roda sob RLS e não pode
enxergar dados de outra empresa nem por engano; migrations precisam enxergar
tudo. Um papel só significaria abrir mão do isolamento —
[`dados.md`](../arquitetura/dados.md#multi-tenant).

### Autenticação — [DEC-008](../decisoes/README.md#dec-008)

| Variável        | Obr. | Seg. | local                    | Descrição                                   |
| --------------- | :--: | :--: | ------------------------ | ------------------------------------------- |
| `AUTH_PROVIDER` |  ✅  |      | `fake`                   | `fake` \| provedor escolhido                |
| `JWT_SECRET`    |  ✅  |  🔒  | valor de desenvolvimento | assinatura de token. **Trocar em produção** |

### PSP e assinatura — Asaas · [ADR-0004](../decisoes/adr/0004-asaas.md)

Detalhes em [`integracoes/asaas.md`](../arquitetura/integracoes/asaas.md).
Subconta por lojista: [ADR-0005](../decisoes/adr/0005-subconta-asaas-nao-baas.md).
Split nas vendas: [DEC-018](../decisoes/README.md#dec-018) (aberta — não enviar
`split[]` até fechar).

| Variável                   | Obr. | Seg. | local                              | Descrição                                        |
| -------------------------- | :--: | :--: | ---------------------------------- | ------------------------------------------------ |
| `PAYMENTS_PROVIDER`        |  ✅  |      | `fake`                             | `fake` \| `asaas`                                |
| `BILLING_PROVIDER`         |      |      | `fake`                             | `fake` \| `asaas` — mensalidade na conta-pai     |
| `ASAAS_BASE_URL`           |      |      | `https://api-sandbox.asaas.com/v3` | sandbox ou produção                              |
| `ASAAS_API_KEY`            |      |  🔒  | vazio                              | chave da **conta-pai**                           |
| `ASAAS_USER_AGENT`         |      |      | vazio                              | identificar a aplicação                          |
| `ASAAS_WEBHOOK_AUTH_TOKEN` |      |  🔒  | vazio                              | `authToken` dos webhooks da conta-pai            |
| `ASAAS_WALLET_ID`          |      |      | vazio                              | `walletId` da pai — só se DEC-018 escolher Split |

Chave da subconta e `authToken` do webhook por lojista **não** são env global:
vão ao cofre, referenciados pelo satélite de integração da empresa.

### WhatsApp — [DEC-003](../decisoes/README.md#dec-003)

| Variável                   | Obr. | Seg. | local  | Descrição                                                                    |
| -------------------------- | :--: | :--: | ------ | ---------------------------------------------------------------------------- |
| `WHATSAPP_PROVIDER`        |  ✅  |      | `fake` | `fake` \| provedor escolhido                                                 |
| `WHATSAPP_API_TOKEN`       |      |  🔒  | vazio  | —                                                                            |
| `WHATSAPP_PHONE_NUMBER_ID` |      |      | vazio  | número da plataforma                                                         |
| `WHATSAPP_WEBHOOK_SECRET`  |      |  🔒  | vazio  | validação de assinatura ([RNF-028](../produto/requisitos-nao-funcionais.md)) |

### Fiscal — [DEC-004](../decisoes/README.md#dec-004)

| Variável             | Obr. | Seg. | local         | Descrição                    |
| -------------------- | :--: | :--: | ------------- | ---------------------------- |
| `FISCAL_PROVIDER`    |  ✅  |      | `fake`        | `fake` \| provedor escolhido |
| `FISCAL_API_TOKEN`   |      |  🔒  | vazio         | —                            |
| `FISCAL_ENVIRONMENT` |      |      | `homologacao` | `homologacao` \| `producao`  |

O **certificado digital A1** não é variável de ambiente: é dado por empresa,
cifrado em repouso com chave separada do banco
([RNF-024](../produto/requisitos-nao-funcionais.md)). É o segredo mais perigoso
do sistema — ver [`seguranca.md`](../arquitetura/seguranca.md#certificado-digital-a1--tratamento-especial).

### Open Finance — [DEC-005](../decisoes/README.md#dec-005)

| Variável                | Obr. | Seg. | local  | Descrição                   |
| ----------------------- | :--: | :--: | ------ | --------------------------- |
| `BANKING_PROVIDER`      |  ✅  |      | `fake` | `fake` \| provedor \| `ofx` |
| `BANKING_CLIENT_ID`     |      |  🔒  | vazio  | —                           |
| `BANKING_CLIENT_SECRET` |      |  🔒  | vazio  | —                           |

### Agente / LLM — [ADR-0010](../decisoes/adr/0010-mastra-e-gpt-4o-mini.md)

| Variável                     | Obr. | Seg. | local                | Descrição                                                             |
| ---------------------------- | :--: | :--: | -------------------- | --------------------------------------------------------------------- |
| `AGENT_PROVIDER`             |  ✅  |      | `fake`               | `fake` \| `mastra` — em produção só `mastra` é servido                |
| `OPENAI_API_KEY`             |      |  🔒  | vazio                | obrigatória só com `AGENT_PROVIDER=mastra`                            |
| `AGENT_MODEL`                |      |      | `openai/gpt-4o-mini` | formato Mastra `provedor/modelo`                                      |
| `AGENT_MONTHLY_BUDGET_CENTS` |      |      | —                    | teto por empresa ([RNF-073](../produto/requisitos-nao-funcionais.md)) |

Configuração de IA **não derruba a API**. Em produção sem `mastra` + chave, o
assistente sobe desligado: `/agent/messages` responde `503 UNAVAILABLE` e o log
avisa na subida. Venda, financeiro, estoque e CRM seguem normais — mesmo
critério de `SECRETS_KEY` na emissão fiscal. Recusa de boot fica só para falha
de segurança (RLS furada, `AUTH_PROVIDER=fake`).

### Webhooks em desenvolvimento

| Variável             | Obr. | Seg. | local | Descrição                                     |
| -------------------- | :--: | :--: | ----- | --------------------------------------------- |
| `PUBLIC_WEBHOOK_URL` |      |      | vazio | URL do túnel — provedores recusam `localhost` |

### Serviços opcionais (perfil `full`)

| Variável                                | local                    | Descrição            |
| --------------------------------------- | ------------------------ | -------------------- |
| `MINIO_USER` / `MINIO_PASSWORD`         | `naregua` / `naregua123` | object storage local |
| `MINIO_PORT` / `MINIO_CONSOLE_PORT`     | `9000` / `9001`          | —                    |
| `MAILPIT_SMTP_PORT` / `MAILPIT_UI_PORT` | `1025` / `8025`          | e-mail local         |

---

## Modo `fake`

Todo adapter aceita `*_PROVIDER=fake` e responde de forma determinística, sem
rede.

Isso é decisão de arquitetura, não conveniência:

| Benefício                                                     | Consequência                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| O sistema sobe local sem credencial nenhuma                   | ninguém precisa de conta em fornecedor para trabalhar                    |
| Ninguém tem motivo para pôr credencial de produção na máquina | [RNF-070](../produto/requisitos-nao-funcionais.md) fica fácil de cumprir |
| Teste de integração roda na CI sem segredo                    | pipeline mais simples e mais rápido                                      |
| Trabalho não espera decisão de fornecedor                     | destrava as 6 decisões de provedor em aberto                             |

Regra: **o adapter falso implementa a mesma porta**, inclusive os caminhos de
erro. Falso que só devolve sucesso esconde exatamente o que precisa ser testado.

## Gestão de segredos

| Ambiente             | Onde ficam                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------- |
| local                | `.env`, no `.gitignore`, com valores de mentira                                              |
| staging / production | gerenciador de segredos do provedor de hospedagem — [DEC-009](../decisoes/README.md#dec-009) |
| CI                   | GitHub Secrets, por ambiente, com aprovação para produção                                    |

### Se vazar

1. **Rotacione imediatamente** — antes de investigar
2. Revogue o segredo antigo no provedor
3. Verifique log de acesso do provedor
4. Registre o incidente ([`seguranca.md`](../arquitetura/seguranca.md#resposta-a-incidentes))
5. Análise de causa raiz, sem procurar culpado

## Documentos relacionados

- [Setup](setup.md) — como configurar o ambiente local
- [CI/CD](ci-cd.md) — variáveis nos pipelines
- [Segurança](../arquitetura/seguranca.md) — gestão de segredos
- [`.env.example`](../../.env.example) — o arquivo em si
