# Implementation Plan: Assistente servido sempre pela OpenAI

**Branch**: `feat/melhorias-agente-ia` | **Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-assistente-sempre-openai/spec.md`

## Summary

O processo que responde mensagem passa a montar só o Mastra quando `OPENAI_API_KEY` existe. Sem a chave a API sobe e o assistente responde 503. O reconhecedor por regex sai de `FakeLlm`; a CI continua provando confirmação e centavos com `script()`, sem rede. O Studio, as duas cópias das tools, o porteiro `AGENT_HARNESS` e o dublê da foto ficam como estão. A ADR-0010 perde a consequência “modo falso obrigatório no local” na mesma mudança.

## Technical Context

**Language/Version**: TypeScript, Node.js e pnpm workspace.

**Primary Dependencies**: `@mastra/core` já em `packages/agent` (`createMastraLlm`), Zod em `packages/env` e `packages/contracts`, Fastify em `apps/api`. Nenhuma dependência nova.

**Storage**: Nenhuma migration. Confirmação e histórico continuam nas tabelas já usadas pela composição. O dublê de teste não persiste.

**Testing**: Vitest. Suíte de `packages/agent` e dos testes do assistente em `apps/api` sem `OPENAI_API_KEY` e sem rede (constitution V). Smoke com chave fica no [quickstart](./quickstart.md), manual.

**Target Platform**: API Node.js. Local, CI e produção.

**Project Type**: Monorepo — `packages/agent`, `packages/env`, `apps/api`, mais a revisão da ADR e dos textos de ambiente.

**Performance Goals**: Sem meta nova. O turno servido continua um `generate` com `maxSteps: 1` (RNF-006 não é reaberto).

**Constraints**:

- Sem chave, o processo não encerra (RNF-010).
- A chave não entra em spec, teste, log nem arquivo versionado (RNF-022).
- A CI não chama a OpenAI.
- `AGENT_HARNESS` em produção permanece.
- Foto não entra no prompt. O `execute` do Mastra continua só devolvendo argumentos.

**Scale/Scope**: um adaptador de LLM no servidor, um dublê de teste, os testes que hoje dependem do regex, e os documentos que ainda mandam subir no falso. Sem caso de uso novo em `core`.

## Constitution Check

_Gate inicial: PASS. Reavaliado após Phase 1: PASS._

| Princípio                        | Evidência no plano                                                                                                                                     | Resultado |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| I. Um núcleo, dois canais        | HTTP, Studio e webhook continuam no mesmo `processMessage` e no mesmo catálogo. A fatia não cria regra de negócio                                      | PASS      |
| II. Hexágono e fronteiras        | A OpenAI entra só pelo `LlmPort` em `packages/agent`, montado em `composition.ts`. `core` e `domain` não mudam. O dublê permanece para teste (RNF-067) | PASS      |
| III. Integridade financeira      | Confirmação antes de gravar permanece. O `execute` do Mastra não chama `core`                                                                          | PASS      |
| IV. Isolamento de tenant         | `companyId` continua vindo da sessão ou do `PeerDirectory`. Nada novo no corpo                                                                         | PASS      |
| V. Teste que prova comportamento | O merge prova o laço com `script()` e os centavos do caso de uso. A OpenAI fica fora da CI. Frase solta vira smoke manual                              | PASS      |
| Produto                          | Consulta livre e mutação com confirmação não mudam. Produção sem `AGENT_HARNESS` continua sem assistente                                               | PASS      |
| Segurança e privacidade          | A chave segue só em ambiente. O prompt não ganha a foto                                                                                                | PASS      |
| Integrações e operação           | Sem chave, ou com o provedor indisponível no boot, o resto da API sobe (RNF-010). O teto de IA não é reaberto                                          | PASS      |

Não há violação a justificar.

## Project Structure

### Documentation (this feature)

```text
specs/010-assistente-sempre-openai/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── disponibilidade-do-assistente.md
    └── llm-port.md
```

### Source Code (repository root)

```text
packages/agent/src/
├── fake-llm.ts                    # só script(); sem reconhecedor
├── mastra-llm.ts                  # inalterado no papel: classificar, execute identidade
├── create-runtime.ts              # default do dublê só quando o teste não injeta llm
├── process-message.ts             # foto e confirmação inalteradas
├── process-message.test.ts        # frases que hoje casam no regex passam a script()
└── studio/                        # relé permanece
packages/env/src/api.ts            # AGENT_PROVIDER sai do schema
apps/api/src/composition.ts        # chave presente → Mastra; ausente → runtime null
docs/decisoes/adr/0010-mastra-e-gpt-4o-mini.md
docs/arquitetura/integracoes/mastra.md
packages/agent/README.md
.env.example
.env.production.example
docs/engenharia/ambientes.md
docs/engenharia/setup.md
```

**Structure Decision**: a escolha do provedor mora na composição da API. O pacote `agent` guarda a porta, o Mastra e o dublê de teste. Não há rota nova nem tabela nova.

## Implementation Outline

1. **Dublê** — apagar `reconhecerConsulta`, `reconhecerMutacaoNr117`, recusas por regex e os auxiliares de data e centavos em `fake-llm.ts`. `decide` olha o mapa de `script()` e, sem entrada, devolve `{ type: 'unknown' }`. `history` continua aceito e ignorado.
2. **Testes do laço** — cada caso que hoje manda uma frase e espera uma tool sem `script()` passa a gravar a decisão. O bloco que prova o dicionário de frases sai. Casos de confirmação, "sim", TTL e centavos ficam, com a tool já decidida.
3. **Ambiente** — remover `AGENT_PROVIDER` de `packages/env`. Testes de env deixam de esperar default `fake`. Chave ausente não é erro de parse.
4. **Composição** — `motivoDoAgenteIndisponivel`: produção sem `AGENT_HARNESS` continua indisponível; sem `OPENAI_API_KEY` o assistente fica indisponível em qualquer ambiente; com chave e porteiro aberto, `criarLlmDoAgente` chama `createMastraLlm`. O ramo que construía `FakeLlm` no servidor sai.
5. **Testes da API** — `composition.test.ts`, `agent.test.ts`, `studio.test.ts` e os e2e que fazem `stubEnv('AGENT_PROVIDER', 'fake')` deixam de ligar um modo falso. Runtime de teste recebe o dublê por `createAgentRuntime({ llm })`. O caso “fake em produção é barrado” vira “sem chave não monta” e “produção sem harness não monta mesmo com chave”.
6. **Studio** — sem mudança de relé. Sem chave, `montarStudio` já não monta porque o motivo do assistente está definido.
7. **Documentos** — revisão parcial no topo da ADR-0010; `mastra.md`, README do agent, exemplos de ambiente e `ambientes.md` / `setup.md` deixam de mandar `AGENT_PROVIDER=fake`.

## Complexity Tracking

Nenhuma exceção à constitution é necessária.
