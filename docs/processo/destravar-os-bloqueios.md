# Destravar os bloqueios

> **Atualização 2026-09-15.** [DEC-003](../decisoes/README.md#dec-003) e
> [DEC-009](../decisoes/README.md#dec-009) fecharam
> ([ADR-0014](../decisoes/adr/0014-meta-cloud-api.md),
> [ADR-0015](../decisoes/adr/0015-vps-docker-compose.md)). O quadro vivo é o
> [`task-ledger.md`](task-ledger.md). O texto abaixo descreve o _padrão_ (porta
> antes do adapter) e números de uma foto antiga.

> **Pergunta que este documento responde:** o painel diz que os 35
> dias-desenvolvedor restantes estão _todos_ bloqueados, 33 por decisão e 2 por
> dependência. Isso significa que não dá para escrever mais nenhuma linha até
> alguém decidir?
>
> **Não.** Cerca de **19 dos 35 dias** são trabalho de núcleo que a decisão não
> toca. Os outros **16** dependem mesmo dela — e a tabela abaixo diz quais.

Este documento existe porque a coluna `Bloq` do
[`task-ledger.md`](task-ledger.md) marca a tarefa inteira, e tarefa inteira é a
unidade errada para essa pergunta. A regra do ledger — _"não comece tarefa
bloqueada"_ — continua certa como regra de planejamento; ela só não é a mesma
coisa que _"não há nada a fazer"_.

---

## O precedente: a DEC-004 nunca bloqueou 4 dias

A decisão do provedor fiscal ficou aberta por meses. A **NR-042** (emissão de
NFC-e, 4 dias) foi entregue mesmo assim, e nesta ordem:

1. os schemas em `contracts` — o que é uma nota, o que é um cancelamento;
2. a porta `InvoiceIssuer`, declarada em `core`;
3. um **emissor falso** e uma **suíte de contrato compartilhada**
   (`verificarContratoDoEmissor`, 41 testes) que qualquer emissor precisa passar;
4. a guarda de notas (`invoices`), o schema, os índices, os casos de uso;
5. as rotas e as telas — o gatilho, a contingência, a reconciliação.

Quando a decisão saiu (**Focus NFe**), o que mudou foi **um arquivo de adapter**
que já nascia com 41 testes esperando por ele. Nada acima da porta foi reescrito.

O padrão não é retórica: `packages/whatsapp` e `packages/payments` **já estão
nesse mesmo estágio hoje** — porta, adapter falso e suíte de contrato prontos
(NR-045 ✅, NR-043 ✅). O que falta neles é a metade de cima, que não depende de
provedor nenhum.

---

## Tarefa por tarefa

| Tarefa     | Dias | O que a decisão realmente segura           | O que dá para fazer **hoje**                                      | Dias livres |
| ---------- | ---: | ------------------------------------------ | ----------------------------------------------------------------- | ----------: |
| **NR-046** |    4 | — (DEC-003 ✅; ledger: após NR-113/120)    | consentimento, webhook; canal real depois do E11 no Studio        |           4 |
| **NR-060** |    5 | — (não depende mais de NR-046)             | runtime + tools base; Studio (NR-121) substitui o Zap em eng.     |           5 |
| **NR-121** |    2 | —                                          | harness Studio → `processMessage` (preset / número forjado)       |           2 |
| **NR-061** |    2 | nada próprio — herda de NR-060/121         | a máquina de estados da confirmação e a expiração são `core` puro |           2 |
| **NR-062** |    3 | — (DEC-011 / ADR-0016)                     | o isolamento por empresa é a mesma RLS que já existe              |          ~2 |
| **NR-063** |    4 | a cobrança em si                           | trial, estados e o que cada estado permite                        |          ~2 |
| **NR-075** |    3 | o catálogo de planos e o desenho do cupom  | as telas contra um catálogo falso                                 |          ~2 |
| **NR-048** |    4 | o provedor de Open Finance                 | pouco: o importador de OFX/CSV (NR-047) já cobre o caminho manual |          ~1 |
| **NR-044** |    4 | o PSP                                      | pouco: porta e falso já existem (NR-043 ✅)                       |          ~1 |
| **NR-049** |    3 | as rotas do fluxo 3, que dependem de 2 DEC | nada — este é bloqueio de verdade                                 |           0 |
| **NR-015** |    3 | o alvo de deploy                           | `Dockerfile` e um compose que sobe a pilha inteira são agnósticos |          ~2 |
| **Total**  |   35 |                                            |                                                                   |     **~19** |

Os números são estimativa, não medição — mas a direção não depende da precisão
deles.

---

## O que muda no ledger para poder começar

A regra _"tarefa cuja dependência está 🚧 também está 🚧"_ é boa e o
`ledger:check` a impõe. O que está errado é a **granularidade**: uma tarefa de
5 dias que é 80% núcleo e 20% adapter não cabe num único status.

**A mudança é quebrar as tarefas na costura que já existe no código** — a porta.
Cada uma vira duas:

- `NR-046a` — consentimento, webhook e roteamento (⬜, sem bloqueio)
- `NR-046b` — adapter do provedor (🚧 DEC-003)

E assim para NR-060, NR-062, NR-063, NR-075, NR-015. É a mesma divisão que a
NR-042 usou de fato, só que registrada antes em vez de depois.

Isso não é contabilidade criativa: o `a` entrega valor sozinho (o consentimento
vale mesmo sem provedor — é ele que impede mandar mensagem para quem não pediu),
e o `b` continua honestamente bloqueado.

---

## A decisão que mais rende agora

A [DEC-007](../decisoes/README.md#dec-007) fechou. Se for para decidir só mais
uma coisa que destrave o assistente, é esta:

### DEC-003 — provedor de WhatsApp

A DEC-003 fechou (Meta Cloud API). No ledger atual, **NR-046 não trava mais
NR-060**: o assistente avança no Studio (NR-121) até E11 + RAG; PeerDirectory
(NR-113) e Meta vêm depois. O que resta no adapter é implementação, não
decisão de provedor.

**O que é preciso para decidir:** uma estimativa de conversas/mês por lojista.
Sem isso a comparação de custo não fecha, e é o único critério em que os dois
diferem de forma material.

### DEC-007 — modelo de LLM ✅

Fechou na [ADR-0010](../decisoes/adr/0010-mastra-e-gpt-4o-mini.md): Mastra como
biblioteca em `packages/agent`, modelo inicial `openai/gpt-4o-mini`, tools
geradas de `contracts`; RAG auxiliar ([ADR-0017](../decisoes/adr/0017-rag-com-tools-e-rls.md))
recupera candidatos — totais continuam vindos de `core` / `domain`.

A identidade do canal fechou ([DEC-023](../decisoes/README.md#dec-023) /
[ADR-0012](../decisoes/adr/0012-identidade-do-canal-whatsapp.md)): celular do
owner, `processMessage`, fake. A [NR-113](task-ledger.md) não espera a DEC-003.

O adapter real (`NR-046`) espera o agente estável no Studio (cascata até
NR-120) e o PeerDirectory (NR-113). O laço e as tools não dependem do Meta —
o precedente da NR-042 continua valendo.

**O que é preciso para o adapter `mastra`:** `OPENAI_API_KEY` no ambiente que
não for `fake`. O teto por tenant ([RNF-073](../produto/requisitos-nao-funcionais.md))
entra no mesmo PR da NR-060; o percentual da mensalidade ([RNF-072](../produto/requisitos-nao-funcionais.md))
espera [QST-002](../decisoes/README.md#qst-002).

---

## O que NÃO dá para adiantar

Sendo justo com o outro lado:

- **DEC-010** (inadimplência) não é só adapter. "O que acontece quando o
  pagamento falha" é decisão de produto, e a US-054 já dá metade da resposta
  ("continuo podendo ler e exportar"). Mas o prazo de tolerância, o aviso e o
  ponto de corte são escolha, não código.
- **DEC-011** (contexto da conversa) fechou na
  [ADR-0016](../decisoes/adr/0016-memoria-da-conversa-tabelas-nossas.md):
  histórico nas tabelas do catálogo. A NR-062 implementa; não há mais espera
  de schema alternativo.
- **DEC-015** (conta no PSP: uma por lojista ou split na conta da plataforma) é
  decisão **regulatória e contábil**, não técnica. Ela muda quem é o titular do
  dinheiro. Nada de código adianta aqui.

---

## Resumo

O painel está certo ao dizer que nenhuma _tarefa_ pode começar. Ele não diz — e
não deveria ser lido como se dissesse — que nenhum _trabalho_ pode começar.

Quebrar as seis tarefas na costura da porta devolve cerca de **19 dias** ao
quadro sem decidir nada. As decisões continuam necessárias; elas deixam de ser
pré-requisito para tudo e passam a ser pré-requisito para a última milha de cada
integração — que é onde elas de fato pertencem.
