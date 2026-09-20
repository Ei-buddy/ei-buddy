# Estratégia de testes

O que testar em cada camada — e, tão importante quanto, **o que não testar**.

---

## Princípio

> Teste é para você mudar o código sem medo. Se um teste não te dá coragem de
> refatorar, ele está custando manutenção sem pagar nada de volta.

O corolário desconfortável: **teste que só verifica que uma função foi chamada
não prova nada.** Ele quebra quando você refatora e passa quando o
comportamento está errado — exatamente o oposto do que se quer.

## A pirâmide, por camada

```
        ┌──────────────────────┐
        │  E2E — poucos        │  fluxo de venda completo, no navegador
        ├──────────────────────┤
        │  Integração — alguns │  caso de uso + Postgres real
        ├──────────────────────┤
        │  Unidade — muitos    │  domain e money, sem I/O
        └──────────────────────┘
```

| Módulo           | Tipo predominante                   | Cobertura mínima                                             | Por quê                                         |
| ---------------- | ----------------------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| `money`          | unidade + propriedade               | **90%** ([RNF-068](../produto/requisitos-nao-funcionais.md)) | erro aqui contamina tudo                        |
| `domain`         | unidade + propriedade               | **90%**                                                      | é a regra de negócio; é barato testar           |
| `contracts`      | unidade                             | 80%                                                          | schema errado passa dado errado adiante         |
| `core`           | integração com banco real           | **70%**                                                      | é onde transação e autorização vivem            |
| `db`             | integração                          | —                                                            | testado através de `core` + testes de RLS       |
| adapters         | contrato + falso                    | —                                                            | contra sandbox do provedor, fora da CI          |
| `agent`          | unidade nas tools + integração      | —                                                            | interpretação testada por casos gravados        |
| `api`            | integração de rota                  | —                                                            | contrato HTTP, autenticação, contexto           |
| `worker`         | integração de job                   | —                                                            | reprocessamento e descarte                      |
| `web` / `mobile` | componente + E2E do caminho crítico | —                                                            | tela muda muito; teste de tela envelhece rápido |

## Testes de unidade

Onde: `domain`, `money`, `contracts`.

Rápidos (milissegundos), sem banco, sem rede, sem relógio.

```ts
it('distribui o resto sem perder centavo', () => {
  const parcelas = Money.parse('100.00').allocate(3)
  expect(parcelas.map((p) => p.toDecimalString())).toEqual(['33.34', '33.33', '33.33'])
  expect(Money.sum(parcelas).equals(Money.parse('100.00'))).toBe(true)
})
```

### Testes de propriedade onde há dinheiro

Para regra financeira, exemplo isolado não basta. Verifique a **invariante**
sobre uma faixa:

```ts
it('soma sempre bate, para qualquer valor e qualquer numero de parcelas', () => {
  for (let cents = 0; cents <= 200; cents++) {
    for (let parts = 1; parts <= 12; parts++) {
      const total = Money.fromCents(cents)
      expect(Money.sum(total.allocate(parts)).cents).toBe(total.cents)
    }
  }
})
```

Este teste é real e está em [`packages/money`](../../packages/money/README.md).
Ele prova [RNF-045](../produto/requisitos-nao-funcionais.md) de um jeito que
três exemplos escolhidos a dedo nunca provariam.

Use a mesma abordagem para: divisão de parcelas, cálculo de imposto,
arredondamento de tarifa, rateio de desconto.

## Testes de integração

Onde: `core`, `db`, `api`, `worker`.

**Contra um Postgres de verdade**, subido em container — nunca contra banco
fingido. O motivo: metade do que queremos testar (transação, RLS, restrição de
integridade, concorrência) simplesmente não existe num banco fingido.

```ts
it('registra venda, baixa estoque e cria recebivel na mesma transacao', async () => {
  const before = await inventoryOf(product.id)
  await registerSale(deps, ctx, input)
  expect(await inventoryOf(product.id)).toBe(before - 2)
  expect(await receivablesOf(sale.id)).toHaveLength(3)
})

it('nao deixa estado parcial quando a transacao falha', async () => {
  const before = await inventoryOf(product.id)
  await expect(registerSale(deps, ctx, inputQueFalhaNoFim)).rejects.toThrow()
  expect(await inventoryOf(product.id)).toBe(before) // RNF-046
})
```

Cada teste roda em transação revertida ao final, ou em base descartável. Testes
não podem depender da ordem em que rodam.

### Testes de isolamento — obrigatórios

O teste mais importante do sistema inteiro:

```ts
it('nao enxerga dado de outra empresa', async () => {
  const outra = await createCompany()
  const venda = await createSale({ companyId: outra.id })

  await withTenant(minhaEmpresa.id, async () => {
    expect(await findSale(venda.id)).toBeNull() // 404, nunca 403
  })
})

it('falha quando nao ha empresa no contexto', async () => {
  await expect(withoutTenant(() => listSales())).rejects.toThrow() // RF-121
})
```

[RNF-021](../produto/requisitos-nao-funcionais.md) exige isolamento **imposto
pelo banco**. Sem esse teste, "temos RLS" é fé, não fato — e a ameaça T1 de
[`seguranca.md`](../arquitetura/seguranca.md#modelo-de-ameaças) é existencial.

## Testes de contrato — adapters

Provedor externo não entra na CI: é lento, instável, custa dinheiro e às vezes
exige credencial.

| Camada              | Onde roda         | O quê                                                    |
| ------------------- | ----------------- | -------------------------------------------------------- |
| Contrato da porta   | CI                | o adapter falso e o real satisfazem a **mesma** suíte    |
| Contra sandbox      | manual / agendado | valida contra o ambiente de homologação do provedor      |
| Contrato de webhook | CI                | corpo gravado do provedor real, validado contra o parser |

O terceiro é o que mais paga. Guarde o corpo real de um webhook e teste contra
ele — inclusive os casos que a documentação da
[PagMaxx](../arquitetura/integracoes/pagmaxx.md#6-detalhes-que-geram-bug-se-ignorados)
avisa que existem: `type` nulo, `payment.approved` que nunca chega, `amount`
como decimal.

```ts
it('trata evento com type nulo sem quebrar', () => {
  expect(parseWebhook(eventoComTypeNulo)).toEqual({ ignored: true })
})

it('converte amount decimal para centavos sem passar por float', () => {
  expect(parsePayment({ amount: 129.9 }).amount.cents).toBe(12990n)
})
```

## Testes E2E

Poucos, e **só do caminho crítico**:

1. Onboarding → primeira venda
2. Venda completa com código de barras → pagamento → recebível
3. Cobrança pelo WhatsApp → link de pagamento → baixa por webhook

E2E é caro de manter e instável por natureza. Cada teste novo precisa se
justificar contra esse custo. Três testes E2E confiáveis valem mais que trinta
que falham aleatoriamente — porque suíte que falha à toa deixa de ser lida, e
aí não serve para nada.

### Onde eles rodam hoje — NR-049

**Pela API, não pelo navegador**, em `apps/api/src/e2e/`: HTTP → rota → `core`
→ `db` → Postgres, com a composição real. Não é a forma final; é a forma que
prova alguma coisa hoje.

O navegador ainda não alcança nenhum dos três fluxos, e o que falta não é
teste:

| Fluxo                                        | O que impede                                    |
| -------------------------------------------- | ----------------------------------------------- |
| 1 — Onboarding → primeira venda              | o web não tem BFF para `/empresas` nem `/sales` |
| 2 — Código de barras → pagamento → recebível | idem                                            |
| 3 — WhatsApp → link de pagamento → webhook   | só o ENVIO: o adapter real é a NR-046           |

O fluxo 3 deixou de estar impedido na metade que importa: a cobrança a
distância vai do link registrado até o título baixado em
[`cobranca-ate-a-baixa.test.ts`](../../apps/api/src/e2e/cobranca-ate-a-baixa.test.ts),
com Postgres de verdade. O que continua de fora é o ENVIO pelo WhatsApp —
incluí-lo hoje exercitaria o remetente falso, que é o que esta seção manda
evitar.

Playwright contra as telas de hoje exercitaria mock. Suíte verde que prova nada
é pior que suíte nenhuma: cria confiança sem lastro, e é justamente o que esta
seção diz para evitar. Quando as rotas de BFF existirem, os fluxos 1 e 2 sobem
para o navegador e este arquivo muda junto.

O E2E de hoje também **não cobre a sessão**: não há rota de login (só
`/auth/me`), então a identidade é injetada e o que se prova é daí para baixo.

## O que não testar

| Não teste                            | Por quê                                |
| ------------------------------------ | -------------------------------------- |
| Que uma função foi chamada           | testa implementação, não comportamento |
| Getter, setter, construtor trivial   | não tem o que dar errado               |
| Biblioteca de terceiro               | não é seu código                       |
| Detalhe de tela que muda toda semana | custo de manutenção maior que o valor  |
| Que o TypeScript funciona            | o compilador já testou                 |

## Dados de teste

| Regra                                                      | Motivo                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| Fábricas com padrão sensato, sobrescrevendo só o relevante | o teste mostra o que importa                              |
| Nunca copiar dado de produção                              | LGPD ([RNF-034](../produto/requisitos-nao-funcionais.md)) |
| CPF/CNPJ de teste válidos, mas reconhecivelmente falsos    | evita confusão com dado real                              |
| Data e hora **injetadas**, nunca `new Date()` no teste     | teste de vencimento não pode depender do dia em que roda  |

```ts
const sale = saleFactory({ items: [{ productId, quantity: 2 }] }) // resto é padrão
```

## Rodando

```bash
pnpm test                              # tudo (afetados, via turbo)
pnpm --filter @na-regua/money test     # um pacote
pnpm --filter @na-regua/money test -- --watch
```

Testes de integração exigem a infra local no ar (`pnpm infra:up`).

## Piso de cobertura

O mínimo da [RNF-068](../produto/requisitos-nao-funcionais.md) vive no
`vitest.config.ts` de cada pacote, não num passo separado da CI — quem roda
`pnpm test` na máquina vê a mesma reprovação que veria no PR. Portão que só
existe no servidor é portão descoberto tarde.

| Pacote      | Piso | De onde vem      |
| ----------- | ---: | ---------------- |
| `money`     |  90% | RNF-068          |
| `domain`    |  90% | RNF-068          |
| `core`      |  70% | RNF-068          |
| `contracts` |  80% | README do pacote |
| `env`       |  80% | README do pacote |

Ficam fora da medição os barris (`src/index.ts`) e os arquivos só de tipo:
não têm lógica, contariam 0% sem que exista o que testar e puxariam o número
para baixo sem significado.

## Na CI

| Verificação                                      | Bloqueia PR              |
| ------------------------------------------------ | ------------------------ |
| Testes de unidade e integração                   | ✅                       |
| Cobertura abaixo do mínimo em `domain` e `money` | ✅                       |
| Checagem de tipos                                | ✅                       |
| Fronteiras (`pnpm boundaries`)                   | ✅                       |
| Formatação                                       | ✅                       |
| Testes contra sandbox de provedor                | ❌ agendado, fora do PR  |
| E2E                                              | ✅ só no caminho crítico |

Detalhes em [`ci-cd.md`](ci-cd.md).

## Estado atual

| Módulo      | Testes                                                          | Cobertura |
| ----------- | --------------------------------------------------------------- | --------: |
| `money`     | ✅ 40, incluindo propriedade sobre 2.412 combinações de divisão |      100% |
| `domain`    | ✅ 31                                                           |    98,61% |
| `contracts` | ✅ 79, quase todos de rejeição                                  |    99,22% |
| `env`       | ✅ 23                                                           |      100% |
| `core`      | ✅ 16 — só `AppError`; os casos de uso ainda não existem        |      100% |
| `api`       | ✅ 21 — borda HTTP: erro, contexto e validação                  |         — |
| `ui`        | ✅ 24 — contraste WCAG dos tokens                               |         — |
| `web`       | ✅ 35 — deriva entre `globals.css` e os tokens                  |         — |
| Demais      | 🔴 nenhum — os módulos ainda são placeholder                    |         — |

## Documentos relacionados

- [Requisitos não funcionais](../produto/requisitos-nao-funcionais.md) — o que precisa ser verificado
- [Princípios](../arquitetura/principios.md) — por que `domain` puro é testável
- [CI/CD](ci-cd.md) — onde cada teste roda
