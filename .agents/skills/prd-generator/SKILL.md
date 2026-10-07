---
name: prd-generator
description: 'Investiga o projeto e entrevista o usuário para gerar um PRD de produto ou feature com decisões confirmadas, histórias, regras, fluxos, critérios de aceite e stack. Use antes de pedir um plano de implementação.'
---

# Gerador de PRD

Transforme uma ideia de produto ou feature em um PRD que registre **o que foi decidido e por quê**. O documento serve como entrada para outra etapa, na qual a IA poderá criar o plano de implementação. Nesta skill, não crie plano, fases, specs funcionais, tarefas, ordem de execução ou código.

## Condução

1. **Entenda o pedido e o projeto.** Se a ideia ainda não foi descrita, peça uma descrição breve. Inspecione apenas o que for relevante: `AGENTS.md` e outras instruções locais, README, documentação, estrutura, dependências e o código dos fluxos afetados. Em um projeto novo, verifique o que já está definido antes de sugerir uma stack. Identifique se o PRD é do produto inicial ou de uma feature e informe ao usuário sua leitura; ajuste se ele indicar outro recorte. Não trate uma feature como uma nova versão do produto inteiro.
2. **Investigue o objetivo.** Descubra o problema, os usuários, o resultado esperado, as ações necessárias e as restrições. No projeto existente, identifique comportamentos, entidades, integrações e convenções que a proposta toca ou pode reaproveitar. Diferencie fatos observados no repositório, informações dadas pelo usuário e hipóteses suas.
3. **Analise alternativas antes de fechar decisões.** Para escolhas que mudam o comportamento ou a stack, apresente opções viáveis com vantagens, custos e riscos proporcionais ao caso. Recomende a opção que melhor atende ao objetivo e explique o motivo. Aponte conflitos com o sistema atual e complexidade desnecessária. Pergunte em blocos pequenos; ofereça opções concretas quando o usuário não souber responder. Não transforme uma recomendação em decisão sem confirmação.
4. **Consolide as decisões.** Confirme o recorte, histórias, regras, fluxos, estados, validações, tratamento de erros, dados conceituais e critérios de aceite que importam. Resolva dúvidas que alteram o resultado antes de finalizar. Use seu julgamento para detalhes menores, mas apresente-os ao usuário como proposta para confirmação. Se uma decisão essencial continuar pendente, continue a conversa e não publique um PRD final incompleto.
5. **Gere e revise o PRD.** Salve somente o documento Markdown em `docs/prd/<slug>.md` na raiz do projeto; para feature, prefira `docs/prd/feature-<slug>.md`. Se o nome já existir, preserve o arquivo e escolha um nome com data. Verifique se cada história aparece em um fluxo ou comportamento e se as regras importantes têm critérios de aceite verificáveis. Entregue o caminho do arquivo e indique que ele pode ser usado para pedir o plano de implementação em outra etapa.

Durante esta skill, o código do projeto é fonte de leitura, não alvo de alteração. Não instale dependências nem execute comandos que modifiquem o projeto. A única saída em arquivo é o PRD.

## Conteúdo do PRD

Adapte as seções à complexidade real do pedido. Registre somente o que foi decidido para o recorte atual. Não inclua requisitos desejáveis, backlog, melhorias futuras, seção de fora do escopo, alternativas rejeitadas ou hipóteses não confirmadas. A análise de alternativas acontece na conversa; no documento, registre a escolha e sua justificativa.

```markdown
# PRD — [Nome do produto ou da feature]

> Tipo: [Produto inicial | Feature] · Data: [AAAA-MM-DD]
> Status: Pronto para planejamento

## Visão geral e objetivo

[Problema, público afetado e resultado que a entrega deve produzir.]

## Contexto do projeto

[Em uma feature: comportamento existente relevante, pontos de integração e restrições constatadas. Em um produto inicial: contexto e restrições já definidos.]

## Decisões do produto

[Comportamentos e limites positivos acordados para esta entrega, com justificativa quando ajudar a interpretar a decisão.]

## Histórias de usuário

- Como [ator], quero [ação ou capacidade], para [benefício].

## Regras de negócio e dados

[Regras objetivas, permissões, validações, estados e dados conceituais necessários para compreender o comportamento.]

## Fluxos

### [Nome do fluxo]

1. [Ação do ator e resposta do sistema.]
2. [Resultado, incluindo caminhos de erro relevantes.]

## Critérios de aceite

- Dado [contexto], quando [ação], então [resultado observável].

## Stack e restrições técnicas decididas

[Tecnologias existentes que serão mantidas ou escolhas de alto nível confirmadas, com justificativa breve. Cite uma tecnologia nova somente se sua adoção foi decidida.]
```

Escreva em linguagem clara e verificável. Descreva comportamento e dados no nível de produto; deixe arquitetura detalhada, nomes de arquivos, APIs internas, schemas, decomposição da entrega e testes de implementação para o plano posterior. Se uma seção não acrescentar informação ao PRD específico, remova-a em vez de preencher com suposições.
