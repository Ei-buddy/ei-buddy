---
updatedAt: 2026-04-10T15:27:29.000Z
agentTools:
  projectIndex: https://doc.focusnfe.com.br/llms.txt
---

# Municípios

Esta API consulta a **base de municípios da Focus NFe**, **replicada a partir dos dados do IBGE**. Com ela você **lista e filtra** municípios (por UF, nome e outros critérios), obtém o **código IBGE** de sete dígitos e acessa informações que apoiam a **integração e as regras de NFS-e** no município — por exemplo provedor, obrigatoriedade de CNAE, item da lista de serviço e código tributário municipal.

Além disso, é possível consultar os **itens da lista de serviço** e os **códigos tributários municipais** vinculados a cada município. O **formato dos códigos tributários** retornados depende do que cada prefeitura adota: alguns seguem o padrão de **item da lista de serviço**, outros o de **código CNAE**, e há municípios com **padrão próprio**.

**Novos campos** podem ser adicionados às respostas ao longo do tempo; implementações devem **tolerar propriedades desconhecidas** no JSON para não quebrar quando a API evoluir.
