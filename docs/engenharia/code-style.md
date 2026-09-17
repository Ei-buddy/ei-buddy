# Code style

Formatação, nomenclatura e — o mais importante — **as fronteiras entre módulos
verificadas automaticamente**.

---

## Idioma

| O quê                                                | Idioma                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| Documentação, comentário, mensagem de commit         | **PT-BR**                                                      |
| Identificador, tipo, arquivo, pasta                  | **inglês**                                                     |
| Tabela, coluna, endpoint, variável de ambiente, fila | **inglês**                                                     |
| Mensagem de log                                      | inglês                                                         |
| Mensagem exibida ao usuário                          | **PT-BR** ([RNF-057](../produto/requisitos-nao-funcionais.md)) |

O [glossário](../produto/glossario.md) mapeia cada termo de negócio PT-BR para
o identificador em inglês correspondente. **Um termo, um identificador.** Se
você precisa nomear algo que não está lá, adicione no mesmo PR.

## Formatação

Prettier, configuração única na raiz ([`.prettierrc.json`](../../.prettierrc.json)):
sem ponto e vírgula, aspas simples, 100 colunas, vírgula final.

```bash
pnpm format         # formata
pnpm format:check   # verifica (é o que a CI roda)
```

Formatação **não se discute em revisão**. É automática, roda no `pre-commit`, e
não é assunto de PR. Quem abre o PR (humano ou agente) ainda assim **roda
`pnpm format:check` antes do push** — a job Verificar da CI é o mesmo comando
e já reprovou PR por markdown/ts fora do Prettier. Ver
[`.cursor/rules/pr-formatacao.mdc`](../../.cursor/rules/pr-formatacao.mdc).

Mais [`.editorconfig`](../../.editorconfig) (o editor respeita sozinho) e
[`.gitattributes`](../../.gitattributes) (normaliza fim de linha).

## TypeScript

[`tsconfig.base.json`](../../tsconfig.base.json) é estrito de propósito:

| Opção                                   | Por quê                                         |
| --------------------------------------- | ----------------------------------------------- |
| `strict`                                | o básico                                        |
| `noUncheckedIndexedAccess`              | `array[0]` é `T \| undefined`, porque é mesmo   |
| `exactOptionalPropertyTypes`            | distingue "ausente" de "presente e `undefined`" |
| `noUnusedLocals` / `noUnusedParameters` | código morto não entra                          |
| `verbatimModuleSyntax`                  | import de tipo é explícito                      |
| `isolatedModules`                       | cada arquivo transpila sozinho                  |

> Esse rigor **já pegou um bug real** durante a montagem do workspace:
> `exactOptionalPropertyTypes` barrou um `version: string | undefined` sendo
> atribuído a uma propriedade opcional em `packages/db`. Custou 30 segundos ali;
> custaria uma tarde de depuração em produção.

### Regras

| Regra                                                           | Motivo                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| `any` é proibido; use `unknown` e estreite                      | `any` desliga o compilador exatamente onde ele mais serviria |
| Sem `as` para forçar tipo; use validação com Zod                | `as` é uma mentira que o compilador acredita                 |
| Sem `!` (non-null assertion), salvo com comentário justificando | —                                                            |
| `type` para forma de dado, `interface` para porta implementável | consistência                                                 |
| Toda função exportada tem tipo de retorno explícito             | evita vazar tipo inferido por acidente                       |
| Erro tipado, nunca `throw new Error(string)` solto no domínio   | quem chama precisa poder tratar                              |

## Nomenclatura

Convenções completas no [glossário](../produto/glossario.md#convenções-de-nomenclatura).
Resumo:

| Elemento             | Convenção                    | Exemplo                    |
| -------------------- | ---------------------------- | -------------------------- |
| Tipo, classe, schema | `PascalCase`                 | `SaleItem`                 |
| Função, variável     | `camelCase`                  | `netAmount`                |
| Arquivo, pasta       | `kebab-case`                 | `sale-item.ts`             |
| Tabela, coluna       | `snake_case`, tabela plural  | `sale_items`, `net_amount` |
| Variável de ambiente | `SCREAMING_SNAKE_CASE`       | `DATABASE_URL`             |
| Endpoint             | `kebab-case`, recurso plural | `POST /v1/sales`           |
| Fila                 | `<domínio>-<ação>`           | `invoice-issue`            |
| Evento de domínio    | `PascalCase` no passado      | `SaleRegistered`           |
| Booleano             | prefixo `is` / `has` / `can` | `isOverdue`                |

### Nomes proibidos

| Não use                                     | Use                        | Por quê                                    |
| ------------------------------------------- | -------------------------- | ------------------------------------------ |
| `Client` para cliente da loja               | `Customer`                 | `Client` é cliente HTTP                    |
| `Order`                                     | `Sale`                     | não existe pedido separado de venda no MVP |
| `Bot`, `Chatbot`                            | `Agent`                    | o produto não é bot de atendimento         |
| `Tenant`, `Organization`                    | `Company`                  | um nome só para a mesma coisa              |
| `price` sem qualificador                    | `salePrice`, `costPrice`   | ambíguo                                    |
| `amount` sem qualificador                   | `grossAmount`, `netAmount` | ambíguo sobre o que está incluso           |
| `data`, `info`, `manager`, `helper`, `util` | o nome do que a coisa é    | não significam nada                        |

Nome de fila **nunca** usa `:` — o BullMQ reserva o caractere como separador de
chave no Redis e recusa em tempo de execução. (Descoberto do jeito difícil.)

---

## Fronteiras de dependência

**A parte mais importante deste documento.**

A [matriz de imports](../arquitetura/principios.md#matriz-de-imports-permitidos)
não é uma recomendação: é código, em
[`.dependency-cruiser.cjs`](../../.dependency-cruiser.cjs), e roda na CI
([RNF-065](../produto/requisitos-nao-funcionais.md)).

```bash
pnpm boundaries
```

### As regras

| Regra                        | Barra                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `domain-sem-io`              | `packages/domain` importando banco, rede, framework ou qualquer outro pacote além de `money`           |
| `handler-nao-importa-db`     | qualquer arquivo de `apps/api` ou `apps/worker` importando `@na-regua/db` **fora de `composition.ts`** |
| `app-nao-importa-domain`     | app chamando cálculo direto, pulando `core`                                                            |
| `adapter-nao-importa-core`   | adapter conhecendo `core` — a seta tem que apontar para dentro                                         |
| `cliente-nao-importa-nucleo` | `mobile` ou `web` importando `core`, `db` ou `domain`                                                  |
| `sem-ciclo`                  | dependência circular                                                                                   |

### Por que isso importa mais do que parece

A promessa do produto é que **app e WhatsApp acionam exatamente as mesmas
regras**. Isso não sobrevive à disciplina individual: basta um handler consultar
o banco direto, uma vez, com pressa, e a regra passa a existir só naquela rota —
o canal WhatsApp deixa de aplicá-la, e ninguém percebe até o número não bater.

A verificação de fronteira é o que transforma essa promessa em propriedade
estrutural. **Não desative para "destravar" um PR.**

### A única exceção

A **raiz de composição** (`apps/api/src/composition.ts` e o equivalente no
worker) pode importar `db` e os adapters, porque alguém precisa montar o grafo
de dependências. Se esse import vazar para fora do arquivo, a regra dispara — e
está certa.

### Verificado, não presumido

A regra foi testada com um arquivo que a viola de propósito:

```
error handler-nao-importa-db: apps/api/src/__violacao_temporaria.ts → packages/db/src/index.ts
```

Uma regra que nunca disparou é uma regra que talvez não funcione.

---

## Organização de arquivos

```
packages/<modulo>/
├── src/
│   ├── index.ts          API PUBLICA — a unica coisa que outros importam
│   ├── <conceito>.ts
│   ├── <conceito>.test.ts   teste ao lado do codigo
│   └── internal/         detalhe interno, nunca exportado no index
├── package.json
├── tsconfig.json
└── README.md             documentacao do modulo (obrigatoria)
```

| Regra                                           | Motivo                                                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/index.ts` é a **única** superfície pública | import profundo (`@na-regua/core/src/internal/x`) é proibido — [RNF-071](../produto/requisitos-nao-funcionais.md) |
| Teste ao lado do código, `.test.ts`             | some junto quando o código some                                                                                   |
| Barrel file só no `index.ts` do pacote          | barrel interno cria ciclo e atrapalha tree-shaking                                                                |
| Um conceito por arquivo                         | `sale.ts` tem `Sale`, não `Sale` + `Customer` + `Product`                                                         |

## Comentários

Comente **por quê**, não o quê. O código já diz o quê.

```ts
// ❌ inútil
// soma os itens
const total = items.reduce(...)

// ✅ diz o que o código não consegue dizer
// O resto da divisão vai para as primeiras parcelas para que a soma seja
// exatamente o total — RNF-045. Distribuir na última faria a ultima parcela
// destoar, e e ela que o cliente lembra.
```

Comentário que cita um `RF-xxx`, `RNF-xxx`, `DEC-xxx` ou ADR vale muito: liga o
código à razão de ele existir. Use.

**Comentário desatualizado é pior que comentário ausente** — ele mente com
autoridade. Se mudou o código, mude o comentário no mesmo diff.

## Tratamento de erro

| Regra                                           | Motivo                                                         |
| ----------------------------------------------- | -------------------------------------------------------------- |
| Erro de negócio é tipo, não string              | quem chama precisa distinguir "sem estoque" de "sem permissão" |
| Nunca engolir erro em silêncio                  | `catch {}` vazio é bug esperando                               |
| Mensagem ao usuário diz o que fazer, sem jargão | [RNF-054](../produto/requisitos-nao-funcionais.md)             |
| Erro nunca expõe stack, SQL ou dado interno     | [`seguranca.md`](../arquitetura/seguranca.md)                  |
| Dado pessoal nunca em log                       | [RNF-034](../produto/requisitos-nao-funcionais.md)             |

## Documentos relacionados

- [Princípios](../arquitetura/principios.md) — o raciocínio por trás das fronteiras
- [Glossário](../produto/glossario.md) — a nomenclatura completa
- [Testes](testes.md) — o que testar em cada camada
- [Git workflow](git-workflow.md) — como isso vira commit e PR
