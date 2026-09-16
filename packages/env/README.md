# env

Configuração tipada. Valida `process.env` na inicialização de cada processo —
`NR-006`.

**Estado:** 🟢 `apps/api` e `apps/worker` · o resto da matriz de
[`ambientes.md`](../../docs/engenharia/ambientes.md) entra junto do adapter
que a consome

## Responsabilidade

`process.env` é `Record<string, string | undefined>`: nada garante que
`DATABASE_URL` exista, que `API_PORT` seja número, ou que `NODE_ENV` não tenha
um espaço sobrando de um copy-paste. Sem validação, o valor errado só aparece
na primeira vez que é usado — e às vezes um `?? 'valor-padrão'` esconde isso
para sempre, trocando "falha ao subir" por "comportamento errado em silêncio".
Foi o que acontecia com `REDIS_URL`: ausente, o processo caía de volta para
`redis://localhost:6379` sem avisar ninguém — inofensivo em dev, perigoso se
a mesma falta acontecer em staging ou produção.

Este pacote resolve isso com um schema Zod por aplicação. Cada app chama seu
`load*Env()` **uma vez, no topo do processo**, antes de subir qualquer coisa.
Se faltar variável obrigatória ou um valor não bater com o formato esperado,
o processo lança e não sobe — [ambientes.md](../../docs/engenharia/ambientes.md):
"aplicação falha ao subir se faltar variável obrigatória".

**O que não faz:** carregar `.env` em arquivo — isso é do runtime (`tsx
--env-file`, já usado por `api` e `worker`). Este pacote só valida o que já
está em `process.env` quando é chamado.

## Fronteiras

|                  |                           |
| ---------------- | ------------------------- |
| **Depende de**   | `zod`, nada do monorepo   |
| **Quem depende** | `apps/api`, `apps/worker` |

## Todos os problemas de uma vez

`parseEnv` usa `safeParse`, que acumula todas as falhas antes de devolver o
erro. A mensagem lista cada variável que falhou, de uma vez:

```
Configuracao invalida para @na-regua/api. Corrija o .env e tente de novo:
  - API_URL: API_URL precisa ser uma URL valida, ex.: http://localhost:3333
  - DATABASE_URL: DATABASE_URL e obrigatoria. Copie .env.example para .env ou rode `pnpm setup`.
```

Sem isso, cada boot revela uma variável faltando por vez, e corrigir o `.env`
vira um ciclo de tentativa e erro.

## Por que a matriz não está inteira aqui

`ambientes.md` lista variáveis para os adapters. Vários provedores já
fecharam (Asaas, Focus, Mastra, Meta Cloud API, Better Auth). Este pacote
valida o que os apps **de fato leem hoje**: exigir uma variável que nenhum
código consome ainda barraria o boot local por algo que não existe, na
direção oposta do "modo `fake`" que `ambientes.md` descreve.

O nome do provedor (`providerSchema`) aceita qualquer string não vazia, com
`fake` como padrão — nunca um enum com nomes de fornecedor. Quando um
adapter for implementado, o schema do app correspondente ganha as variáveis
dele, condicionadas ao provedor escolhido — não antes.

## Como usar

```ts
// apps/api/src/composition.ts — raiz de composicao, primeira linha do modulo
import { loadApiEnv } from '@na-regua/env'

export const env = loadApiEnv() // falha aqui, antes de qualquer I/O
```

```ts
// apps/worker/src/index.ts
import { loadWorkerEnv } from '@na-regua/env'

const env = loadWorkerEnv()
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
```

As chaves do objeto validado ficam `SCREAMING_SNAKE_CASE`, iguais ao nome real
da variável — `env.DATABASE_URL`, não `env.databaseUrl`. O objeto espelha o
`.env` de propósito, para ser buscável pelo mesmo nome nos dois lugares.

## Testes

Cobertura mínima: **80%**, mesma regra de `contracts` — o modo de falha que
importa aqui é aceitar um valor que deveria ser recusado, ou recusar um que
deveria passar.

## Variáveis de ambiente

Nenhuma. Este pacote _valida_ variáveis de ambiente; não lê nenhuma própria.
