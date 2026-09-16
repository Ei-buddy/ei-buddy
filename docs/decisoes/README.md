# Decisões e perguntas em aberto

O que ainda **não** foi decidido, quem decide, e o que trava enquanto não for
decidido.

Este documento existe porque a alternativa é pior: decisão não tomada vira
decisão tomada por omissão, dentro de um PR, por quem estava com pressa.

---

## Como funciona

Duas coisas diferentes, deliberadamente separadas:

|                        | Resolve-se com                    | Formato                               |
| ---------------------- | --------------------------------- | ------------------------------------- |
| **Decisão** `DEC-xxx`  | uma **escolha** entre opções      | Ver [decisões](#decisões-em-aberto)   |
| **Pergunta** `QST-xxx` | uma **informação** que alguém tem | Ver [perguntas](#perguntas-em-aberto) |

### Ciclo de vida de uma decisão

```
🔴 Aberta ──→ 🟡 Em análise ──→ 🟢 Decidida ──→ ADR em adr/ ──→ sai desta lista
                    │
                    └──→ ⚪ Adiada (com data de revisão)
```

Quando uma `DEC` fecha: escreve-se a ADR em [`adr/`](adr/) usando o
[template](adr/0000-template.md), atualiza-se a documentação afetada **no mesmo
PR**, e a linha sai da tabela de abertas.

### Regras

1. Toda `DEC` tem **dono** e **prazo**. Sem isso ela não é uma decisão pendente,
   é um desejo.
2. Toda tarefa bloqueada no [ledger](../processo/task-ledger.md) referencia a
   `DEC` que a bloqueia.
3. **Bloqueado ≠ parado.** Se a decisão é sobre um provedor externo, a porta
   (interface) e os testes podem ser escritos antes — é para isso que existem os
   adapters ([princípios](../arquitetura/principios.md#3-adapters-isolam-provedores)).
4. Decisão tomada em conversa e não registrada aqui **não foi tomada**.

## Painel

| Estado             | Qtd | Quais                                   |
| ------------------ | --: | --------------------------------------- |
| 🔴 Aberta          |   5 | DEC-005, 011, 013, 016, 018             |
| 🟡 Em análise      |   0 | —                                       |
| ⚪ Adiada          |   1 | DEC-014                                 |
| 🟢 Decidida        |  16 | DEC-001–004, 006–010, 012, 015, 019–023 |
| ❓ Pergunta aberta |   9 | QST-001 a QST-008, QST-012              |

**Bloqueando o MVP agora:** [DEC-011](#dec-011) (memória da conversa).
A DEC-003 fechou — [ADR-0014](adr/0014-meta-cloud-api.md): Meta Cloud API.
A DEC-009 fechou — [ADR-0015](adr/0015-vps-docker-compose.md): VPS + Compose.
A DEC-016 não trava código, mas trava **operação comercial**: os documentos
existem e têm lacunas declaradas na própria página.

A DEC-001 fechou — [ADR-0011](adr/0011-eibuddy-nome-e-dominio.md): o produto
é **EiBuddy**, domínio **eibuddy.com.br**; pacotes continuam `@na-regua/*`.
A DEC-007 fechou — [ADR-0010](adr/0010-mastra-e-gpt-4o-mini.md): Mastra como
runtime, `gpt-4o-mini` no começo. A identidade do canal fechou —
[DEC-023](#dec-023) / [ADR-0012](adr/0012-identidade-do-canal-whatsapp.md).
O adapter real do WhatsApp é a [NR-046](../processo/task-ledger.md) (já ⬜).
A memória da conversa continua [DEC-011](#dec-011).
A DEC-008 fechou — [ADR-0002](adr/0002-autenticacao-identidade-propria.md) e
[ADR-0003](adr/0003-better-auth-como-prova-de-identidade.md).
A hospedagem é a VM que já roda: Better Auth auto-hospedado permanece; a
NR-015 preenche backup, PITR e os workflows de deploy.

---

## Decisões em aberto

### DEC-003 — Provedor de WhatsApp

|              |                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| **Status**   | 🟢 **Decidida — [ADR-0014](adr/0014-meta-cloud-api.md)**                                                    |
| **Dono**     | Trilha 2 — Plataforma & Integrações                                                                         |
| **Prazo**    | **Sprint 2**                                                                                                |
| **Bloqueia** | — (NR-046 ⬜). Identidade do canal é [DEC-023](#dec-023). Memória da conversa continua [DEC-011](#dec-011). |

**Decisão (2026-09-15): Meta Cloud API.**

Um WABA da plataforma, um número de negócio. O celular do owner é o peer
([ADR-0012](adr/0012-identidade-do-canal-whatsapp.md)). `WHATSAPP_PROVIDER=meta`
no adapter real; `fake` no local. Biblioteca não oficial descartada. BSP
abdicado.

Contrato: [`integracoes/meta-cloud-api.md`](../arquitetura/integracoes/meta-cloud-api.md).
A NR-046 implementa o adapter; template fora da janela de 24 h entra nesse
mesmo trabalho, atrás da porta `MessageSender`.

---

### DEC-004 — Provedor de emissão fiscal

|              |                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **Status**   | 🟢 **Decidida — Focus NFe**                                                                                                      |
| **Dono**     | Trilha 2 — Plataforma & Integrações                                                                                              |
| **Prazo**    | **Sprint 2**                                                                                                                     |
| **Bloqueia** | `packages/fiscal` · [RF-045 a RF-054](../produto/requisitos-funcionais.md) · [E5](../produto/user-stories.md#e5--emissão-fiscal) |

**Opções:** provedor de API fiscal (Focus NFe, NFe.io, PlugNotas, eNotas, Tecnospeed)
· integração direta com a SEFAZ.

**Critérios:** cobertura de NFC-e **e** NFS-e (NFS-e é municipal — a cobertura
varia por cidade) · contingência ([RF-052](../produto/requisitos-funcionais.md))
· guarda de XML por 5 anos ([RNF-037](../produto/requisitos-nao-funcionais.md))
· gestão do certificado A1 · qualidade das mensagens de rejeição
([RF-047](../produto/requisitos-funcionais.md)) · custo por nota.

**Recomendação.** Integração direta com a SEFAZ está fora de cogitação para um
time de 3 pessoas: é um projeto inteiro por si só. Escolher provedor, priorizando
NFC-e (MVP) e cobertura de NFS-e nas cidades-alvo.

**Decisão (2026-09-04): Focus NFe.**

O adapter entrou com a [NR-042](../processo/task-ledger.md). Três propriedades
do provedor moldaram o desenho, e estão no código:

- **NFC-e é síncrona** — autoriza ou rejeita na mesma requisição, diferente da
  NF-e. Não há fila nem consulta obrigatória depois.
- **Autenticação é Basic com senha vazia** — `Base64("token:")`. Não é
  cabeçalho de API key.
- **A referência (`ref`) é nossa e é o `saleId`** — única por token, e não
  reutilizável depois que a nota autoriza. Isso dá metade da idempotência que a
  [RNF-043](../produto/requisitos-nao-funcionais.md) exige.

**As credenciais por lojista foram resolvidas** (migration `0015`). Cada empresa
tem seu token Focus NFe e seu certificado A1, os dois cifrados em AES-256-GCM
antes de entrar no banco, em tabela própria e não em `companies` —
[RF-004](../produto/requisitos-funcionais.md). O adapter está ligado à
composição: o worker emite pela fila, e a api apenas **consulta**, porque
reconciliar contingência é leitura. Sem `SECRETS_KEY` a api cai no emissor
falso em vez de lançar; no worker a falta da chave lança, porque lá ela
significaria emitir sem poder.

> Este parágrafo dizia que as credenciais estavam pendentes e que o adapter
> "não está ligado à composição". As três afirmações ficaram desatualizadas, e
> quem consultasse a decisão concluiria que a emissão fiscal não funciona.

**O que continua pendente**, e por motivos diferentes:

| Requisito                         | Estado | Por quê                                                                                                                                                                                                                                                                                                                              |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RF-048` DANFE por WhatsApp       | ⬜     | Adapter real é a NR-046 ([ADR-0014](adr/0014-meta-cloud-api.md)); a DEC-003 fechou                                                                                                                                                                                                                                                   |
| `RF-053` retransmissão automática | ⬜     | **Decisão consciente, não pendência de tempo.** A documentação da Focus não define como retransmitir uma nota offline: existe um campo `contingencia_offline_efetivada` que _sugere_ que o provedor resolve sozinho, e sugerir não basta para documento fiscal. Inventar a chamada produziria nota duplicada ou nota que nunca chega |

O caso de uso `reconcileContingency` faz o que dá para fazer com segurança:
**pergunta** o estado de cada nota offline, na ordem em que saíram, e atualiza
a guarda. Funciona sob as duas hipóteses — se o provedor efetiva sozinho, a
reconciliação percebe; se não, as notas seguem visíveis em contingência em vez
de parecerem resolvidas.

Hoje essa pergunta acontece quando alguém abre a tela. Um job periódico faria
a nota se resolver sozinha, e é trabalho pequeno — mas exige uma consulta que
atravessa empresas ("quais têm nota em contingência"), porque a varredura roda
sem lojista na frente.

---

### DEC-005 — Provedor de Open Finance

|              |                                                                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**   | 🔴 Aberta                                                                                                                                                               |
| **Dono**     | Trilha 2 — Plataforma & Integrações                                                                                                                                     |
| **Prazo**    | Sprint 4 — só bloqueia [E8](../produto/user-stories.md#e8--bancos--conciliação), que é `SHOULD`                                                                         |
| **Bloqueia** | `packages/banking` · [RF-074, RF-075](../produto/requisitos-funcionais.md) — a importação por arquivo (RF-076, RF-077) **não** depende desta decisão e já está entregue |

**Opções:** agregador (Pluggy, Belvo, Klavi) · integração direta · **apenas
importação de OFX/CSV no MVP**.

**Recomendação.** Começar por OFX/CSV
([RF-076](../produto/requisitos-funcionais.md)), que já entrega conciliação e não
depende de fornecedor nem de certificação. Open Finance entra depois, atrás da
mesma porta `BankStatementProvider`.

---

### <a id="dec-007"></a>DEC-007 — Modelo de LLM e mecanismo de recuperação de informação

|              |                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **Status**   | 🟢 **Decidida — [ADR-0010](adr/0010-mastra-e-gpt-4o-mini.md)**                                                               |
| **Dono**     | Trilha 2 — Plataforma & Integrações                                                                                          |
| **Prazo**    | Sprint 3                                                                                                                     |
| **Bloqueia** | — (NR-060 ⬜, atrás da NR-046). Identidade do canal é [DEC-023](#dec-023). Memória da conversa continua [DEC-011](#dec-011). |

**Decisão (2026-09-11): Mastra + OpenAI `gpt-4o-mini` no começo.**

Duas perguntas que costumavam ser confundidas, as duas respondidas:

1. **Qual runtime e qual modelo** — Mastra como biblioteca em `packages/agent`;
   modelo inicial `openai/gpt-4o-mini` (`AGENT_MODEL`). Trocar de modelo é
   configuração; trocar de framework reabre a ADR.
2. **Como o agente acessa o dado** — **tools tipadas geradas de `contracts`**,
   chamando casos de uso de `core`. Não é RAG sobre texto. Mastra tem busca
   semântica; **não se liga** sobre o banco de negócio.

Contrato: [`integracoes/mastra.md`](../arquitetura/integracoes/mastra.md).
O runtime continua dentro de `apps/api`. `AGENT_PROVIDER=fake` no local.

O que **não** fecha aqui: o que a conversa lembra ([DEC-011](#dec-011)) e o
denominador do teto de custo
([QST-002](#qst-002) / [RNF-072](../produto/requisitos-nao-funcionais.md)).
O provedor de WhatsApp fechou — [ADR-0014](adr/0014-meta-cloud-api.md).

---

### DEC-009 — Hospedagem e alvo de deploy

|              |                                                                                     |
| ------------ | ----------------------------------------------------------------------------------- |
| **Status**   | 🟢 **Decidida — [ADR-0015](adr/0015-vps-docker-compose.md)**                        |
| **Dono**     | Trilha 2 — Plataforma & Integrações                                                 |
| **Prazo**    | **Sprint 1**                                                                        |
| **Bloqueia** | — (NR-015 ⬜). PITR, backup testado e workflows de deploy são trabalho, não decisão |

**Decisão (2026-09-15): VPS + Docker Compose**, a VM que já está no ar.

Produção é [`infra/docker-compose.prod.yml`](../../infra/docker-compose.prod.yml)
(Caddy, api, worker, web, Postgres e Redis na rede interna). O compose local
não vai para o servidor. PaaS com Postgres gerenciado foi abdicado neste
recorte: o custo de PITR e de patch passa a ser nosso.

A NR-015 preenche o que a máquina ainda não tem — deploy pelo GitHub Actions,
[RNF-013](../produto/requisitos-nao-funcionais.md), restore mensal,
reversão ≤ 10 min.

---

### DEC-011 — Memória e contexto da conversa

|              |                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Status**   | 🔴 Aberta                                                                                                                          |
| **Dono**     | Trilha 2                                                                                                                           |
| **Prazo**    | Sprint 3                                                                                                                           |
| **Bloqueia** | [RF-105](../produto/requisitos-funcionais.md), RF-106 · [US-051](../produto/user-stories.md#us-051--manter-o-contexto-da-conversa) |

**Contexto.** Herdada da apresentação: "como manter o contexto da conversa" e
"como a IA vai aprender/melhorar com o uso".

**Decidir:** o que é lembrado (só a conversa recente? preferências? histórico?) ·
por quanto tempo ([RNF-035](../produto/requisitos-nao-funcionais.md)) · onde é
armazenado · e se "aprendizado contínuo" significa memória por lojista ou
ajuste de modelo.

**Alerta.** "Aprendizado contínuo" com dado de cliente é campo minado de LGPD.
Memória **por empresa**, isolada e expirável, é uma coisa; treinar modelo com
dado de lojista é outra, e exige base legal e consentimento próprios
([RNF-036](../produto/requisitos-nao-funcionais.md)).

**Recorte de 2026-09-13 ([ADR-0012](adr/0012-identidade-do-canal-whatsapp.md)).**
Esta DEC **não** fecha agora. Sem Memory do Mastra (nem por `user_id`). Sem
gravar `conversations` / `messages`. Confirmação do agente continua in-memory
até a NR-061. Chave em memória, quando existir persistência, é por empresa
(`wa:${companyId}:${peer}`), não por pessoa.

---

### DEC-012 — Criação de usuário e cupons

|              |                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Status**   | 🟢 Decidida — [ADR-0013](adr/0013-conta-de-parceiro-e-esquema-de-cupons.md)                                        |
| **Dono**     | Produto                                                                                                            |
| **Prazo**    | Sprint 3                                                                                                           |
| **Bloqueia** | [RF-114](../produto/requisitos-funcionais.md), RF-115 · [US-056](../produto/user-stories.md#us-056--aplicar-cupom) |

Herdada da apresentação. Autocadastro existe para os dois tipos de conta
(lojista e Parceiro), sem convite. Indicação entre lojistas existe, separada
da indicação por Parceiro — dois tipos de cupom, nunca escolhidos
explicitamente por quem se cadastra. Desconto ao indicado é sempre
percentual (30%, primeira mensalidade); comissão do Parceiro é percentual e
recorrente; crédito do lojista é período grátis cumulativo, não percentual.
Emitido por autocadastro, com o cupom de Parceiro só ativando após aprovação
de um Super Admin. Ver ADR-0013 para o desenho completo.

---

### DEC-013 — Idioma da descrição dos commits

|              |                                                                                   |
| ------------ | --------------------------------------------------------------------------------- |
| **Status**   | 🔴 Aberta                                                                         |
| **Dono**     | Time                                                                              |
| **Prazo**    | **Antes do primeiro commit de feature**                                           |
| **Bloqueia** | [`git-workflow.md`](../engenharia/git-workflow.md) e a configuração do commitlint |

Tipos e escopos são palavras-chave em inglês em qualquer cenário. A dúvida é só
a descrição.

**Recomendação: PT-BR**, coerente com a escolha de documentação em português —
`feat(core): registrar venda com cálculo de líquido`. Barato mudar agora, caro
depois (histórico inteiro fica misto).

---

### DEC-014 — Versionamento: tag única vs. tag por aplicação

|              |                                                      |
| ------------ | ---------------------------------------------------- |
| **Status**   | ⚪ Adiada — revisar quando houver deploy em produção |
| **Dono**     | Trilha 2                                             |
| **Prazo**    | Antes do primeiro deploy de produção                 |
| **Bloqueia** | Nada hoje                                            |

Pré-MVP usa **tag única `v0.x.y`** no monorepo. Quando os deploys de `api`,
`web` e `mobile` deixarem de ser sincronizados, migrar para tags por aplicação
(`api-v1.2.0`). Hoje seria cerimônia sem retorno.

---

### DEC-016 — Revisão jurídica dos termos de uso e da política de privacidade

|              |                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**   | 🔴 Aberta                                                                                                                                         |
| **Dono**     | Fundadores + jurídico                                                                                                                             |
| **Prazo**    | **Antes de qualquer cadastro real** — o formulário exige o aceite                                                                                 |
| **Bloqueia** | Operação comercial · [RF-125](../produto/requisitos-funcionais.md)–128 na parte de canal de atendimento ao titular · publicação nas lojas de apps |

**Contexto.** A NR-085 criou as três páginas — [termos de
uso](../../apps/web/src/app/termos-de-uso/page.tsx), [política de
privacidade](../../apps/web/src/app/politica-de-privacidade/page.tsx) e
[política de cookies](../../apps/web/src/app/politica-de-cookies/page.tsx). Até
então o formulário de cadastro exigia marcar _"li e aceito"_ com os dois links
apontando para **404**: um aceite que, se questionado, não teria o que exibir.

O que está escrito nelas é o que dá para afirmar a partir do código — quais
tabelas existem, o que a exportação cobre, o que a anonimização preserva e por
quê, como a sessão é guardada. **A política de cookies está completa**, porque é
inventário de fato e é gerada a partir de
[`lib/cookies.ts`](../../apps/web/src/lib/cookies.ts).

**O que falta, e não dá para inferir de código nenhum:**

| Lacuna                                       | Por que só o negócio decide                                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Razão social e CNPJ do controlador           | Nome do produto é EiBuddy ([ADR-0011](adr/0011-eibuddy-nome-e-dominio.md)); razão social e CNPJ ainda são da empresa                                                  |
| Contato do encarregado (LGPD art. 41)        | Exige uma pessoa designada, não um endereço genérico                                                                                                                  |
| Prazo de retenção após encerramento da conta | Escolha de negócio acima do mínimo fiscal, que já são 5 anos                                                                                                          |
| Lista completa de operadores                 | Asaas, OpenAI e Meta ([ADR-0014](adr/0014-meta-cloud-api.md)) já são; faltam DEC-005 (Open Finance) e o provedor da VPS na [ADR-0015](adr/0015-vps-docker-compose.md) |
| Preço, prazo de pagamento e nível de serviço | [QST-002](#qst-002) — o provedor já é Asaas ([ADR-0004](adr/0004-asaas.md))                                                                                           |
| Limite de responsabilidade, rescisão e foro  | Cláusula contratual; escrita por quem responde por ela                                                                                                                |

**Por que as lacunas estão visíveis na página, e não preenchidas com texto
plausível.** Documento com cara de oficial e conteúdo inventado é pior que a
lacuna declarada: ninguém desconfia de um documento que parece completo. No caso
do limite de responsabilidade, seria pior ainda — prometeria ao lojista uma
proteção que ninguém se comprometeu a dar.

Cada lacuna aparece marcada no ponto exato do documento, e não num aviso geral
no topo, que se aprende a ignorar na segunda visita.

**O que esta decisão exige.** Um profissional revisar o que está escrito e
preencher o que está marcado. O material factual já está pronto — a revisão
parte dele, em vez de começar de uma página em branco.

---

### DEC-018 — Split nas vendas Asaas

|              |                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| **Status**   | 🔴 Aberta                                                                                               |
| **Dono**     | Produto + jurídico                                                                                      |
| **Prazo**    | Antes de enviar `split[]` em produção (não bloqueia o adapter falso nem o Pix)                          |
| **Bloqueia** | Take-rate por venda — não bloqueia Pix, boleto, link nem cartão da [NR-044](../processo/task-ledger.md) |

**Pergunta.** A plataforma tira uma fatia de cada venda Asaas, ou só cobra a
mensalidade na conta-pai?

Insumo: [`split-decision.md`](../arquitetura/integracoes/split-decision.md)
(opções A sem Split, B split na subconta, C cobrança na pai).

Não reabre [ADR-0005](adr/0005-subconta-asaas-nao-baas.md) (não-BaaS vs BaaS).
Quando fechar: ADR nova e o mesmo PR atualiza o adapter.

---

## Perguntas em aberto

Resolvem-se com informação, não com escolha. Uma pergunta respondida vira
atualização de documento — e às vezes abre uma `DEC`.

| ID                              | Pergunta                                                                                                                                                                                                                                                                | Para quem          | Por que importa                                                                                                                                                   | Prazo      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| <a id="qst-001"></a>**QST-001** | Quantos lojistas se espera nos primeiros 12 meses?                                                                                                                                                                                                                      | Produto            | Dimensiona [RNF-016/017](../produto/requisitos-nao-funcionais.md) e o custo de [DEC-009](#dec-009)                                                                | Sprint 1   |
| <a id="qst-002"></a>**QST-002** | Qual o preço da mensalidade e quantos planos?                                                                                                                                                                                                                           | Produto            | [RNF-072](../produto/requisitos-nao-funcionais.md) e [RNF-074](../produto/requisitos-nao-funcionais.md) são percentuais dela — sem o valor, não há como verificar | Sprint 1   |
| <a id="qst-003"></a>**QST-003** | Existe lojista-piloto comprometido em usar o MVP?                                                                                                                                                                                                                       | Produto            | Sem piloto não há como validar o [critério de saída do MVP](../produto/escopo-mvp.md#critérios-de-saída-do-mvp)                                                   | Sprint 1   |
| <a id="qst-004"></a>**QST-004** | Quem é controlador e quem é operador de dados na LGPD?                                                                                                                                                                                                                  | Jurídico           | Define quem responde por vazamento e o que vai no contrato — ver [`seguranca.md`](../arquitetura/seguranca.md#lgpd)                                               | Sprint 2   |
| <a id="qst-005"></a>**QST-005** | Qual contador valida o formato de exportação?                                                                                                                                                                                                                           | Produto            | [RF-087](../produto/requisitos-funcionais.md) sem validação real vira retrabalho                                                                                  | Sprint 4   |
| <a id="qst-006"></a>**QST-006** | As [personas](../produto/personas.md) foram validadas com lojistas reais?                                                                                                                                                                                               | Produto            | Hoje são inferência a partir da apresentação comercial                                                                                                            | Sprint 2   |
| <a id="qst-007"></a>**QST-007** | As metas [M1–M7](../produto/visao.md#métricas-de-sucesso) são realistas?                                                                                                                                                                                                | Produto            | São hipóteses; meta errada leva a decisão errada                                                                                                                  | Sprint 2   |
| <a id="qst-008"></a>**QST-008** | Os alvos numéricos dos [RNFs](../produto/requisitos-nao-funcionais.md) batem com o aparelho e a internet do público-alvo?                                                                                                                                               | Produto + Trilha 3 | Calibrados por estimativa, não por medição                                                                                                                        | Sprint 3   |
| <a id="qst-009"></a>**QST-009** | ~~A PagMaxx pode estender o escopo da API Key?~~ Respondida: Asaas autentica por API Key ([ADR-0004](adr/0004-asaas.md))                                                                                                                                                | —                  | Encerrada com a troca de PSP                                                                                                                                      | Respondida |
| <a id="qst-010"></a>**QST-010** | ~~A PagMaxx tem API de captura presencial?~~ Respondida: Asaas também não; PDV só registra ([ADR-0004](adr/0004-asaas.md))                                                                                                                                              | —                  | Encerrada — o desenho do PDV não muda                                                                                                                             | Respondida |
| <a id="qst-011"></a>**QST-011** | ~~ProComércio é a marca guarda-chuva e este ERP é uma das soluções dela, ou é o nome do próprio ERP?~~ Respondida: o ERP é **EiBuddy** ([ADR-0011](adr/0011-eibuddy-nome-e-dominio.md)); ProComércio não é o nome do produto. Paleta provisória segue em `packages/ui`. | —                  | Encerrada com a DEC-001                                                                                                                                           | Respondida |
| <a id="qst-012"></a>**QST-012** | Já existe conta Asaas de sandbox e acesso para testar `packages/payments`?                                                                                                                                                                                              | Produto            | Sem sandbox não há como ligar o adapter da [NR-044](../processo/task-ledger.md)                                                                                   | Sprint 2   |

---

## Decisões tomadas

Fechadas viram ADR em [`adr/`](adr/). A âncora `DEC-xxx` permanece para os
links que já apontam para cá.

| ADR                                                            | Decisão                                                           | Data       |
| -------------------------------------------------------------- | ----------------------------------------------------------------- | ---------- |
| [ADR-0001](adr/0001-rls-por-linha.md)                          | Isolamento multi-tenant por RLS por linha                         | 2026-09-01 |
| [ADR-0002](adr/0002-autenticacao-identidade-propria.md)        | Identidade e autorização próprias, prova terceirizada             | 2026-09-03 |
| [ADR-0003](adr/0003-better-auth-como-prova-de-identidade.md)   | Better Auth como prova de identidade, em schema próprio           | 2026-09-08 |
| [ADR-0004](adr/0004-asaas.md)                                  | Asaas como PSP das vendas e da assinatura SaaS                    | 2026-09-04 |
| [ADR-0005](adr/0005-subconta-asaas-nao-baas.md)                | Subconta Asaas não-BaaS por lojista; KYC fora do caminho crítico  | 2026-09-04 |
| [ADR-0006](adr/0006-catalogo-0909-mais-plataforma.md)          | Catálogo 0909 no domínio; identidade, cofre e banco às margens    | 2026-09-09 |
| [ADR-0007](adr/0007-super-admin-por-sessao-auditada.md)        | Super Admin por troca de sessão auditada, não `BYPASSRLS`         | 2026-09-10 |
| [ADR-0008](adr/0008-conexao-entre-usuarios-por-proximidade.md) | Rede B2B por proximidade entra agora, com risco de massa crítica  | 2026-09-10 |
| [ADR-0009](adr/0009-sugestao-de-conexao-por-ramo.md)           | Sugestão de conexão por ramo, sem lista de palavra-chave e sem IA | 2026-09-10 |
| [ADR-0010](adr/0010-mastra-e-gpt-4o-mini.md)                   | Mastra como runtime do agente; `gpt-4o-mini` no começo            | 2026-09-11 |
| [ADR-0011](adr/0011-eibuddy-nome-e-dominio.md)                 | Produto EiBuddy; domínio eibuddy.com.br; pacotes `@na-regua/*`    | 2026-09-11 |
| [ADR-0012](adr/0012-identidade-do-canal-whatsapp.md)           | Identidade do canal WhatsApp pelo celular do owner                | 2026-09-13 |
| [ADR-0013](adr/0013-conta-de-parceiro-e-esquema-de-cupons.md)  | Conta de Parceiro e esquema de cupons                             | 2026-09-13 |
| [ADR-0014](adr/0014-meta-cloud-api.md)                         | Meta Cloud API como provedor de WhatsApp                          | 2026-09-15 |
| [ADR-0015](adr/0015-vps-docker-compose.md)                     | Produção em VPS com Docker Compose                                | 2026-09-15 |

### <a id="dec-001"></a>DEC-001 — Nome do produto

|             |                                                                |
| ----------- | -------------------------------------------------------------- |
| **Status**  | 🟢 Decidida — [ADR-0011](adr/0011-eibuddy-nome-e-dominio.md)   |
| **Escolha** | **EiBuddy**, domínio **eibuddy.com.br**; pacotes `@na-regua/*` |
| **Data**    | 2026-09-11                                                     |

ZapGestor fica como nome de trabalho da apresentação comercial (fonte bruta).
ProComércio não é o nome do ERP. Paleta e fontes em `packages/ui` continuam
provisórias até existir arte própria.

### <a id="dec-002"></a>DEC-002 — Estratégia multi-tenant

|             |                                                       |
| ----------- | ----------------------------------------------------- |
| **Status**  | 🟢 Decidida — [ADR-0001](adr/0001-rls-por-linha.md)   |
| **Escolha** | RLS por linha (`company_id` + política no PostgreSQL) |
| **Data**    | 2026-09-01                                            |

Consequências no código: [`dados.md`](../arquitetura/dados.md#multi-tenant).
Materialização em `packages/db` (`NR-007`).

### <a id="dec-008"></a>DEC-008 — Autenticação e vínculo do número de WhatsApp

|             |                                                                              |
| ----------- | ---------------------------------------------------------------------------- |
| **Status**  | 🟢 Decidida — [ADR-0002](adr/0002-autenticacao-identidade-propria.md)        |
| **Escolha** | Identidade, papel e sessão são nossos; a prova de identidade entra por porta |
| **Data**    | 2026-09-03                                                                   |

**A segunda pergunta também foi respondida:** o vínculo do número **não** basta
para operação que muda acesso ou tira valor de dentro, e o eixo é **tipo de
ação**, não valor — piso monetário transforma o ataque em aritmética. A tabela
das operações que exigem segundo canal está em
[`seguranca.md`](../arquitetura/seguranca.md#o-que-o-vínculo-do-número-não-autoriza).

**O que a ADR corrigiu:** a documentação afirmava que a confirmação explícita de
`RF-103` contrabalançava o SIM swap. Não contrabalança — ela chega e é
respondida no mesmo canal que o atacante controla. Segue valendo como controle
de usabilidade.

A prova de identidade já é Better Auth auto-hospedado
([ADR-0003](adr/0003-better-auth-como-prova-de-identidade.md)). A
[DEC-009](#dec-009) fechou em VPS, então essa escolha permanece.

### <a id="dec-006"></a>DEC-006 — PSP / adquirente

|             |                                              |
| ----------- | -------------------------------------------- |
| **Status**  | 🟢 Decidida — [ADR-0004](adr/0004-asaas.md)  |
| **Escolha** | Asaas para Pix, boleto, link e cartão online |
| **Data**    | 2026-09-04                                   |

Dinheiro e maquininha: só registro. Sem TEF no recorte.
Contrato: [`integracoes/asaas.md`](../arquitetura/integracoes/asaas.md).
A avaliação anterior da PagMaxx fica em
[`pagmaxx.md`](../arquitetura/integracoes/pagmaxx.md).

### <a id="dec-010"></a>DEC-010 — Cobrança de mensalidade (provedor)

|             |                                             |
| ----------- | ------------------------------------------- |
| **Status**  | 🟢 Decidida — [ADR-0004](adr/0004-asaas.md) |
| **Escolha** | Asaas `/v3/subscriptions` na conta-pai      |
| **Data**    | 2026-09-04                                  |

Preço, trial e tolerância de inadimplência continuam pergunta de produto →
[QST-002](#qst-002). Estado `Restrita`: bloquear escrita, nunca leitura nem
exportação
([`fluxos.md`](../arquitetura/fluxos.md#assinatura-e-bloqueio-por-inadimplência)).

### <a id="dec-015"></a>DEC-015 — Modelo de conta no PSP

|             |                                                                  |
| ----------- | ---------------------------------------------------------------- |
| **Status**  | 🟢 Decidida — [ADR-0005](adr/0005-subconta-asaas-nao-baas.md)    |
| **Escolha** | Subconta Asaas não-BaaS por lojista; KYC fora do caminho crítico |
| **Data**    | 2026-09-04                                                       |

Split por venda (take-rate) **não** entra aqui — [DEC-018](#dec-018).

### <a id="dec-019"></a>DEC-019 — Catálogo PostgreSQL alvo

|             |                                                                          |
| ----------- | ------------------------------------------------------------------------ |
| **Status**  | 🟢 Decidida — [ADR-0006](adr/0006-catalogo-0909-mais-plataforma.md)      |
| **Escolha** | Domínio = `db_0909.sql`; plataforma da main (auth, sessão, cofre, banco) |
| **Data**    | 2026-09-09                                                               |

Baseline novo em `packages/db/src/migrations/`. O arquivo
[`db_0909.sql`](../arquitetura/db_0909.sql) continua documental — não se aplica
com `pnpm db:migrate`. Identidade Better Auth, sessão, cofre fiscal e extrato
**não** são desfeitos. Retrabalho: NR-088 a NR-098.

### <a id="dec-020"></a>DEC-020 — Como o Super Admin (`platform_admin`) atravessa o RLS

|             |                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------- |
| **Status**  | 🟢 Decidida — [ADR-0007](adr/0007-super-admin-por-sessao-auditada.md)                     |
| **Escolha** | "Entrar como" via troca de sessão auditada — não rota paralela, não papel com `BYPASSRLS` |
| **Data**    | 2026-09-10                                                                                |

RNF-025 (2FA para `platform_admin`) e o convite por e-mail (nenhuma
integração de e-mail existe no projeto) ficam de fora desta entrega — ver "O
que fica em aberto" na ADR-0007.

---

### <a id="dec-021"></a>DEC-021 — Conexão entre usuários (rede B2B por proximidade)

|             |                                                                               |
| ----------- | ----------------------------------------------------------------------------- |
| **Status**  | 🟢 Decidida — [ADR-0008](adr/0008-conexao-entre-usuarios-por-proximidade.md)  |
| **Escolha** | Entra agora, não espera a Fase 4 — risco de massa crítica aceito e registrado |
| **Data**    | 2026-09-10                                                                    |

**Histórico.** Esta DEC nasceu ⚪ Adiada: o mesmo motivo que tira
"Marketplace de lojas" do MVP em `docs/produto/escopo-mvp.md` — depende de
massa crítica de lojistas que ainda não existe — se aplicava aqui. Reaberta
no mesmo dia por decisão explícita de quem pediu a funcionalidade, ciente do
risco: a base de usuários pequena continua sendo o motivo pelo qual buscas
por produto específico podem voltar vazias no começo. Ver "Consequências" na
ADR-0008 para o que isso implica em não regredir a decisão por baixa adoção
inicial sem antes medir.

---

### <a id="dec-022"></a>DEC-022 — Como sugerir conexão sem IA

|             |                                                                      |
| ----------- | -------------------------------------------------------------------- |
| **Status**  | 🟢 Decidida — [ADR-0009](adr/0009-sugestao-de-conexao-por-ramo.md)   |
| **Escolha** | Filtragem colaborativa por ramo — sem lista de palavra-chave, sem IA |
| **Data**    | 2026-09-10                                                           |

Sugestão de fornecedor "baseada no negócio" sem exigir busca: se outras
empresas do MESMO ramo (texto livre, comparado sem caixa nem espaço) já tem
conexão ACEITA com uma empresa, ela é sugerida também. Começa vazia até
haver massa crítica de conexões entre pares do mesmo ramo — mesmo risco já
registrado na DEC-021.

---

### <a id="dec-023"></a>DEC-023 — Identidade e recorte do canal WhatsApp

|             |                                                                            |
| ----------- | -------------------------------------------------------------------------- |
| **Status**  | 🟢 Decidida — [ADR-0012](adr/0012-identidade-do-canal-whatsapp.md)         |
| **Escolha** | Celular obrigatório do owner é o vínculo; Fastify + `processMessage`; fake |
| **Data**    | 2026-09-13                                                                 |

O webhook não consulta Better Auth. Não há Workflow Mastra, Channel
`@chat-adapter/whatsapp` nem `MastraServer`. Número desconhecido = silêncio
(RF-095). Chip cola na primeira empresa; só o owner opera; troca no app
substitui. Redis continua fila. WhatsApp é [ADR-0014](adr/0014-meta-cloud-api.md);
DEC-011 segue aberta. Isolamento
cruzado é contexto + RLS, não processor.

## Documentos relacionados

- [ADRs](adr/) — decisões fechadas, com o contexto da época
- [Task Ledger](../processo/task-ledger.md) — o que cada decisão bloqueia
- [Princípios](../arquitetura/principios.md) — o que **não** é negociável
