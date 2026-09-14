# Fluxos

Sequências ponta a ponta dos caminhos críticos. Mostram os
[princípios](principios.md) em ação — em especial a convergência dos dois canais
no mesmo caso de uso.

---

## Venda completa

O caminho crítico do produto. Requisitos: RF-027 a RF-044 · RNF-003, RNF-004,
RNF-043, RNF-046.

```mermaid
sequenceDiagram
    autonumber
    actor F as Funcionário
    participant M as apps/mobile
    participant A as apps/api
    participant C as core.registerSale
    participant D as domain
    participant DB as PostgreSQL
    participant Q as fila (Redis)
    participant W as apps/worker
    participant FI as fiscal → SEFAZ

    F->>M: bipa produtos, escolhe cliente e pagamento
    Note over M: carrinho é local — RNF-051<br/>rede instável não trava o balcão
    M->>A: POST /v1/sales + Idempotency-Key
    A->>A: valida com contracts + monta ExecutionContext
    A->>C: registerSale(deps, ctx, input)

    C->>DB: verifica chave de idempotência
    alt chave já usada
        DB-->>C: venda existente
        C-->>A: 200 com a mesma venda (RNF-043)
    else chave nova
        C->>D: calculateSaleTotals(itens, pagamentos, regras, tarifas)
        D-->>C: bruto, custo, imposto, tarifa, líquido, margem

        rect rgba(90,140,200,0.12)
            Note over C,DB: uma única transação — RNF-046
            C->>DB: grava Sale + SaleItems + Payments
            C->>DB: baixa estoque (InventoryMovement)
            C->>DB: cria Receivable por parcela, com valor líquido
            C->>DB: atualiza carteira do cliente (se wallet)
            C->>DB: grava AuditLog (autor, canal, antes/depois)
        end

        C->>Q: enfileira invoice-issue
        C-->>A: venda registrada
        A-->>M: 201 Created
        Note over M: RNF-003: ≤ 1,5 s<br/>sem esperar a SEFAZ — RNF-004
    end

    Q->>W: consome invoice-issue
    W->>FI: emite NFC-e
    alt autorizada
        FI-->>W: chave de acesso + XML
        W->>DB: grava nota, XML e estado "autorizada"
        W->>Q: enfileira whatsapp-send (DANFE ao cliente)
    else SEFAZ indisponível
        W->>DB: marca "em contingência" (RF-052)
        Note over W: retransmite quando voltar — RF-053
    else rejeitada
        FI-->>W: código de rejeição
        W->>DB: grava rejeição traduzida (RF-047)
        Note over W: a venda continua válida — só a nota falhou
    end
```

**Três decisões visíveis aqui:**

1. **A venda fecha antes da nota.** A emissão é assíncrona porque a SEFAZ é
   instável e o balcão não pode parar por causa disso.
2. **Uma transação para tudo que muda valor.** Ou venda, estoque, recebível e
   auditoria mudam juntos, ou nada muda.
3. **A idempotência é verificada antes de qualquer cálculo.** Rede ruim gera
   reenvio; reenvio não pode gerar venda dupla.
4. **Estado visível ao lojista é composto**, não um `status` na venda. Nota,
   recebível e falha de job vivem nas tabelas deles — ver
   [`dados.md`](dados.md#estados-da-venda).
   Falha no `registerSale` = nenhuma linha; falha na SEFAZ/Pix depois = venda
   existe com o estado filho explícito (RF-054, US-025).

## Venda pelo WhatsApp

O mesmo caso de uso, outro canal. Requisitos: RF-100 a RF-104. A identidade
do remetente é [ADR-0012](../decisoes/adr/0012-identidade-do-canal-whatsapp.md):
`processMessage` resolve o `peer` para o owner da primeira empresa. Contexto
de conversa (RF-105) espera a [DEC-011](../decisoes/README.md#dec-011).

```mermaid
sequenceDiagram
    autonumber
    actor L as Lojista
    participant WA as Provedor WhatsApp
    participant A as apps/api
    participant AG as packages/agent
    participant LLM as OpenAI gpt-4o-mini
    participant C as core.registerSale

    L->>WA: "venda pro João: 2 camisetas M a 49,90, pagou no Pix"
    WA->>A: webhook
    A->>A: verifica assinatura do webhook (RNF-028)
    A->>AG: processMessage(channel whatsapp, peer, texto)

    AG->>AG: peer é o celular do owner da primeira empresa? (RF-094, RF-095)
    alt número desconhecido
        AG-->>WA: ignora, sem revelar informação
    end

    Note over AG: RF-105 (contexto) espera DEC-011 — neste recorte não há histórico
    AG->>LLM: mensagem + contexto + tools geradas de contracts
    LLM-->>AG: tool call registerSale(...)

    AG->>AG: resolve cliente e produtos
    alt produto ambíguo
        AG-->>L: "Camiseta M azul ou branca?" (RF-102)
        L->>AG: responde
    end

    rect rgba(200,150,60,0.15)
        Note over AG,L: ação que mexe em valor exige confirmação — RF-103
        AG-->>L: "Venda para João: 2× Camiseta M — R$ 99,80 no Pix. Confirma?"
        alt confirma
            L->>AG: "sim"
        else recusa, ambiguidade ou tempo esgotado
            L->>AG: outra coisa / silêncio
            AG-->>L: cancelado, nada foi criado (RF-104)
        end
    end

    AG->>C: registerSale(deps, ctx{channel:'whatsapp'}, input)
    Note over C: daqui em diante é IDÊNTICO ao fluxo do app:<br/>mesmos cálculos, mesma transação, mesma auditoria
    C-->>AG: venda registrada
    AG-->>L: "Pronto. Venda #1042 — R$ 99,80. Nota sendo emitida."
```

### Confirmação de ações sensíveis

A regra que separa consulta de ação:

| Tipo de intenção   | Confirmação    | Exemplo                        |
| ------------------ | -------------- | ------------------------------ |
| Leitura            | ❌ não pede    | "quanto vendi hoje?"           |
| Criação de valor   | ✅ obrigatória | lançar venda, lançar conta     |
| Alteração de valor | ✅ obrigatória | mudar preço, alterar recebível |
| Exclusão / estorno | ✅ obrigatória | cancelar venda, estornar baixa |
| Envio a terceiro   | ✅ obrigatória | enviar cobrança ao cliente     |

Uma confirmação pendente expira. Resposta ambígua conta como **não** — o custo
de errar para o lado do "não" é uma pergunta repetida; para o lado do "sim" é um
lançamento financeiro errado.

## Cobrança de cliente inadimplente

Requisitos: RF-068 a RF-072 · RNF-032.

```mermaid
sequenceDiagram
    autonumber
    participant W as apps/worker
    participant C as core
    participant DB as PostgreSQL
    participant WA as whatsapp
    actor CL as Cliente final
    actor L as Lojista

    Note over W: job diário
    W->>C: listOverdueReceivables()
    C->>DB: recebíveis vencidos por empresa
    DB-->>C: lista

    loop cada recebível vencido
        C->>C: cliente tem consentimento? (RNF-032)
        alt sem consentimento
            C->>DB: registra "bloqueado por falta de consentimento"
            Note over C: nunca envia — LGPD
        else com consentimento
            C->>DB: já cobrado hoje?
            alt já cobrado
                Note over C: não reenvia — evita assédio
            else
                C->>WA: envia cobrança (valor, vencimento, origem)
                WA->>CL: mensagem
                C->>DB: registra data e canal do envio (RF-069)
            end
        end
    end

    CL->>L: paga
    L->>C: settleReceivable()
    C->>DB: baixa + atualiza saldo do cliente
    Note over C: cobranças futuras daquele recebível cessam (RF-070)
```

## Conciliação bancária

Requisitos: RF-074 a RF-080.

```mermaid
sequenceDiagram
    autonumber
    participant W as apps/worker
    participant BK as banking → Open Finance
    participant C as core
    participant DB as PostgreSQL
    actor L as Lojista

    Note over W: job periódico
    W->>BK: busca transações desde o último marco
    alt consentimento expirado
        BK-->>W: erro de autorização
        W->>C: notifica lojista com link de renovação (RF-075)
        Note over C: conciliações anteriores são preservadas
    else ok
        BK-->>W: transações
        W->>C: importBankTransactions()
        C->>DB: grava ignorando duplicadas por hash externo
    end

    L->>C: abre a conciliação
    C->>DB: busca lançamentos compatíveis por valor e data
    C-->>L: sugestões ordenadas por confiança

    alt sugestão correta
        L->>C: confirma
        C->>DB: marca transação e lançamento como conciliados
    else sem correspondência
        L->>C: cria lançamento a partir da transação (RF-079)
    else conciliação errada já feita
        L->>C: desfaz
        C->>DB: ambos voltam à fila (RF-080)
    end
```

## Assinatura e bloqueio por inadimplência

Requisitos: RF-110 a RF-118.

```mermaid
stateDiagram-v2
    [*] --> Trial: empresa criada
    Trial --> Ativa: plano contratado e pago
    Trial --> Restrita: trial expirado sem plano

    Ativa --> Vencida: cobrança não paga
    Vencida --> Ativa: pagamento confirmado
    Vencida --> Restrita: prazo de tolerância esgotado

    Restrita --> Ativa: pagamento confirmado
    Restrita --> Encerrada: cancelamento pelo lojista

    Encerrada --> [*]

    note right of Restrita
        Restrita NÃO é bloqueio total:
        • leitura ✅
        • exportação ✅ (RF-126)
        • criar lançamento ❌
        • assistente responde
          informando o bloqueio
    end note
```

O estado `Restrita` é decisão de produto, não limitação técnica: sequestrar o
dado do lojista para forçar pagamento contradiz o princípio 5 da
[visão](../produto/visao.md#princípios-de-produto), e transforma um cliente
inadimplente em detrator.

## Cancelamento de venda com nota emitida

Requisitos: RF-043, RF-050, RF-051.

```mermaid
flowchart TD
    START([lojista pede cancelamento]) --> HASINV{nota emitida?}

    HASINV -->|não| REVERT
    HASINV -->|sim| DEADLINE{dentro do<br/>prazo legal?}

    DEADLINE -->|sim| CANCELNF[cancela na SEFAZ<br/>com justificativa]
    DEADLINE -->|não| REFUSE[recusa o cancelamento<br/>orienta devolução<br/>RF-051]

    CANCELNF --> OK{SEFAZ aceitou?}
    OK -->|não| FAIL[informa o erro<br/>nada é estornado]
    OK -->|sim| REVERT

    REVERT[/"estorno em uma transação:<br/>• estoque volta<br/>• recebíveis cancelados<br/>• carteira restaurada<br/>• auditoria registra quem e por quê"/]
    REVERT --> DONE([venda marcada como cancelada<br/>nunca apagada — RNF-040])

    style REFUSE fill:#7c2d12,color:#fff
    style FAIL fill:#7c2d12,color:#fff
    style DONE fill:#14532d,color:#fff
```

**A ordem importa:** cancela a nota **antes** de estornar. O contrário deixaria
o sistema estornado e a SEFAZ com nota válida — divergência fiscal que ninguém
percebe até a fiscalização.

## Onboarding até a primeira venda

Alvo: 15 minutos ([M3](../produto/visao.md#métricas-de-sucesso)).

```mermaid
flowchart LR
    A([baixa o app]) --> B[cadastro por CNPJ<br/>~2 min]
    B --> C[regime tributário<br/>~1 min]
    C --> D{quer emitir<br/>nota agora?}
    D -->|não| F
    D -->|sim| E[certificado A1<br/>~3 min]
    E --> F[cadastra 1 produto<br/>~2 min]
    F --> G[primeira venda<br/>~1 min]
    G --> H([valor percebido])

    C -.->|opcional, depois| I[vincular WhatsApp]
    C -.->|opcional, depois| J[convidar funcionário]
    C -.->|opcional, depois| K[conta bancária]

    style H fill:#14532d,color:#fff
```

Tudo que não está no caminho principal é adiável. O certificado digital é o
maior risco de abandono — por isso é pulável, com a emissão fiscal desativada
até ser configurado.

## Documentos relacionados

- [Princípios](principios.md) — as regras que estes fluxos respeitam
- [Visão geral](visao-geral.md) — os containers envolvidos
- [Dados](dados.md) — as tabelas tocadas por estas transações
- [User Stories](../produto/user-stories.md) — os critérios de aceite
