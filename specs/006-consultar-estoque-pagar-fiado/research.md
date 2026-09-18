# Research: NR-115

**Date**: 2026-09-18  
**Spec**: [spec.md](./spec.md)

## 1. Caminho de execução do agente

**Decision**: registrar três tools de leitura no catálogo do agente e executá-las
no laço existente `processMessage → tool → core`.

**Rationale**: `processMessage` já distingue leitura de mutação pelo atributo
`mutatesValue`. Tools de leitura executam imediatamente, sem criar confirmação.
O runtime Mastra recebe schemas Zod via `createTool`; a documentação atual do
Mastra confirma `inputSchema` tipado e registro da tool no Agent. O executor de
negócio continua no catálogo, não no LLM.

**Alternatives considered**:

- Criar rota HTTP específica para cada pergunta: rejeitado porque duplicaria o
  caminho conversacional e não exercitaria o catálogo do agente.
- Consultar o banco no agente: rejeitado pela constitution II e porque
  contornaria validações e RLS compostos em `core`.
- Calcular ou resumir saldos no LLM: rejeitado pela constitution I e pelo
  README do agente; o LLM interpreta, `core` decide os números.

## 2. Estoque

**Decision**: resolver o produto por busca em `core` e, havendo um único
resultado, chamar `checkStock` em `packages/core/src/inventory/check-stock.ts`.

**Rationale**: `checkStock` retorna a visão canônica de estoque, preço e
localização e distingue estoque não controlado (`null`) de zero. O resultado de
`searchProducts` não basta como fonte final porque não representa essa distinção
nem traz localização. Busca com zero ou múltiplos candidatos termina em resposta
de ausência ou desambiguação, sem escolher produto.

**Alternatives considered**:

- Usar o estoque que aparece no resultado de busca: rejeitado; não atende
  RF-022/FR-003.
- Escolher o primeiro resultado parcial: rejeitado; pode informar saldo de
  produto errado.

## 3. Contas a pagar

**Decision**: expor uma tool sem argumentos que chama `listPayables` em
`packages/core/src/payables/list-payables.ts`; o formatador apresenta vencidas,
hoje, semana e mês com totais e destaca vencidas.

**Rationale**: o caso de uso já usa `ctx.now`, aplica as regras de títulos
abertos/parciais e calcula totais. Sua saída também contém o grupo `later`.
Para não esconder obrigação futura nem contrariar a história, a resposta
conversacional mostra os quatro grupos obrigatórios e, se houver itens em
`later`, informa o total adicional como “depois deste mês”.

**Alternatives considered**:

- Recalcular as faixas no agente: rejeitado por duplicar regra de negócio.
- Omitir silenciosamente `later`: rejeitado pois induz a conclusão de que não
  existem contas futuras.

## 4. Fiado e resolução de cliente

**Decision**: acrescentar em `core` uma consulta limitada de clientes por nome,
tenant-scoped, que devolve zero, um ou poucos candidatos. A tool só lê
`walletBalanceCents` após uma única correspondência; múltiplas correspondências
viram alternativas para a lojista escolher no turno seguinte.

**Rationale**: `getCustomer` recebe somente ID e o mecanismo existente de
similaridade atende telefone/documento, não nome. Uma lista paginada genérica
não define correspondência segura. Busca limitada e explícita protege contra
atribuir uma dívida ao homônimo errado e mantém a escolha como decisão humana.

**Alternatives considered**:

- Escolher a primeira correspondência por nome parcial: rejeitado por risco de
  divulgação e decisão comercial errada.
- Buscar cliente diretamente no repositório do agente: rejeitado pelas
  fronteiras da constitution.
- Usar RAG/histórico de conversa como saldo: rejeitado; NR-120 é outra tarefa e
  números são sempre determinísticos em `core`.

## 5. Estoque não controlado e localização

**Decision**: estender a persistência de inventário, se a investigação de
implementação confirmar a lacuna atual, para armazenar a situação de controle e
a localização já previstas no contrato de `checkStock`.

**Rationale**: o contrato e a spec exigem diferenciar “sem controle de estoque”
de zero e mostrar localização. A implementação atual do repositório retorna
saldo numérico e localização nula, de modo que não prova o cenário obrigatório.
A migração é parte necessária desta tarefa, não expansão de produto.

**Alternatives considered**:

- Responder sempre com zero: rejeitado explicitamente por US-065/RF-022.
- Remover o cenário da spec: rejeitado, pois reduziria requisito MUST do MVP.

## 6. Uma consulta por turno

**Decision**: manter uma tool por mensagem nesta tarefa. Se a mensagem pedir
consultas diferentes ao mesmo tempo, o assistente pede que a lojista escolha uma
delas.

**Rationale**: `LlmDecision` representa uma única chamada de tool. Executar
múltiplas ferramentas exige redesenhar decisão, execução, persistência de
metadados e respostas; isso excede o recorte de dois dias e não é requisito
primário das US-065–067. A spec registra esse comportamento no caso de borda.

**Alternatives considered**:

- Executar várias tools em paralelo: rejeitado nesta fatia por alterar o modelo
  de decisão e ampliar superfície de falha.
- Misturar resultado de várias entidades em uma resposta inferida: rejeitado
  por risco de associação incorreta.

## 7. Isolamento e validação

**Decision**: construir o `ExecutionContext` somente no laço já existente e
testar consultas cruzadas com duas empresas reais; não aceitar empresa no texto
nem nos argumentos da tool.

**Rationale**: `companyId` vem da autenticação, os repositórios usam
`withTenant` e RLS, e NR-062 já separa a identidade de conversa. A tool recebe
apenas o texto de busca necessário.

**Alternatives considered**:

- Receber `companyId` na tool: rejeitado pela constitution IV.
- Cobrir isolamento só com doubles em memória: rejeitado; RLS precisa de teste
  de integração contra PostgreSQL real.
