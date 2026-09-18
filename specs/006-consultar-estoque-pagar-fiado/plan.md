# Implementation Plan: Consultar estoque, pagar e fiado por mensagem (NR-115)

**Branch**: `feat/NR-115-consultar-estoque-pagar-fiado` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

## Summary

Adicionar ao catálogo conversacional três tools somente de leitura: estoque,
vencimentos a pagar e saldo em carteira. As tools interpretam entrada tipada,
chamam os casos de uso existentes em `core` com o contexto da conversa e
formatam a visão determinística devolvida. A fatia inclui resolução segura de
produto/cliente, cobertura da persistência de inventário necessária para “sem
controle” e localização, e testes de isolamento e zero escrita.

## Technical Context

**Language/Version**: TypeScript, Node.js e pnpm workspace.

**Primary Dependencies**: Zod para contratos, Mastra para expor tools ao
provedor de linguagem, Fastify no harness da API.

**Storage**: PostgreSQL com Drizzle e RLS por `company_id`; adaptadores são
compostos exclusivamente em `apps/api/src/composition.ts`.

**Testing**: Vitest; testes unitários de `core`/`agent`, integração de `db`
contra PostgreSQL real e testes de rota/composição na API.

**Target Platform**: API Node.js; `POST /agent/messages` e Mastra Studio são
harnesses de engenharia, não canal de produção.

**Project Type**: Monorepo de pacotes de domínio/núcleo, API web e clientes.

**Performance Goals**: manter a leitura no mesmo turno do agente; não gerar
uma chamada ao provedor nem confirmação adicional depois da decisão da tool.

**Constraints**:

- Uma tool por mensagem; pedidos mistos pedem que a lojista escolha uma
  consulta.
- Tools nunca importam `db` ou `domain`, nunca recebem `companyId` e nunca
  calculam valor monetário.
- Produto/cliente ambíguo nunca é selecionado automaticamente.
- A resposta deve distinguir estoque não controlado de zero e saldo devedor
  zero de ausência de cliente.

**Scale/Scope**: três tools de leitura e um fluxo limitado de resolução de
cliente; sem novos canais, mutações, RAG, confirmação ou regras financeiras.

## Constitution Check

_Gate inicial: PASS. Reavaliado após o desenho: PASS._

| Princípio                        | Evidência no plano                                                                                     | Resultado |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | --------- |
| I. Um núcleo, dois canais        | Todas as leituras chamam `core`; não há consulta paralela no agente.                                   | PASS      |
| II. Hexágono e fronteiras        | Schemas vivem em `contracts`; composição de `db` é só da API; agente não importa `db`/`domain`.        | PASS      |
| III. Integridade financeira      | Centavos e agrupamentos vêm de `core`; formatador não calcula. Nenhuma tool escreve.                   | PASS      |
| IV. Isolamento de tenant         | `ExecutionContext` fornece a empresa e RLS é exercitado em teste real; dados alheios parecem ausentes. | PASS      |
| V. Teste que prova comportamento | Cobertura inclui vazio, ambiguidade, não controlado, zero, isolamento e zero escrita.                  | PASS      |
| Produto / MVP                    | São consultas MUST; não inclui WhatsApp real nem funcionalidades posteriores.                          | PASS      |

Não há violação a justificar.

## Project Structure

### Documentation (this feature)

```text
specs/006-consultar-estoque-pagar-fiado/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── agent-query-tools.md
```

### Source Code (repository root)

```text
packages/
├── contracts/src/
│   ├── inventory/              # schemas de entrada/saída de estoque
│   └── customer/               # schemas da busca segura de cliente
├── core/src/
│   ├── inventory/check-stock.ts
│   ├── payables/list-payables.ts
│   └── registration/           # busca/resolução de produto e cliente
├── db/src/
│   ├── inventory-repository.ts
│   ├── payable-repository.ts
│   └── registration-repositories.ts
└── agent/src/
    ├── catalog.ts
    ├── process-message.ts
    ├── fake-llm.ts
    └── *.test.ts
apps/api/src/
├── composition.ts
├── composition.test.ts
└── routes/agent.test.ts
```

**Structure Decision**: alteração vertical nos pacotes existentes. Contratos
definem entrada; `core` contém busca e regras; `db` implementa portas e
persistência; `agent` apenas orquestra; a API injeta dependências.

## Implementation Outline

1. Exportar os schemas Zod de entrada das novas tools em `contracts`, incluindo
   texto não vazio para produto/cliente e objeto vazio estrito para vencimentos.
2. Em `core`, reutilizar `searchProducts` + `checkStock` e `listPayables`;
   adicionar resolução de cliente limitada, por empresa, que preserva zero,
   único e múltiplos candidatos.
3. Confirmar e completar, com migration e adapters se necessário, a
   persistência de controle de estoque e localização para que o contrato
   diferencie `null` de zero.
4. Registrar `check_stock`, `list_payables` e `check_customer_wallet` no
   catálogo como `mutatesValue: false`, cada uma com formatador explícito para
   vazio, ausência, ambiguidade e valores zero.
5. Atualizar o reconhecedor FakeLlm somente para frases determinísticas dos
   testes e deixar o catálogo disponível ao Mastra pelo mecanismo existente.
6. Conectar as dependências em `apps/api/src/composition.ts`; não criar rota
   de negócio paralela.
7. Implementar testes por camada e executar os comandos do
   [quickstart](./quickstart.md).

## Complexity Tracking

Nenhuma exceção à constitution é necessária.
