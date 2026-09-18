# Data Model: consultas conversacionais (NR-115)

**Date**: 2026-09-18  
**Spec**: [spec.md](./spec.md)

Esta fatia não cria entidade de conversa nem de confirmação: reutiliza a
identidade e o contexto da NR-062. Acrescenta consultas de leitura e, se
confirmada a lacuna na implementação atual, os atributos persistidos necessários
para representar estoque não controlado e localização.

## Product inventory view (reuso e complemento)

Visão canônica retornada por `checkStock` para um produto da empresa.

| Campo          | Tipo / origem       | Regras                                                                               |
| -------------- | ------------------- | ------------------------------------------------------------------------------------ |
| productId      | UUID                | Produto pertencente à empresa do contexto                                            |
| name           | texto               | Nome exibido para confirmar o produto consultado                                     |
| salePriceCents | inteiro em centavos | Valor já decidido pelo núcleo; agente só formata                                     |
| stock          | inteiro ou ausente  | `0` significa estoque controlado zerado; ausente significa “sem controle de estoque” |
| location       | texto opcional      | Localização cadastrada; ausente é exibida como indisponível                          |
| tracksStock    | booleano derivado   | Verdadeiro quando há controle; nunca inferir controle de `stock = 0`                 |

**Validation rules**:

- A busca por texto produz zero, uma ou várias candidaturas, sempre da empresa
  do contexto.
- Só uma candidatura permite a consulta final; zero informa ausência, várias
  pedem escolha.
- Se a persistência atual ainda não representar `tracksStock` ou `location`, a
  migração e os adapters desta tarefa devem persistir esses atributos.

## Payables summary (reuso)

Visão de contas a pagar abertas produzida por `listPayables` no instante
`ctx.now`.

| Campo      | Tipo / origem            | Regras                                                              |
| ---------- | ------------------------ | ------------------------------------------------------------------- |
| overdue    | grupo de títulos + total | Vencimento anterior ao dia de referência; aparece em destaque       |
| today      | grupo de títulos + total | Vencimento no dia de referência                                     |
| week       | grupo de títulos + total | Vencimentos da semana segundo a regra já usada pelo app             |
| month      | grupo de títulos + total | Vencimentos no mês segundo a regra já usada pelo app                |
| later      | grupo de títulos + total | Depois do mês; resposta conversa informa total adicional se existir |
| hasOverdue | booleano                 | Sinal para destaque de vencidas                                     |

**Validation rules**:

- Somente títulos abertos ou parcialmente abertos participam.
- Totais são valores monetários já calculados por `core`.
- Uma visão sem títulos nos grupos solicitados gera confirmação explícita de que
  não há vencimentos, não uma lista sem texto.

## Customer wallet lookup (nova consulta de resolução)

Resultado limitado da busca segura de cliente antes de apresentar o fiado.

| Campo              | Tipo / origem       | Regras                                                                |
| ------------------ | ------------------- | --------------------------------------------------------------------- |
| query              | texto               | Nome ou identificação fornecida pela lojista                          |
| candidates         | lista limitada      | Zero, um ou mais clientes da empresa; cada alternativa é distinguível |
| customerId         | UUID                | Usado apenas após candidato único ou escolha explícita                |
| customerName       | texto               | Nome exibido no resultado ou na lista de alternativas                 |
| walletBalanceCents | inteiro em centavos | Saldo em carteira autoritativo do cliente                             |

**State transitions**:

```text
consulta por nome
  ├─ 0 candidaturas → “cliente não encontrado”
  ├─ 1 candidatura  → ler e informar walletBalanceCents
  └─ 2+ candidaturas → listar alternativas → aguardar escolha no contexto ativo
```

**Validation rules**:

- Nunca selecionar automaticamente candidato ambíguo.
- Saldo zero é uma resposta afirmativa (“saldo zerado”), não ausência.
- Todos os candidatos e o saldo pertencem à empresa de `ExecutionContext`.

## Conversational query (derivada)

Pedido de leitura ligado a uma conversa da empresa. Não é tabela nova.

| Campo        | Tipo                              | Regras                                      |
| ------------ | --------------------------------- | ------------------------------------------- |
| kind         | `stock` \| `payables` \| `wallet` | Uma consulta por turno                      |
| input        | texto de busca ou vazio           | Validado por schema de contracts            |
| conversation | chave existente da NR-062         | Preserva contexto para escolha posterior    |
| mutatesValue | falso                             | Nunca gera confirmação ou efeito de escrita |

## Relacionamentos

```text
Company 1 ──* Product inventory view
Company 1 ──* Payable ──> Payables summary
Company 1 ──* Customer ──> Customer wallet lookup
Company 1 ──* Conversation ──> Conversational query
```
