# Data model: assistente servido sempre pela OpenAI

**Date**: 2026-10-01  
**Spec**: [spec.md](./spec.md)

Não há entidade nova, tabela nova nem campo novo. O que muda é qual implementação da porta sobe no processo, e o que o dublê ainda guarda.

## Porta `LlmPort`

Já definida em `packages/agent/src/types.ts`. Esta fatia não altera o formato da decisão.

| Campo de `decide` | Regra                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `text`            | Frase do turno                                                                              |
| `tools`           | Descritores do catálogo já montado                                                          |
| `today`           | Dia civil do contexto                                                                       |
| `history`         | Até 12 turnos. O dublê ignora. O Mastra continua recebendo o prefixo compacto que já existe |

| `LlmDecision`                  | Quando                                                                    |
| ------------------------------ | ------------------------------------------------------------------------- |
| `{ type: 'tool', name, args }` | O modelo escolheu uma tool, ou o teste gravou isso no `script()`          |
| `{ type: 'text', text }`       | O modelo respondeu sem tool. O laço trata como esclarecimento             |
| `{ type: 'unknown' }`          | Sem tool e sem texto. No dublê, também é o resultado de frase sem roteiro |

## Dublê de teste

Estado em memória, por instância, vida só do teste.

| Estado                                 | Regra                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| Mapa `texto normalizado → LlmDecision` | Único estado. `script()` grava. `decide()` lê. Sem entrada, `unknown`               |
| Reconhecedor de frases                 | Sai. Não há transição por regex, data de vencimento nem centavos parseados do texto |

Normalização da chave do mapa permanece a que o `script()` já usa (trim, minúsculas, sem acento), para os roteiros atuais continuarem casando.

## Processo que serve

| Condição                                      | Runtime do assistente                                              |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `NODE_ENV=production` e `AGENT_HARNESS` falso | Ausente. 503                                                       |
| `OPENAI_API_KEY` ausente ou vazia             | Ausente. 503. Vale em local, Studio e produção                     |
| Chave presente e porteiro aberto              | `createMastraLlm` com `AGENT_MODEL` (default `openai/gpt-4o-mini`) |

`AGENT_PROVIDER` não é mais campo do ambiente parseado.

## O que não muda

| Peça                  | Estado                                                       |
| --------------------- | ------------------------------------------------------------ |
| Confirmação pendente  | Mesma tabela e a mesma máquina. "Sim" não passa pelo modelo  |
| Histórico da conversa | Tabelas da ADR-0016. Janela 12                               |
| Catálogo de tools     | Mesmos ids. `mutatesValue` continua decidindo se há proposta |
| Tool no Mastra        | Mesmo id e mesmo Zod. `execute` devolve o input              |
| Foto                  | `FakeBarcodeDecoder`. Bytes de fixture, não imagem de câmera |
| Teto de IA            | Contador em memória já existente. Estouro não chama modelo   |
| `WHATSAPP_PROVIDER`   | `fake` \| `meta`, default `fake`                             |
