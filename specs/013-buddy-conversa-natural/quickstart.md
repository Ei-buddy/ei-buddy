# Quickstart: Buddy com conversa natural

**Feature**: 013-buddy-conversa-natural
**Spec**: [spec.md](./spec.md) · **Contract**: [buddy-runtime.md](./contracts/buddy-runtime.md) · **Data model**: [data-model.md](./data-model.md)

Guia de validação ponta a ponta. Detalhes de interface ficam no contrato; aqui
só o que rodar e o que esperar.

## Pré-requisitos

- Node + pnpm do monorepo; `pnpm install` feito.
- Para a CI e os testes locais: nada além do repo. O laço roda com
  `MastraLanguageModelV2Mock`, sem rede.
- Para a avaliação e o teste manual: `OPENAI_API_KEY` e
  `AGENT_MODEL=openai/gpt-5.4-mini` no `.env` (o `.env` atual de quem testou
  aponta para `openai/gpt-4`; atualize).
- Para o teste manual no WhatsApp: API, ngrok e webhook Meta como hoje
  (`npm run dev` e `ngrok http 3333`).

## 1. CI determinística

```bash
pnpm --filter @na-regua/agent test
pnpm --filter @na-regua/api test
pnpm typecheck && pnpm lint && pnpm boundaries && pnpm format:check
```

Deve passar, com o modelo dublê, a matriz abaixo:

| #   | Cenário                                                  | Esperado                                                                | Requisitos     |
| --- | -------------------------------------------------------- | ----------------------------------------------------------------------- | -------------- |
| 1   | Consulta de estoque com localização vazia                | Resposta sem `ref`, sem `PROD-…`, sem “localização”                     | FR-002, FR-006 |
| 2   | Modelo responde com UUID                                 | Retry uma vez; se persistir, trecho removido                            | FR-004         |
| 3   | Venda sem pagamento                                      | Nenhuma `PendingConfirmation` criada                                    | FR-007, FR-009 |
| 4   | Venda sem preço e quantidade                             | Proposta com preço de tabela e qtd 1; `assumido` preenchido             | FR-008         |
| 5   | Pendente + “fechou”                                      | `accepted`; caso de uso chamado com os `args` guardados                 | FR-013, FR-015 |
| 6   | Pendente + “não, são 3” / “pode, mas no pix”             | `accept_proposal` devolve `nao_e_aceite`; caso de uso **não** chamado   | FR-016         |
| 7   | Pendente vencida + “sim”                                 | `expired`; nada gravado                                                 | FR-018         |
| 8   | Pendente + mudança de assunto                            | `rejected` ao fim da mensagem                                           | FR-017         |
| 9   | Mesmo aceite executado duas vezes                        | Um registro (idempotência `confirmation:{id}`)                          | FR-022         |
| 10  | Perfil sem escrita aceita                                | `recusado`; nada gravado                                                | FR-021         |
| 11  | “ele” com cliente no resumo                              | Tool chamada com o `ref` do cliente                                     | FR-023         |
| 12  | Janela `idle`                                            | Resumo vazio enviado ao modelo                                          | FR-025         |
| 13  | Empresa A e B                                            | Resumo e tools de A nunca veem dado de B                                | FR-026         |
| 14  | `find_customer` não encontrado → cadastro aceito → venda | Intenção do snapshot retomada; nova proposta de venda na mesma conversa | FR-028, FR-030 |
| 15  | Fiado sem cliente                                        | Opção “sem cliente” não oferecida; schema recusa                        | FR-028         |
| 16  | `AppError` na gravação                                   | `recusado` com mensagem humana, sem `path`                              | FR-034         |
| 17  | `generate()` lança                                       | Frase fixa; nada gravado                                                | FR-035         |
| 18  | Pedido que exigiria 6 etapas                             | Etapa 5 sem tool; texto de saída elegante                               | FR-036         |
| 19  | Foto                                                     | Pedido de texto; modelo não chamado                                     | FR-042         |
| 20  | Uso de IA                                                | `aiUsage.record` com `steps.length`; sem teto → nunca bloqueia          | FR-039, FR-040 |
| 21  | Mesma conversa por WhatsApp, app e Studio                | Mesma sequência de tools e mesmo `kind`                                 | FR-038         |

## 2. Avaliação com o modelo real (antes de liberar)

```bash
OPENAI_API_KEY=... pnpm --filter @na-regua/agent eval
```

Roda as conversas de `packages/agent/eval/` contra `AGENT_MODEL`, sobre uma loja
em memória. Cada conversa tem asserções determinísticas e grava a transcrição
para leitura humana do tom.

Conversas obrigatórias (uma por fluxo da spec):

1. Caso do João: “O João quer comprar café” → oferece cadastro → “cadastra” →
   aceite → retoma a venda → “pix” → proposta → “fechou” → venda gravada.
2. Referência: cita o João, depois “ele quer comprar 2 cafés”.
3. Correção: proposta de 1 café → “não, são 3” → nova proposta → “fechou”.
4. Pedido incompleto: “adicione café”.
5. Consulta: “quanto tem de café?”.
6. Fora do escopo: “me conta uma piada”.
7. Recusa: “importa meu extrato”.
8. Erro de regra: produto com preço abaixo do custo.

Aprovação: SC-001 a SC-006 e SC-009 da spec atendidos no conjunto. A
transcrição é anexada ao PR de liberação.

## 3. Teste manual no WhatsApp

Com a API rodando e o webhook apontado, repita as conversas 1, 2 e 3 pelo
WhatsApp e confira:

- nenhuma mensagem com código interno, nome de campo ou centavos;
- a venda do João aparece na web (Histórico de vendas) com os dados aceitos;
- o cliente João aparece na lista de clientes;
- uma foto recebe o pedido de texto.

O roteiro `docs/qa/buddy-roteiro-de-prompts.md` passa a listar essas conversas
como base da avaliação.
