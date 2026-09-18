# Contract: tools de consulta NR-115

**Feature**: NR-115  
**Package**: `@na-regua/agent`  
**Norma**: todo input de tool vem de schema exportado por
`@na-regua/contracts`. A tool não acessa persistência: chama caso de uso de
`@na-regua/core` com o `ExecutionContext` já resolvido.

## Comportamento comum

```text
LLM decide uma tool + argumentos validados
  → processMessage executa a leitura sem confirmação
  → tool chama core com ExecutionContext
  → formatReply só apresenta dados determinísticos de core
```

| Regra       | Contrato                                                                             |
| ----------- | ------------------------------------------------------------------------------------ |
| Efeito      | Todas as tools abaixo têm `mutatesValue: false`                                      |
| Tenant      | `companyId` não é argumento; vem do contexto autenticado                             |
| Confirmação | Nenhuma leitura cria ou consome pendência                                            |
| Dinheiro    | Valores chegam de `core` em centavos; o agente apenas formata                        |
| Falha       | Ausência, ambiguidade ou indisponibilidade gera resposta clara, nunca dado inventado |
| Turno       | O contrato suporta uma tool por mensagem                                             |

## `check_stock`

| Item                | Contrato                                                            |
| ------------------- | ------------------------------------------------------------------- |
| Input               | `{ query: string }`, texto não vazio da busca de produto            |
| Dependência `core`  | busca de produto seguida de `checkStock` para correspondência única |
| Resposta de sucesso | nome, saldo, preço e localização                                    |
| Sem controle        | resposta explícita “sem controle de estoque”; não usar zero         |
| Sem candidato       | informar que produto não foi encontrado                             |
| Vários candidatos   | pedir que a lojista especifique ou escolha                          |

O input deve ser um schema de contracts dedicado à busca textual. A saída usada
para formatar é a visão existente de estoque, não o resultado intermediário de
busca.

## `list_payables`

| Item                | Contrato                                                                           |
| ------------------- | ---------------------------------------------------------------------------------- |
| Input               | objeto estrito vazio                                                               |
| Dependência `core`  | `listPayables`                                                                     |
| Referência temporal | `ctx.now`                                                                          |
| Resposta de sucesso | vencidas, hoje, semana e mês, com totais; vencidas em destaque                     |
| Depois do mês       | se houver, informar o total adicional, sem misturar aos quatro grupos obrigatórios |
| Sem itens           | declarar explicitamente que não há vencimentos                                     |

## `check_customer_wallet`

| Item                | Contrato                                                                        |
| ------------------- | ------------------------------------------------------------------------------- |
| Input               | `{ query: string }`, texto não vazio de nome ou identificação de cliente        |
| Dependência `core`  | resolução limitada de cliente por consulta, seguida de leitura de saldo         |
| Resposta de sucesso | nome do cliente e saldo em carteira                                             |
| Saldo zero          | declarar explicitamente que o cliente não tem saldo devedor                     |
| Sem candidato       | informar que cliente não foi encontrado                                         |
| Vários candidatos   | retornar alternativas distinguíveis; não revelar saldo até a escolha inequívoca |

## Testes de contrato

1. Todo input inválido é rejeitado antes de `core`.
2. As três tools permanecem de leitura e não produzem `PendingConfirmation`.
3. Produto sem controle, conta sem vencimento e saldo zero preservam suas
   distinções semânticas.
4. Nome ambíguo devolve alternativas, sem chamar a leitura de saldo de nenhum
   candidato.
5. Com duas empresas, uma tool não encontra dados pertencentes à outra.
