# Quickstart: validar NR-060 (runtime do assistente)

**Goal**: Desenvolvedor sobe o harness, cria fixture, exercita os cenários do DoD com `AGENT_PROVIDER=fake` (sem OpenAI).

## Prerequisites

- Repo instalado (`pnpm install`), Postgres do Compose no ar (`pnpm`/`docker` conforme [setup](../../docs/engenharia/setup.md))
- Branch `feat/NR-060-runtime-agente`
- Variáveis: `AGENT_PROVIDER=fake` (default local). Sem `OPENAI_API_KEY` obrigatória neste modo

## Setup (fixture)

1. Subir API em não-produção.
2. Criar **usuário + empresa de teste** (owner) pelos fluxos/API já existentes de cadastro/auth.
3. Popular o mínimo: 1 produto, 1 cliente, (opcional) venda do dia e recebível em aberto para cobrança; lançamentos classificados se for validar DRE/RF-108.
4. Autenticar como essa fixture (sessão/cookie como o app).

## Smoke automatizado

```bash
pnpm --filter @na-regua/agent test
pnpm --filter api test -- agent
```

Esperado: processMessage (confirmação, expiração, unknown→capacidades), rota `POST /agent/messages` com runtime fake.

## Smoke manual (DoD)

Com sessão da fixture:

```http
POST /agent/messages
{ "text": "quanto vendi hoje?" }
```

| #   | Mensagem                                                | Esperado                                                               |
| --- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | `quanto vendi hoje?`                                    | `answer` com totais = mesmo caso de uso do app                         |
| 2   | `quem está me devendo?`                                 | lista coerente com recebíveis                                          |
| 3   | `quanto tem de camiseta?`                               | `unknown`/capacidades **sem** prometer estoque                         |
| 4   | `cadastra o João, 11 98888-7777`                        | `confirmation` → `sim` → cliente criado                                |
| 5   | venda scriptada via FakeLlm/`script`                    | `confirmation` → `sim` → venda; centavos = app                         |
| 6   | produto ambíguo                                         | `clarify` com opções                                                   |
| 7   | `manda a cobrança pro João` (com dívida)                | `confirmation` → envio fake + confirmação                              |
| 8   | `resumo do mês`                                         | faturamento, custo, despesas, resultado (DRE); texto truncado se longo |
| 9   | `emite a NFC-e da venda X` / certificado / importar OFX | recusa + orienta app; zero efeito                                      |
| 10  | mutação sem `sim` / TTL                                 | nada gravado                                                           |

Contratos: [agent-messages.md](./contracts/agent-messages.md), [tool-catalog.md](./contracts/tool-catalog.md). Modelo: [data-model.md](./data-model.md).

## Opcional — Mastra real (SC-006, fora da CI)

```bash
AGENT_PROVIDER=mastra OPENAI_API_KEY=… AGENT_MODEL=openai/gpt-4o-mini
```

Repetir uma consulta e uma venda. Mesmo endpoint; só a origem da intenção muda.

## Não fazer nesta fatia

- Subir Mastra Studio / porta 4111 (NR-121)
- Webhook Meta (NR-046)
- Entregar arquivo/link de relatório (RF-109 — dívida)
- Confiar em Memory Mastra para totais

## Definition of Done (checklist rápido)

- [ ] SC-001 com fake
- [ ] SC-002 centavos iguais
- [ ] SC-003 confirmação
- [ ] SC-004 recusas
- [ ] RF-108 no texto do resumo
- [ ] Ledger NR-060 → ✅ no PR; RF-109 anotado como dívida
