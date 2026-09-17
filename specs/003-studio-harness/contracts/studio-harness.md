# Contract: harness Studio → `processMessage`

**Feature**: NR-121 · **Package**: `packages/agent` + `apps/api`  
**UI**: Mastra Studio (SPA) contra a API Fastify  
**Laço**: o mesmo `processMessage` da NR-060

## Purpose

Painel de engenharia que simula o turno de mensagem (número forjado) sem WhatsApp. Substitui o Zap no desenvolvimento. **Não** é canal do lojista.

## Availability

Igual ao porteiro da NR-060 (`motivoDoAgenteIndisponivel`):

| Ambiente | Adapter Mastra / Studio | `POST /agent/messages` |
| -------- | ----------------------- | ---------------------- |
| `NODE_ENV !== 'production'` + runtime ok | montado (`/api/agents/*`) | 200 com sessão fixture |
| `production` + `AGENT_PROVIDER=fake` | **não monta** | 503 |
| `production` sem `AGENT_HARNESS=1` | **não monta** | 503 |
| `production` + harness + `mastra` + chave | fora desta fatia como produto; se a flag existir em staging, monta | 200 staging |
| Runtime ausente / presets inválidos | **não monta** (log); API segue | 503 se runtime nulo |

Rotas Mastra ausentes = **404**, não 200 de um segundo assistente.

## Superfície HTTP (adapter)

Prefixo default do Mastra: `/api`. Único agent registrado: `studio-harness`.

| Método | Caminho (típico) | Quem chama | Efeito |
| ------ | ---------------- | ---------- | ------ |
| `POST` | `/api/agents/studio-harness/generate` | Studio chat | relé → `processMessage` |
| `GET`  | `/api/agents` | Studio lista | só `studio-harness` |
| `POST` | `/agent/messages` | harness HTTP NR-060 | **inalterado** |

`erp-agent` (LlmPort) **não** aparece em `/api/agents`.

O path exato de generate segue o adapter `@mastra/fastify` instalado — testes de contrato batem no que o Studio usa (listar agents + enviar uma mensagem), não em um path inventado.

## Request context (Studio)

JSON no editor de context / preset dropdown (`--request-context-presets` ou arquivo apontado por `AGENT_STUDIO_PRESETS`).

```json
{ "preset": "claudia-loja-1" }
```

ou

```json
{ "peer": "5511999000001" }
```

| Campo | Servidor |
| ----- | -------- |
| `preset` | resolve no arquivo |
| `peer` | resolve no `FixturePeerDirectory` |
| `companyId`, `userId`, `role` | **ignorados** |

Preset desconhecido, peer desconhecido, ou os dois contraditórios → resposta de recusa, `kind` equivalente a `ignored`, **sem** tool de negócio.

Arquivo de presets: [presets.md](./presets.md).

## Tool `process_message`

Única tool do agent `studio-harness`.

**Input**

```json
{ "text": "quanto vendi hoje?" }
```

`text`: trim, min 1, max 4000 (mesmo recorte de `agentMessageInputSchema`).

**Output** (envelope da tool, visível no Studio)

```json
{
  "kind": "answer",
  "text": "1 venda. Bruto R$ 49,90. …",
  "durationMs": 412
}
```

| Campo            | Quando |
| ---------------- | ------ |
| `kind`           | sempre — mesmos valores da NR-060 |
| `text`           | sempre; se `ignored` do laço, texto genérico de “não vinculado” (não string vazia) |
| `confirmationId` | se `kind === 'confirmation'` |
| `durationMs`     | sempre ≥ 0 |

`channel` efetivo: `whatsapp`. `peer`: o resolvido. `companyId`: do diretório.

## Relé determinístico

O generate do `studio-harness` MUST NOT chamar provedor pago. Sempre encaminha o texto do usuário para `process_message`. Interpretação = `LlmPort` **dentro** de `processMessage` (`fake` ou `mastra`).

## Isolation

Dois presets, duas empresas: mensagem com preset A não lista venda de B. Teste automatizado (mesmo espírito do RLS: tentar o outro e falhar).

## Errors

| Situação | Superfície | Comportamento |
| -------- | ---------- | ------------- |
| Harness desligado | `/api/agents/*` | 404 (não monta) |
| Preset/peer inválido | tool / generate | recusa genérica, zero `core` |
| Texto vazio | tool | validação, sem execute de catálogo |
| Teto de IA | laço | mesmo aviso da NR-060 |
| Modelo real ausente com `AGENT_PROVIDER=mastra` | boot | adapter não monta (motivo já existente) |

## Out of scope neste contrato

- Memory / threads Mastra
- Workflows, `/api/workflows`
- `/api/agents/erp-agent`
- Auth EE do Studio
- Webhook Meta (NR-046)
- Mudança de `POST /agent/messages`
