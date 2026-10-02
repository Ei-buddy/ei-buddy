# Research: assistente servido sempre pela OpenAI

**Date**: 2026-10-01  
**Spec**: [spec.md](./spec.md)

As decisões abaixo fecharam na sessão de 2026-10-01, antes deste plano. Não resta `NEEDS CLARIFICATION`.

## 1. Quem interpreta a frase no processo que serve

**Decision**: com `OPENAI_API_KEY` e o porteiro aberto, a composição monta só `createMastraLlm`. O servidor não constrói `FakeLlm`. A variável `AGENT_PROVIDER` sai do schema. Um `.env` antigo que ainda tenha `AGENT_PROVIDER=fake` não muda o boot: o Zod do ambiente descarta chave desconhecida.

**Rationale**: o regex competia com o modelo e dava uma confiança que o `gpt-4o-mini` não tem. Produção já recusava `fake`. O default local `fake` era o que ainda servia o reconhecedor.

**Alternatives considered**:

- Manter `AGENT_PROVIDER=mastra` como opt-in e o falso como default: rejeitado na sessão.
- Chamar a OpenAI também na CI: rejeitado. A constitution V proíbe o adaptador real no merge, e o resultado do modelo flutua.
- Recusar o boot da API inteira sem chave: rejeitado. RNF-010 e o desenho atual da emissão fiscal sem `SECRETS_KEY` — o pedaço ausente desliga a própria rota.

## 2. O que sobra do dublê

**Decision**: `FakeLlm` fica para teste, com `script(texto, decisao)` e nada mais. `decide` sem roteiro devolve `{ type: 'unknown' }`. `createAgentRuntime` sem `llm` pode continuar nesse dublê; a composição da API não usa esse default para servir mensagem.

**Rationale**: o `script()` fixa a intenção para provar que o "sim" grava o centavo certo. Isso não finge português. Os testes que hoje escrevem "quanto vendi hoje?" ou "lança aluguel 1800 vence dia 10" e esperam uma tool passam a gravar essa decisão no roteiro. O bloco que afirma o dicionário de frases sai.

**Alternatives considered**:

- Apagar a classe e escrever um stub anônimo em cada teste: rejeitado. O mapa de roteiro já é o stub, e dezenas de testes o usam.
- Conservar o regex só para consultas e recusas: rejeitado. A sessão tirou o reconhecedor inteiro, inclusive mutação da NR-117.

## 3. Studio

**Decision**: o agent `studio-harness` e o `StudioRelayModel` permanecem. O relé não chama a OpenAI. Com chave, a única chamada do turno é o `decide()` dentro de `processMessage`. Sem chave, o Studio não monta, porque `montarStudio` já exige `motivoDoAgenteIndisponivel() === undefined`.

**Rationale**: a NR-046 ainda não fechou o aceite no chip. O painel é a tela de conversa de engenharia. O relé existe para o chat do Studio não fazer um segundo `generate`.

**Alternatives considered**:

- Remover relé, presets e `/api/agents`: rejeitado na sessão.
- Fazer o painel chamar a OpenAI no relé e de novo no laço: rejeitado. Dobro de token e de latência, contra o RNF-006 do harness.

## 4. Duas cópias da tool

**Decision**: não mexer. `createMastraLlm` registra cada tool com `execute` que devolve o input. `maxSteps` continua 1. O catálogo em `catalog.ts` é quem chama `core`, e só depois do "sim" quando `mutatesValue`.

**Rationale**: o `generate` do Mastra dispara `execute` ao tool-call. Se esse `execute` fosse o caso de uso, a gravação aconteceria antes da confirmação.

**Alternatives considered**:

- Um único laço Mastra executando a tool: rejeitado nesta fatia. É outro projeto e não destrava a saída do regex.

## 5. Foto do código de barras

**Decision**: `tratarFoto` continua antes de `decide()`, com `FakeBarcodeDecoder`. A imagem não entra no prompt. Leitor de barras local fica fora.

**Rationale**: a spec da NR-116 já recusou deixar o modelo escolher a rota da foto. Um modelo de visão erra dígito; o cadastro é consultado pelo código exato, a mesma regra do aplicativo. A foto sairia para a OpenAI em todo item de balcão.

**Alternatives considered**:

- Enviar a imagem ao modelo para ler o EAN: rejeitado na sessão.
- Entregar um decodificador de imagem nesta mesma mudança: rejeitado. Dependência nova e outro aceite.

## 6. Porteiro de produção e teto

**Decision**: `NODE_ENV=production` sem `AGENT_HARNESS=1` continua sem assistente, mesmo com chave. O teto mensal continua respondendo `TEXTO_TETO_IA` sem chamar modelo e sem cair num falso. `WHATSAPP_PROVIDER` não muda.

**Rationale**: abrir produção é a FR-001b, não esta limpeza. O código do teto já não degrada para `FakeLlm` — a pesquisa antiga da NR-060 sugeria isso; o laço não faz isso. Não “corrigir” na direção do falso.

**Alternatives considered**:

- Tratar chave presente como licença para servir em produção: rejeitado. O porteiro permanece.
- Incluir o adapter Meta: rejeitado. NR-046.

## 7. Rastro da decisão

**Decision**: revisão parcial no topo da ADR-0010, no mesmo estilo das revisões de 2026-09-16 (RAG e Studio). Não abre ADR nova nem NR nova. O texto que sai é “modo `AGENT_PROVIDER=fake` continua obrigatório no local”. Entram no mesmo PR: `docs/arquitetura/integracoes/mastra.md`, README de `packages/agent`, `.env.example`, `.env.production.example`, `docs/engenharia/ambientes.md` e `docs/engenharia/setup.md`.

**Rationale**: decisão tomada e não escrita na ADR não foi tomada (constitution, documentação e rastreabilidade). A constitution em si não muda: o adaptador falso na CI continua obrigatório.

**Alternatives considered**:

- Só mudar código e README do pacote: rejeitado. A ADR ainda mandaria o local subir no falso.
