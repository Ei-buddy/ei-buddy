# Quickstart: validar NR-115

**Goal**: comprovar, no mesmo laço conversacional do aplicativo, consultas
corretas de estoque, vencimentos e fiado sem confirmação ou escrita.

## Prerequisites

- Repositório instalado e Postgres do Compose em execução:
  [setup](../../docs/engenharia/setup.md).
- Branch `feat/NR-115-consultar-estoque-pagar-fiado`.
- Migrations aplicadas, incluindo a migração de inventário desta tarefa se ela
  for necessária para controle/localização.
- `AGENT_PROVIDER=fake` e fixtures da matriz abaixo.
- Sessão fixture para `POST /agent/messages`; opcionalmente preset do Studio.

## Matriz de fixtures NR-115

Use uma data fixa no contexto (`ctx.now`) ao validar vencimentos. A matriz
abaixo é o conjunto mínimo para os testes desta feature; os itens marcados como
“futuro” ainda não pertencem aos testes de baseline.

| Entidade         | Empresa A                                                                                                                                               | Empresa B                     | Caso coberto                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------- |
| Produto          | Um produto controlado com saldo positivo, preço e localização; outro com saldo `0`; outro sem controle (`stockQuantity: null`); uma busca sem resultado | Produto conhecido apenas da B | Controlado, zero, sem controle, ausente e isolamento |
| Busca de produto | Duas camisetas distinguíveis que correspondem à mesma busca parcial                                                                                     | —                             | Produto ambíguo                                      |
| Conta a pagar    | Títulos abertos vencido, hoje, na semana, no mês e depois do mês; variante sem títulos                                                                  | Título conhecido apenas da B  | Faixas datadas, vazio e isolamento                   |
| Cliente          | Um devedor; um com `walletBalanceCents: 0`; dois homônimos distinguíveis; uma busca sem resultado                                                       | Cliente conhecido apenas da B | Devedor, zero, homônimo, ausente e isolamento        |

## Validação (gates T025)

Os comandos abaixo cobrem a feature completa — core, agent, API, banco (quando
`DATABASE_URL` está disponível) e os gates de repositório.

```bash
pnpm --filter @na-regua/core test -- src/inventory/inventory.test.ts src/payables/payables.test.ts src/registration/registration.test.ts
pnpm --filter @na-regua/agent test -- src/catalog.test.ts src/process-message.test.ts
pnpm --filter @na-regua/api test -- src/routes/agent.test.ts src/composition.test.ts
pnpm --filter @na-regua/db test -- src/estoque.test.ts src/custos-fixos.test.ts src/clientes.test.ts
pnpm format:check
pnpm boundaries
pnpm typecheck
pnpm test
pnpm build
```

Sem `DATABASE_URL`, os testes de `packages/db` marcados com `skipIf` são
pulados — o restante da matriz continua obrigatório na CI.

### Responsabilidade dos testes

| Arquivo                                               | Responsabilidade                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `packages/core/src/inventory/inventory.test.ts`       | `checkStock` / `checkStockByQuery`: controlado, zero, sem controle, localização, ausência e tenant  |
| `packages/core/src/payables/payables.test.ts`         | `listPayables`: faixas datadas, totais, vazio, `later` e tenant                                     |
| `packages/core/src/registration/registration.test.ts` | `checkCustomerWalletByQuery`: devedor, zero, homônimo, ausência e tenant                            |
| `packages/agent/src/catalog.test.ts`                  | `check_stock`, `list_payables`, `check_customer_wallet`: schemas, `mutatesValue: false`, formatação |
| `packages/agent/src/process-message.test.ts`          | Laço conversacional: leituras sem confirmação nem mutação; cross-tool T021                          |
| `apps/api/src/routes/agent.test.ts`                   | Harness HTTP autenticado para estoque, vencimentos e fiado                                          |
| `packages/db/src/estoque.test.ts`                     | Migration 0022, `tracks_stock`/`location`, busca e leitura com RLS (T022)                           |
| `packages/db/src/custos-fixos.test.ts`                | `listPayables` no Postgres: títulos abertos isolados por tenant (T022)                              |
| `packages/db/src/clientes.test.ts`                    | Busca de cliente para fiado isolada por tenant (T022)                                               |

## Smoke manual

1. Suba a API em ambiente não produtivo e autentique uma fixture.
2. Envie uma mensagem por vez ao endpoint de harness:

```http
POST /agent/messages
{ "text": "quanto tem de camiseta M?" }
```

Esperado: saldo, preço e localização do produto. Repita com um produto sem
controle e confirme a expressão explícita, não “0”.

```http
POST /agent/messages
{ "text": "o que vence essa semana?" }
```

Esperado: grupos vencidas, hoje, semana e mês com totais; se houver títulos
futuros, total separado “depois deste mês”. Com fixture sem contas, a mensagem
afirma que não há vencimentos.

```http
POST /agent/messages
{ "text": "quanto o João está me devendo?" }
```

Esperado: saldo em carteira do João. Repita com saldo zero e com dois “João”:
no segundo caso, aparecem alternativas e nenhum saldo é escolhido.

3. Depois de cada consulta, valide que não há proposta de confirmação e que
   nenhum estoque, título, saldo ou cadastro mudou.
4. Troque para fixture de outra empresa e repita nomes conhecidos apenas na
   primeira. Esperado: ausência, nunca dado alheio.

## Referências

- Contrato das tools: [contracts/agent-query-tools.md](./contracts/agent-query-tools.md)
- Entidades e regras: [data-model.md](./data-model.md)
- Decisões de implementação: [research.md](./research.md)

## Não fazer nesta fatia

- Não enviar cobrança, registrar baixa, cadastrar produto ou alterar estoque.
- Não usar Memory/RAG como fonte de preço, saldo ou vencimento.
- Não usar WhatsApp de produção, celular real ou credenciais de provedor.
