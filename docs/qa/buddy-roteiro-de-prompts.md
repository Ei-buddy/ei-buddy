# Roteiro de prompts — Buddy

Aceite manual no WhatsApp, conferido contra o banco e a web. Duas partes:

1. **Conversas (spec 013)** — como o Buddy conversa. Cada linha tem uma
   conversa automática equivalente em `packages/agent/eval/`, rodada com o
   modelo real por `pnpm --filter @na-regua/agent eval` antes de liberar
   ([quickstart](../../specs/013-buddy-conversa-natural/quickstart.md)).
2. **Capacidades (spec 012)** — o que o Buddy consulta e grava
   ([quickstart](../../specs/012-buddy-operacao-whatsapp/quickstart.md)).

Em todas as linhas vale: nenhuma resposta com código interno, nome de campo,
nome de ferramenta ou valor em centavos; até 3 linhas na maioria das respostas.

## 1. Conversas (spec 013)

| #   | Conversa          | Mensagens da dona                                                   | Esperado do Buddy                                                                                  | Conferir no banco / web                   | Avaliação                        |
| --- | ----------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------- |
| C1  | Caso do João      | “O João quer comprar café” → “cadastra” → “pode” → “pix” → “fechou” | Oferece cadastrar ou seguir sem cliente; retoma a venda sozinho; pergunta só o pagamento; confirma | Cliente João e uma venda de 1 café no pix | `eval/caso-do-joao.eval.ts`      |
| C2  | Referência        | “quanto o João deve?” → “ele quer comprar 2 cafés no pix”           | Entende que “ele” é o João; propõe sem pedir o nome                                                | Nada gravado até o aceite                 | `eval/referencia.eval.ts`        |
| C3  | Correção          | “vende um café pro Pedro no pix” → “não, são 3” → “fechou”          | Não grava na correção; refaz a proposta com 3; grava no “fechou”                                   | Uma venda com 3 cafés                     | `eval/correcao.eval.ts`          |
| C4  | Pedido incompleto | “adicione café”                                                     | Pede numa única mensagem descrição, unidade, custo e preço de venda; cita os opcionais             | Nenhum produto novo                       | `eval/pedido-incompleto.eval.ts` |
| C5  | Consulta          | “quanto tem de café?”                                               | Nome, quantidade e preço em reais; sem “localização indisponível”                                  | —                                         | `eval/consulta.eval.ts`          |
| C6  | Fora do escopo    | “me conta uma piada”                                                | Diz que não faz isso e dá até 3 exemplos do que faz                                                | Nada gravado                              | `eval/nao-e-erro.eval.ts`        |
| C7  | Recusa            | “importa meu extrato do banco”                                      | Diz que não faz por aqui, que nada foi feito e onde fazer                                          | Nada gravado                              | `eval/nao-e-erro.eval.ts`        |
| C8  | Erro de regra     | “cadastra feijão, unidade kg, custo 10 reais, vende a 8 reais”      | Explica que o preço de venda está abaixo do custo; não diz que gravou                              | Nenhum produto novo                       | `eval/nao-e-erro.eval.ts`        |
| C9  | Prazo da proposta | proposta → esperar mais de 5 min → “sim”                            | Diz que a proposta venceu e oferece refazer                                                        | Nada gravado                              | teste de CI                      |
| C10 | Foto              | enviar uma foto                                                     | Pede o pedido por texto                                                                            | Nada gravado                              | teste de CI                      |

## 2. Capacidades (spec 012)

| #   | Capacidade                                   | Endpoint                                           | Prompt                                                                                 | Resposta esperada                   | Conferir no banco                   | Conferir na web            |
| --- | -------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------- | -------------------------- |
| 1   | Vendas do período                            | `GET /sales`                                       | quanto vendi hoje?                                                                     | qtd/total/ticket; sem confirmação   | `sales` do dia                      | Histórico / painel do dia  |
| 2   | Período sem venda                            | `GET /sales`                                       | quanto vendi em [dia sem venda]?                                                       | sem ticket médio inventado          | zero linhas ou resumo zerado        | Totais zerados             |
| 3   | Resumo / faturamento                         | `GET /relatorios/dre` / meses                      | resumo do mês / faturamento                                                            | DRE ou meses; sem confirmação       | —                                   | Relatórios                 |
| 4   | Ranking                                      | `GET /relatorios/ranking/clientes` ou `produtos`   | ranking de clientes/produtos de [período]                                              | nomes/valores; sem confirmação      | —                                   | Ranking da tela            |
| 5   | Ranking sem período                          | —                                                  | ranking de clientes                                                                    | pergunta o período; nada consultado | —                                   | —                          |
| 6   | Histórico do cliente                         | `GET /sales?customerId=`                           | compras do João                                                                        | lista/histórico; sem confirmação    | vendas do cliente                   | Ficha → compras            |
| 7   | Estoque / contas / carteira / agenda / busca | rotas NR-115+                                      | quanto tem de X? / o que vence? / quanto o João deve? / agenda de hoje / busca produto | leitura ok; sem confirmação         | —                                   | Telas correspondentes      |
| 8   | Produto incompleto                           | —                                                  | adicione café                                                                          | pergunta o que falta; zero gravação | sem `products` novo                 | Catálogo inalterado        |
| 9   | Cadastro produto                             | `POST /produtos`                                   | cadastra café custo 10 vende 25 → sim                                                  | proposta e aceite; efeito único     | linha em `products`                 | Ficha do produto           |
| 10  | Preço < custo                                | `POST/PATCH /produtos`                             | cadastra/edita com venda < custo                                                       | recusa; zero gravação               | inalterado                          | —                          |
| 11  | Editar cliente                               | `PATCH /clientes/:id`                              | muda o telefone do João → sim                                                          | só telefone muda                    | `customers.phone`                   | Ficha cliente              |
| 12  | Editar produto                               | `PATCH /produtos/:id`                              | muda o preço do café para X → sim                                                      | preço novo, custo antigo            | `sale_price_cents`                  | Ficha produto              |
| 13  | Compra → venda                               | `POST /sales`                                      | lança a compra do João … → sim                                                         | venda (não recebível)               | venda criada                        | Histórico de vendas        |
| 14  | Soft-delete cliente/produto                  | `DELETE /clientes/:id` ou `/produtos/:id` (lógico) | apague o cliente/produto X → sim                                                       | diz que foi deletado; `deleted_at`  | `deleted_at` preenchido             | Some da lista vigente      |
| 15  | Apagar venda                                 | `POST /sales/:id/cancelar`                         | apague a venda Y → sim                                                                 | cancelamento; status cancelada      | status `cancelled`; linha permanece | Histórico mostra cancelada |
| 16  | Apagar conta/contato                         | —                                                  | apague a conta do banco / o contato                                                    | recusa; nada removido               | inalterado                          | —                          |
| 17  | Confirmação                                  | —                                                  | proposta → não / “pode, mas no pix” / sim após o prazo                                 | zero efeito                         | inalterado                          | —                          |
| 18  | Idempotência                                 | —                                                  | reentrega da mesma gravação após o aceite                                              | um registro                         | uma linha                           | —                          |
| 19  | Conta restrita                               | —                                                  | ranking + mutação com perfil leitura                                                   | leitura ok; escrita recusada        | inalterado na mutação               | —                          |
| 20  | Número sem cadastro                          | webhook WhatsApp                                   | mensagem de peer inválido                                                              | sem dado da loja                    | —                                   | —                          |

## Como rodar

1. API rodando com `OPENAI_API_KEY` e `AGENT_MODEL=openai/gpt-5.4-mini`, webhook
   do WhatsApp apontado (ou o harness Studio).
2. Rodar a avaliação automática: `pnpm --filter @na-regua/agent eval`. As
   transcrições ficam em `packages/agent/eval/.transcricoes/` e vão anexadas
   ao PR.
3. Passar as tabelas na ordem: conversa → conferir banco → conferir web.
