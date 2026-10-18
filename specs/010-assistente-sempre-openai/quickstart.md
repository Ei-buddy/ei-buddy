# Quickstart: assistente servido sempre pela OpenAI

**Date**: 2026-10-01  
**Spec**: [spec.md](./spec.md)  
**Contratos**: [disponibilidade](./contracts/disponibilidade-do-assistente.md), [`LlmPort`](./contracts/llm-port.md)

Prova de merge é a suíte sem chave. As linhas com OpenAI são manuais e não entram na CI.

## 1. CI, sem chave

Pré-requisito: ambiente de teste do monorepo, sem `OPENAI_API_KEY`.

```bash
pnpm --filter @na-regua/agent test
pnpm --filter @na-regua/env test
pnpm --filter @na-regua/api test
```

Esperado:

- A suíte passa sem rede para a OpenAI.
- Nenhum teste lê `AGENT_PROVIDER`.
- Um `decide` do `FakeLlm` sem `script()` devolve `unknown`.
- Um fluxo com `script()` ainda pede confirmação e só grava no "sim", com os centavos do caso de uso.
- Foto de fixture (`bytesFromMarker`) continua no `FakeBarcodeDecoder`.

## 2. Local, sem chave

Tirar `OPENAI_API_KEY` e `AGENT_PROVIDER` do `.env`. Subir a API.

```bash
pnpm --filter @na-regua/api dev
```

Esperado:

- O processo escuta. O log avisa que o assistente está desligado e cita a chave, não um modo falso.
- `POST /agent/messages` com sessão de fixture responde **503** e `error.code = UNAVAILABLE`.
- Uma rota que não é do assistente (por exemplo saúde ou login) não responde 503 por causa da chave.
- `GET /api/agents` não lista `studio-harness` (adapter não montou).

## 3. Local, com chave

`OPENAI_API_KEY` preenchida. `AGENT_MODEL` pode ficar no default. Sem `AGENT_PROVIDER`. Fora de produção.

Repetir um turno de consulta pelo `POST /agent/messages` com a mesma sessão de fixture de hoje (usuário e empresa de teste).

Esperado:

- A resposta vem do laço (tool do catálogo ou esclarecimento), não de uma frase fixa do antigo regex.
- Uma ação que grava valor pede confirmação. Sem "sim", nada é gravado.
- No Studio (`pnpm studio`, presets de fixture carregados), um turno no `studio-harness` gasta uma chamada de modelo, dentro do `processMessage`. O painel não faz uma segunda.

Este passo é manual. Falha aqui não é teste de CI.

## 4. Produção

`NODE_ENV=production`, chave presente, `AGENT_HARNESS` desligado.

Esperado: assistente indisponível, motivo de harness, API no ar.

Com `AGENT_HARNESS=1` e a chave: o runtime é o Mastra. Sem a chave, mesmo com a flag: indisponível.

## 5. Regressão que não deve aparecer

- Boot da API inteira recusado porque a chave falta.
- `AGENT_PROVIDER=fake` voltando a interpretar "quanto vendi hoje?".
- Foto de câmera passando a ser lida pelo modelo.
- `generate` do Mastra gravando venda ou conta antes do "sim".
