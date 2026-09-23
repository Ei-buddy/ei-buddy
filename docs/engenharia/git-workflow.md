# Git workflow

Branches, commits, pull requests, merge e release.

**Leitura obrigatória antes do primeiro commit.** Metade destas regras é
verificada automaticamente ([enforcement](#enforcement)) — a outra metade
depende de você.

---

## Branching

### Modelo: duas branches longas, `dev` e `main`

| Branch | O que é                        | Deploy                         |
| ------ | ------------------------------ | ------------------------------ |
| `dev`  | onde o trabalho chega primeiro | **automático**, na VM de teste |
| `main` | o que está em produção         | **manual**, por tag ou disparo |

Branches de trabalho continuam curtas: **até 2 dias de vida, até ~400 linhas de
diff.** Elas saem de `dev` e voltam para `dev`. De `dev` para `main` vai um PR
de promoção, quando o que está lá foi testado.

**O que mudou, e por quê.** Este documento dizia "não existe `develop`", e a
razão era honesta na época: "nenhuma versão em produção". Agora há — e com ela
três motivos concretos para separar:

1. **produção pede consciência.** Atualizar o que está no ar é uma decisão, não
   um efeito colateral de um merge;
2. **teste precisa de lugar.** Sem um ambiente onde quebrar é barato, todo
   experimento vira risco de produção;
3. **a VM tem disco.** Build a cada commit na mesma máquina que serve o
   lojista é a forma mais previsível de encher o disco dela.

Note que `dev` **não é o `develop` do GitFlow**: não há branch de release nem
várias versões vivas. É uma branch de destino de deploy — o espelho do que está
na VM de teste. A crítica ao GitFlow no parágrafo acima continua valendo para o
que ela criticava.

### Nomenclatura

```
<tipo>/<ID>-<slug-curto>
```

```
feat/NR-042-carrinho-codigo-barras
fix/NR-003-arredondamento-parcela
chore/NR-007-workspace-pnpm
docs/NR-002-base-de-documentacao
hotfix/NR-046-webhook-whatsapp-500
```

| Parte    | Regra                                                            |
| -------- | ---------------------------------------------------------------- |
| `<tipo>` | um dos [tipos de commit](#tipos)                                 |
| `<ID>`   | id da tarefa no [ledger](../processo/task-ledger.md) e no Monday |
| `<slug>` | 2 a 5 palavras em kebab-case, minúsculas, sem acento             |

O `<ID>` é o que amarra **branch → PR → item do board** sem ninguém digitar
nada duas vezes. Validado por regex na CI.

### Ciclo de uma branch

```bash
git switch dev && git pull --rebase           # sempre parta da dev atualizada
git switch -c feat/NR-042-carrinho-codigo-barras
# ... commits ...
git push -u origin feat/NR-042-carrinho-codigo-barras
gh pr create --draft                          # draft desde o primeiro push
```

Para atualizar a branch com o que entrou na `dev`:

```bash
git pull --rebase origin dev
```

**Sempre rebase, nunca merge de `dev` para dentro da branch.** Merge polui o
histórico da branch e torna a revisão mais difícil.

### Promover `dev` para `main`

Um PR de `dev` para `main`, como qualquer outro — com a diferença de que ele
não introduz código novo: tudo ali já passou pela CI e já rodou na VM de teste.
O deploy de produção continua sendo um passo à parte, e manual.

### Hotfix

Sai da **tag de produção**, não da `main`:

```bash
git switch -c hotfix/NR-046-webhook-500 v0.4.2
```

Volta para a `main` por PR normal, com a mesma revisão de sempre. Urgência não
suspende revisão — ela só encurta a fila.

---

## Commits

[Conventional Commits 1.0.0](https://www.conventionalcommits.org/pt-br/).

```
<tipo>(<escopo>): <descrição>

<corpo: o porquê, não o quê>

Refs: NR-042
BREAKING CHANGE: <descrição>
```

### Tipos

| Tipo       | Quando                                   |
| ---------- | ---------------------------------------- |
| `feat`     | funcionalidade nova                      |
| `fix`      | correção de defeito                      |
| `docs`     | só documentação                          |
| `style`    | formatação, sem mudança de comportamento |
| `refactor` | reestrutura sem mudar comportamento      |
| `perf`     | melhora de desempenho                    |
| `test`     | adiciona ou corrige teste                |
| `build`    | build, dependências, workspace           |
| `ci`       | pipelines                                |
| `chore`    | manutenção que não entra em nenhum acima |
| `revert`   | reverte um commit anterior               |

### Escopos — lista fechada

Num monorepo é isto que dá valor real ao padrão: dá para ler o histórico de um
pacote só e gerar changelog por módulo.

```
api · worker · mobile · web
core · domain · contracts · db · agent
fiscal · whatsapp · banking · billing · payments · money · ui
infra · docs · repo
```

`repo` é para mudança que atravessa tudo (workspace, tooling). Escopo fora
desta lista é **rejeitado pelo commitlint** — `feat(pagamentos):` não passa,
porque o escopo tem que ser um módulo real.

### Regras

| Regra                                                | Exemplo                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| Cabeçalho ≤ 72 caracteres                            | —                                                               |
| Descrição no imperativo, minúscula, sem ponto final  | `registrar venda`, não `Registrou a venda.`                     |
| Nome próprio e sigla podem ter maiúscula **no meio** | `criar base de CI/CD com PagMaxx` ✅ · `Criar Base De CI/CD` ❌ |
| Corpo explica **por quê**, não o quê                 | o diff já mostra o quê                                          |
| `Refs: NR-xxx` obrigatório no rodapé                 | liga ao ledger e ao Monday                                      |
| Breaking change: `!` antes do `:` **e** rodapé       | `refactor(contracts)!:`                                         |

**Idioma da descrição: PT-BR**, coerente com a documentação. Tipos e escopos
são palavras-chave em inglês e não se traduzem. Ainda em confirmação —
[DEC-013](../decisoes/README.md#dec-013).

### Exemplos

```
feat(core): registrar venda com cálculo de líquido em contas a receber

O cálculo de custo, imposto e tarifa acontece em domain e o resultado
alimenta o recebível na mesma transação, para que app e WhatsApp produzam
exatamente o mesmo lançamento.

Refs: NR-042
```

```
fix(money): distribuir resto da divisão para a soma bater com o total

Money.parse('100.00').allocate(3) devolvia 33.33 três vezes, perdendo um
centavo. Agora o resto vai para as primeiras parcelas — RNF-045.

Refs: NR-003
```

```
refactor(contracts)!: renomear CreateSaleInput para RegisterSaleInput

Refs: NR-077
BREAKING CHANGE: o schema muda de nome e afeta api, agent e mobile.
```

---

## Pull Requests

### Título

O título do PR **segue exatamente o formato de commit** e é validado pela CI.

Motivo: usamos squash merge, e o squash usa o **título do PR** como mensagem
final do commit na `main`. Os commits dentro da branch ficam livres — faça WIP
à vontade; o que vale é o título.

### Merge: squash, sempre

| Configuração                 | Valor                       |
| ---------------------------- | --------------------------- |
| Squash merge                 | ✅ habilitado (única opção) |
| Merge commit                 | ❌ desabilitado             |
| Rebase merge                 | ❌ desabilitado             |
| Apagar branch ao mergear     | ✅                          |
| Histórico linear obrigatório | ✅                          |

Resultado: um commit por PR na `main`, histórico linear, `git log` legível.

### Revisão

| Regra                               | Detalhe                            |
| ----------------------------------- | ---------------------------------- |
| Aprovações necessárias              | 1                                  |
| Donos de código                     | `CODEOWNERS` mapeia as 3 trilhas   |
| **Mudança em `packages/contracts`** | **exige revisão das 3 trilhas**    |
| Draft PR desde o primeiro push      | dá visibilidade do que está em voo |

A exceção do `contracts` não é burocracia: ele é a fronteira que todas as
trilhas consomem, e um breaking change ali quebra as outras duas em silêncio —
é [o princípio 4](../arquitetura/principios.md#4-contracts-é-o-contrato-único)
que torna app e WhatsApp equivalentes.

### Checklist do PR

O [template](../../.github/PULL_REQUEST_TEMPLATE.md) traz um checklist
específico deste projeto:

- [ ] Título no formato de commit, com `Refs: NR-xxx`
- [ ] README do módulo atualizado, se o comportamento dele mudou
- [ ] Mudou `contracts`? avisei as outras trilhas
- [ ] Tem migration? é reversível ou tem plano de reversão ([RNF-048](../produto/requisitos-nao-funcionais.md))
- [ ] Variável de ambiente nova? entrou em [`ambientes.md`](ambientes.md) e no `.env.example`
- [ ] Tomei decisão de arquitetura? virou ADR ou `DEC`
- [ ] Dinheiro no diff? é `Money`, nunca `number` ([RNF-044](../produto/requisitos-nao-funcionais.md))

### Tamanho

Alvo: **≤ 400 linhas de diff**. Acima disso a revisão perde qualidade — não por
preguiça, mas porque a atenção humana não escala: PR grande recebe "LGTM" e
bug passa.

PR grande demais? Divida em: (1) refactor sem mudança de comportamento,
(2) a mudança em si, (3) testes e documentação.

---

## Versionamento e release

| Item             | Regra                                                             |
| ---------------- | ----------------------------------------------------------------- |
| Pacotes internos | `private: true`, versão fixa `0.0.0` — não publicamos em registry |
| Monorepo         | tag única `v0.x.y` (SemVer)                                       |
| `CHANGELOG.md`   | gerado dos Conventional Commits por `pnpm changelog`              |

### Como cortar um release

```bash
git switch main && git pull --rebase

pnpm changelog                 # confere o que entrou, ainda como "Não lançado"
pnpm changelog v0.4.0          # fecha a seção com a versão e a data

git add CHANGELOG.md
git commit -m "chore(repo): changelog da v0.4.0"

git tag -a v0.4.0 -m "v0.4.0"
git push origin main v0.4.0
```

**Qual número usar.** Enquanto estamos em `0.x`, a regra prática é: `fix` sozinho
sobe o patch; qualquer `feat` sobe o minor; `BREAKING CHANGE` também sobe o minor,
porque em `0.x` o major é reservado para a primeira versão estável.

**O que o script faz e o que não faz.** Ele lê os Conventional Commits desde a
última tag e agrupa por tipo e escopo. Não cria tag, não faz bump de versão em
`package.json` e não publica nada — os pacotes são privados e a versão deles é
fixa em `0.0.0` de propósito.

A referência da tarefa sai do rodapé `Refs:`, e **só dele**. Um `NR-xxx` citado
no meio do texto do commit não vira referência — senão "enquanto o NR-014 não
existe" atribuiria o commit ao NR-014.

Migrar para tags por aplicação (`api-v1.2.0`) quando os deploys deixarem de ser
sincronizados — [DEC-014](../decisoes/README.md#dec-014). Hoje seria cerimônia
sem retorno.

---

## Enforcement

Convenção sem automação vira folclore. O que é verificado sozinho:

| Onde                | Ferramenta                     | Barra o quê                                                                                           |
| ------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| local, `commit-msg` | husky + commitlint             | mensagem fora do padrão                                                                               |
| local, `pre-commit` | husky + lint-staged            | arquivo staged sem lint ou formatação                                                                 |
| CI, PR              | commitlint no **título do PR** | título fora do padrão (é o commit final)                                                              |
| CI, PR              | regex do nome da branch        | branch fora do padrão                                                                                 |
| CI, PR              | `pnpm boundaries`              | import que fura a [matriz de dependências](../arquitetura/principios.md#matriz-de-imports-permitidos) |
| CI, PR              | typecheck, lint, testes        | o de sempre                                                                                           |
| GitHub              | branch protection              | push direto na `main`, force-push, merge sem check verde, merge não-linear                            |

A configuração de branch protection é manual no GitHub — passo a passo em
[`ci-cd.md`](ci-cd.md#branch-protection).

### Quando o hook local atrapalha

```bash
git commit --no-verify    # pule o hook local
```

Use com parcimônia — e saiba que **a CI vai barrar do mesmo jeito**. O hook
local existe para você descobrir em 2 segundos em vez de 3 minutos.

## Documentos relacionados

- [Fluxo de trabalho](fluxo-de-trabalho.md) — o ciclo diário de uma tarefa
- [Code style](code-style.md) — o que o lint verifica
- [CI/CD](ci-cd.md) — os pipelines que rodam em cada PR
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — a versão de uma tela
