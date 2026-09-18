# worker

BullMQ — filas e jobs agendados.

**Estado:** 🟡 conecta, registra as filas e loga falha de job · `NR-041`;
consumidor `conversation-purge` (NR-062)

## Responsabilidade

Executar o que não pode acontecer no caminho síncrono: emitir nota, enviar
mensagem, varrer inadimplentes, importar extrato, processar webhook.

**O que não faz:** regra de negócio. Um consumidor de fila é tão fino quanto um
handler HTTP — desempacota o job, monta o contexto, chama o caso de uso.

## Fronteiras

|                       |                                           |
| --------------------- | ----------------------------------------- |
| **Depende de**        | `core`, `contracts`, `money`              |
| **Composição apenas** | `db` e adapters, só na raiz de composição |
| **Proibido**          | importar `domain`; ter lógica de negócio  |

## Filas

| Fila                 | O quê                                                                                                                                                | Requisito                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `invoice-issue`      | emissão fiscal assíncrona                                                                                                                            | [RNF-004](../../docs/produto/requisitos-nao-funcionais.md) |
| `whatsapp-send`      | cobrança, comprovante, catálogo                                                                                                                      | RF-048, RF-068                                             |
| `charge-overdue`     | varredura diária de recebíveis vencidos                                                                                                              | RF-071                                                     |
| `bank-sync`          | importação periódica de extrato                                                                                                                      | RF-074                                                     |
| `webhook-process`    | processa webhook após o 200 imediato                                                                                                                 | RNF-028                                                    |
| `conversation-purge` | expurgo de corpos de mensagem com mais de 30 dias (conversa órfã ganha `deleted_at`; não apaga venda). Consome `purgeConversationHistory` em `core`. | RNF-035 / NR-062                                           |

> **Nome de fila nunca usa `:`.** O BullMQ o reserva como separador de chave no
> Redis e recusa o nome em tempo de execução — `Queue name cannot contain :`.
> Convenção: `<domínio>-<ação>`.

## Observabilidade

Log em JSON com `queue`, `jobId` e `attempt` — o worker não tem requisição
HTTP, então é o job que correlaciona. `attempt` distingue uma falha que se
repete de falhas diferentes, que sem ele são indistinguíveis.

Falha de job sai em `error` com fila, id, tentativa e teto de tentativas —
[RNF-062](../../docs/produto/requisitos-nao-funcionais.md) exige que ela fique
visível, e "algo falhou" não é visibilidade.

> **URL de conexão nunca vai inteira para o log.** `REDIS_URL` e
> `DATABASE_URL` carregam usuário e senha no próprio texto. `safeUrl` deixa só
> protocolo, host e porta — [RNF-022](../../docs/produto/requisitos-nao-funcionais.md).

## Política padrão de job

```ts
{
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  removeOnFail: false,          // falha fica visivel — RNF-062
}
```

| Regra                                          | Requisito                                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Espera crescente entre tentativas              | [RNF-011](../../docs/produto/requisitos-nao-funcionais.md), [RF-130](../../docs/produto/requisitos-funcionais.md) |
| Toda fila tem descarte visível e reprocessável | [RNF-062](../../docs/produto/requisitos-nao-funcionais.md)                                                        |
| Job idempotente — pode rodar duas vezes        | reentrega é normal, não excepcional                                                                               |
| Alerta se a fila atrasar mais de 5 min         | [RNF-061](../../docs/produto/requisitos-nao-funcionais.md)                                                        |

`removeOnFail: false` é deliberado: job que falhou e sumiu é incidente que
ninguém investiga.

## Por que a emissão fiscal mora aqui

A venda **fecha antes da nota**. A SEFAZ é instável e o balcão não pode parar —
[RNF-004](../../docs/produto/requisitos-nao-funcionais.md). O caso de uso grava
a venda e enfileira; o worker emite e atualiza o estado. Se a SEFAZ estiver
fora, a nota entra em contingência e a venda continua válida.

## Variáveis de ambiente

`REDIS_URL`, `DATABASE_URL`, `LOG_LEVEL` e as dos adapters.

## Desenvolvimento

```bash
pnpm infra:up
pnpm --filter @na-regua/worker dev
pnpm infra:redis                       # inspecionar: KEYS bull:*
```
