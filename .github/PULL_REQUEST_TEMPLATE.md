<!--
Titulo do PR = mensagem de commit. Usamos squash merge, entao o titulo VIRA o
commit na main.

  <tipo>(<escopo>): <descricao em pt-br, imperativo, minuscula, sem ponto>

Exemplo: feat(core): registrar venda com cálculo de líquido
Escopos validos: docs/engenharia/git-workflow.md#escopos--lista-fechada
-->

## O que muda

<!-- Uma ou duas frases. O diff mostra o quê; escreva o porquê. -->

Refs: NR-

## Como testar

<!-- Passos para quem revisa reproduzir. Se nao da para testar, diga por quê. -->

1.

## Checklist

- [ ] Título no formato de commit, com `NR-xxx`
- [ ] `pnpm format:check` passou **antes** do push (é o primeiro passo da job Verificar)
- [ ] `pnpm typecheck && pnpm test && pnpm boundaries` passa localmente
- [ ] Testes na camada certa ([testes.md](../docs/engenharia/testes.md)) — inclusive um caminho de erro
- [ ] README do módulo atualizado, se o comportamento mudou

### Só se aplicável

- [ ] **Mudei `packages/contracts`** → avisei as três trilhas (é a fronteira que todas consomem)
- [ ] **Tem migration** → é reversível ou tem plano de reversão no PR ([RNF-048](../docs/produto/requisitos-nao-funcionais.md))
- [ ] **Variável de ambiente nova** → entrou em [ambientes.md](../docs/engenharia/ambientes.md) _e_ no `.env.example`
- [ ] **Mexi com dinheiro** → é `Money` em centavos, nunca `number` ([RNF-044](../docs/produto/requisitos-nao-funcionais.md))
- [ ] **Nova escrita com valor** → é idempotente ([RNF-043](../docs/produto/requisitos-nao-funcionais.md))
- [ ] **Tabela nova** → tem `company_id` e RLS habilitado ([dados.md](../docs/arquitetura/dados.md))
- [ ] **Tomei decisão de arquitetura** → virou ADR ou `DEC` em [decisões](../docs/decisoes/README.md)
- [ ] **Mudei uma fronteira entre módulos** → atualizei a matriz _e_ o `.dependency-cruiser.cjs`

## Notas para quem revisa

<!-- O que você quer que olhem com atenção? Onde você tem dúvida? -->
