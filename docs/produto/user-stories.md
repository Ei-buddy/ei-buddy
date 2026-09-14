# User Stories

13 épicos, 64 histórias. Fonte de origem dos requisitos em
[`requisitos-funcionais.md`](requisitos-funcionais.md).

## Como ler

```
#### US-000 — Título
**Como** <persona>, **quero** <ação> **para** <benefício>.
`PRIORIDADE` · persona · módulos envolvidos · requisitos gerados

- **DADO** <contexto> **QUANDO** <ação> **ENTÃO** <resultado esperado>
```

**Prioridade (MoSCoW):** `MUST` entra no MVP · `SHOULD` entra se couber ·
`COULD` fica para depois · `WON'T` está fora, registrado para não voltar à pauta.

**Personas:** [P1 Cláudia (lojista)](personas.md#p1--cláudia-a-lojista) ·
[P2 Marcos (funcionário)](personas.md#p2--marcos-o-funcionário) ·
[P3 Roberto (contador)](personas.md#p3--roberto-o-contador) ·
[P4 João (cliente final)](personas.md#p4--joão-o-cliente-final) ·
[P5 Ana (admin)](personas.md#p5--ana-a-administradora-da-plataforma)

Os critérios de aceite listam o caminho feliz **e** pelo menos um caminho de
erro. Uma história sem caminho de erro não está pronta para ser pega — ver
[Definition of Ready](../processo/rituais.md#definition-of-ready).

## Índice de épicos

| Épico                                  | Tema                         | Histórias  | Prioridade dominante |
| -------------------------------------- | ---------------------------- | ---------- | -------------------- |
| [E1](#e1--onboarding--empresa)         | Onboarding & Empresa         | US-001–004 | MUST                 |
| [E2](#e2--clientes--crm)               | Clientes / CRM               | US-005–008 | MUST                 |
| [E3](#e3--produtos--estoque)           | Produtos & Estoque           | US-009–013 | MUST                 |
| [E4](#e4--vendas--pdv)                 | Vendas & PDV                 | US-014–021 | MUST                 |
| [E5](#e5--emissão-fiscal)              | Emissão Fiscal               | US-022–025 | MUST                 |
| [E6](#e6--contas-a-pagar)              | Contas a Pagar               | US-026–029 | MUST                 |
| [E7](#e7--contas-a-receber)            | Contas a Receber             | US-030–034 | MUST                 |
| [E8](#e8--bancos--conciliação)         | Bancos & Conciliação         | US-035–038 | SHOULD               |
| [E9](#e9--plano-de-contas--relatórios) | Plano de Contas & Relatórios | US-039–042 | SHOULD               |
| [E10](#e10--agenda)                    | Agenda                       | US-043–045 | COULD                |
| [E11](#e11--assistente-whatsapp)       | Assistente WhatsApp          | US-046–053 | MUST                 |
| [E12](#e12--assinatura--cobrança-saas) | Assinatura & Cobrança SaaS   | US-054–058 | MUST                 |
| [E13](#e13--plataforma)                | Plataforma                   | US-059–064 | MUST                 |

---

## E1 — Onboarding & Empresa

> Objetivo: da instalação até a primeira venda em menos de 15 minutos
> ([M3](visao.md#métricas-de-sucesso)).

#### US-001 — Cadastrar a empresa

**Como** lojista, **quero** cadastrar minha empresa pelo CNPJ **para** começar a
usar o sistema sem digitar tudo à mão.
`MUST` · P1 · `apps/web` `apps/mobile` `packages/core` `packages/db` · RF-001, RF-002, RF-094

- **DADO** um CNPJ válido **QUANDO** confirmo **ENTÃO** razão social, nome fantasia e endereço vêm preenchidos e eu só reviso
- **DADO** um CNPJ inválido ou inexistente **QUANDO** confirmo **ENTÃO** vejo o erro no campo e nada é criado
- **DADO** um CNPJ já cadastrado **QUANDO** confirmo **ENTÃO** sou orientado a pedir acesso ao dono, sem revelar dados da empresa existente
- **DADO** que a consulta ao CNPJ está indisponível **QUANDO** confirmo **ENTÃO** posso preencher manualmente e seguir
- **DADO** cadastro sem celular do owner **QUANDO** confirmo **ENTÃO** o campo é recusado e nada é criado
- **DADO** um celular já usado por outro owner **QUANDO** confirmo **ENTÃO** sou recusado sem ver de quem é a loja

#### US-002 — Configurar dados fiscais

**Como** lojista, **quero** informar meu regime tributário e certificado digital
**para** conseguir emitir nota fiscal.
`MUST` · P1 · `apps/web` `packages/core` `packages/fiscal` · RF-003, RF-004

- **DADO** que escolho o regime tributário **QUANDO** salvo **ENTÃO** o cálculo de imposto das vendas passa a usar esse regime
- **DADO** que envio um certificado A1 com a senha correta **QUANDO** salvo **ENTÃO** o certificado é armazenado cifrado e vejo a data de validade
- **DADO** um certificado vencido ou senha errada **QUANDO** salvo **ENTÃO** vejo o motivo exato da recusa e nada é armazenado
- **DADO** um certificado a menos de 30 dias do vencimento **QUANDO** acesso o sistema **ENTÃO** sou avisado

#### US-003 — Convidar funcionário

**Como** lojista, **quero** convidar um funcionário e definir o que ele pode
fazer **para** delegar o atendimento sem expor meus números.
`MUST` · P1 · `apps/web` `packages/core` `packages/db` · RF-005, RF-006

- **DADO** que convido por e-mail ou telefone **QUANDO** envio **ENTÃO** ele recebe o convite e entra com o papel `staff`
- **DADO** um funcionário com papel `staff` **QUANDO** ele abre o app **ENTÃO** não vê custo, margem nem relatório financeiro
- **DADO** que removo o acesso de um funcionário **QUANDO** confirmo **ENTÃO** a sessão dele é encerrada e o histórico de ações dele permanece

#### US-004 — Configurar a loja

**Como** lojista, **quero** configurar formas de pagamento, taxas de cartão e
limite de desconto **para** que os cálculos reflitam meu negócio.
`MUST` · P1 · `apps/web` `packages/core` `packages/domain` · RF-007, RF-008

- **DADO** que cadastro as taxas da minha adquirente por bandeira e parcelamento **QUANDO** salvo **ENTÃO** o líquido das vendas passa a descontar essas taxas
- **DADO** que defino desconto máximo de 10% para `staff` **QUANDO** o funcionário tenta dar 15% **ENTÃO** a venda é bloqueada com aviso
- **DADO** que desativo uma forma de pagamento **QUANDO** abro uma venda **ENTÃO** ela não aparece como opção

---

## E2 — Clientes / CRM

#### US-005 — Cadastro rápido de cliente

**Como** lojista, **quero** cadastrar um cliente só com nome e telefone **para**
não travar o atendimento.
`MUST` · P1 P2 · `apps/mobile` `packages/core` `packages/contracts` · RF-009, RF-010

- **DADO** que informo apenas nome e telefone **QUANDO** salvo **ENTÃO** o cliente é criado e já pode ser usado na venda
- **DADO** um telefone já cadastrado **QUANDO** salvo **ENTÃO** vejo o cliente existente e escolho usar ou criar outro
- **DADO** que informo CPF **QUANDO** salvo **ENTÃO** o CPF é validado e usado na nota fiscal

#### US-006 — Histórico do cliente

**Como** lojista, **quero** ver o que um cliente já comprou **para** atender
melhor e sugerir a recompra.
`MUST` · P1 P2 · `apps/mobile` `apps/web` `packages/core` · RF-011, RF-012

- **DADO** um cliente com compras **QUANDO** abro o cadastro **ENTÃO** vejo as vendas em ordem decrescente com data, itens e valor
- **DADO** um cliente sem compras **QUANDO** abro o cadastro **ENTÃO** vejo um estado vazio claro, não uma tela em branco
- **DADO** um funcionário `staff` **QUANDO** abre o histórico **ENTÃO** vê os itens mas não a margem

#### US-007 — Saldo em carteira (fiado)

**Como** lojista, **quero** controlar o fiado do cliente **para** parar de
anotar no caderno.
`MUST` · P1 · `apps/mobile` `packages/core` `packages/domain` `packages/money` · RF-013, RF-014

- **DADO** uma venda paga em `wallet` **QUANDO** fecho a venda **ENTÃO** o saldo devedor do cliente aumenta e uma conta a receber é criada
- **DADO** um cliente com saldo devedor **QUANDO** ele paga **ENTÃO** registro o pagamento e o saldo diminui no mesmo valor
- **DADO** um cliente com saldo devedor **QUANDO** inicio uma nova venda para ele **ENTÃO** sou avisado do saldo antes de fechar

#### US-008 — Vincular WhatsApp do cliente

**Como** lojista, **quero** que o número de WhatsApp do cliente fique ligado ao
cadastro **para** cobrar e enviar comprovante direto da conversa.
`MUST` · P1 P4 · `packages/core` `packages/whatsapp` · RF-015, RF-016

- **DADO** um cliente com telefone cadastrado **QUANDO** envio uma cobrança **ENTÃO** ela vai para aquele número
- **DADO** um cliente sem consentimento registrado **QUANDO** tento enviar mensagem **ENTÃO** sou informado de que preciso do aceite dele primeiro
- **DADO** que o cliente pede para não receber mais **QUANDO** ele responde o opt-out **ENTÃO** o sistema para de enviar e registra a data

> Depende de [DEC-003](../decisoes/README.md#dec-003) (provedor de WhatsApp) e
> [DEC-008](../decisoes/README.md#dec-008) (vínculo telefone ↔ identidade).

---

## E3 — Produtos & Estoque

#### US-009 — Cadastrar produto com código de barras

**Como** lojista, **quero** cadastrar produto bipando o código de barras
**para** não digitar código errado.
`MUST` · P1 · `apps/mobile` `packages/core` `packages/db` · RF-017, RF-018, RF-019

- **DADO** que bipo um código novo **QUANDO** o sistema não o encontra **ENTÃO** abre o cadastro já com o código preenchido
- **DADO** que bipo um código já cadastrado **QUANDO** o sistema o encontra **ENTÃO** abre o produto existente para edição
- **DADO** um produto sem código de barras **QUANDO** salvo **ENTÃO** o sistema gera um código interno

#### US-010 — Definir preço e custo

**Como** lojista, **quero** informar custo e preço de venda **para** saber a
margem de cada produto.
`MUST` · P1 · `apps/mobile` `apps/web` `packages/domain` `packages/money` · RF-020, RF-021

- **DADO** custo e preço informados **QUANDO** salvo **ENTÃO** vejo a margem em % e em valor
- **DADO** um preço menor que o custo **QUANDO** salvo **ENTÃO** sou avisado, mas posso confirmar mesmo assim
- **DADO** um valor monetário **QUANDO** é armazenado **ENTÃO** é gravado em centavos, sem ponto flutuante

#### US-011 — Consultar estoque

**Como** funcionário, **quero** consultar o estoque de um produto **para**
responder ao cliente sem chamar a dona.
`MUST` · P2 · `apps/mobile` `packages/core` · RF-022

- **DADO** que bipo ou busco um produto **QUANDO** ele existe **ENTÃO** vejo saldo, preço e localização
- **DADO** um produto sem controle de estoque **QUANDO** consulto **ENTÃO** vejo "sem controle de estoque", não zero

#### US-012 — Ajustar estoque

**Como** lojista, **quero** ajustar o saldo de um produto **para** corrigir
divergência de inventário.
`MUST` · P1 · `apps/mobile` `packages/core` · RF-023, RF-024

- **DADO** um ajuste com motivo **QUANDO** confirmo **ENTÃO** o saldo muda e fica um `InventoryMovement` com autoria, motivo e data
- **DADO** um ajuste que deixaria o saldo negativo **QUANDO** confirmo **ENTÃO** sou avisado e preciso confirmar de novo
- **DADO** uma venda registrada **QUANDO** ela é fechada **ENTÃO** o estoque baixa automaticamente

#### US-013 — Alerta de estoque baixo

**Como** lojista, **quero** ser avisado quando um produto estiver acabando
**para** repor antes de perder venda.
`SHOULD` · P1 · `apps/worker` `packages/core` `packages/whatsapp` · RF-025, RF-026

- **DADO** um produto com estoque mínimo definido **QUANDO** o saldo cruza esse mínimo **ENTÃO** recebo um aviso
- **DADO** vários produtos abaixo do mínimo no mesmo dia **QUANDO** o aviso é gerado **ENTÃO** recebo uma mensagem consolidada, não uma por produto

---

## E4 — Vendas & PDV

> O caminho crítico do produto. Ver
> [fluxo de venda](../arquitetura/fluxos.md#venda-completa).

#### US-014 — Montar carrinho com leitor de código de barras

**Como** funcionário, **quero** bipar os produtos **para** fechar a venda sem
digitar.
`MUST` · P1 P2 · `apps/mobile` `packages/core` · RF-027, RF-028

- **DADO** um carrinho aberto **QUANDO** bipo um código válido **ENTÃO** o item entra com preço atual e a quantidade soma se já estiver no carrinho
- **DADO** um código inexistente **QUANDO** bipo **ENTÃO** vejo o erro e o carrinho não muda
- **DADO** um produto sem estoque **QUANDO** bipo **ENTÃO** sou avisado e decido se continuo
- **DADO** que bipo vários itens em sequência **QUANDO** cada leitura ocorre **ENTÃO** o retorno é imediato, sem esperar rede ([RNF-051](requisitos-nao-funcionais.md))

#### US-015 — Adicionar produto por busca

**Como** funcionário, **quero** buscar o produto por nome **para** vender item
sem código de barras.
`MUST` · P1 P2 · `apps/mobile` `packages/core` · RF-029

- **DADO** que digito parte do nome **QUANDO** busco **ENTÃO** vejo resultados ordenados por mais vendidos
- **DADO** que a busca não encontra nada **QUANDO** termino de digitar **ENTÃO** posso cadastrar o produto ali mesmo

#### US-016 — Aplicar desconto

**Como** lojista, **quero** dar desconto no item ou na venda **para** fechar a
negociação.
`MUST` · P1 P2 · `apps/mobile` `packages/domain` · RF-030, RF-031

- **DADO** um desconto em % ou em valor **QUANDO** aplico **ENTÃO** o total recalcula e vejo o impacto na margem (se sou `owner`)
- **DADO** um `staff` com limite de 10% **QUANDO** ele tenta 15% **ENTÃO** é bloqueado com o motivo
- **DADO** um desconto maior que o total **QUANDO** aplico **ENTÃO** é recusado

#### US-017 — Selecionar cliente na venda

**Como** funcionário, **quero** vincular a venda a um cliente **para** manter o
histórico e permitir fiado.
`MUST` · P1 P2 · `apps/mobile` `packages/core` · RF-032, RF-033

- **DADO** um carrinho **QUANDO** busco o cliente por nome ou telefone **ENTÃO** posso selecioná-lo ou criar um novo sem sair da venda
- **DADO** uma venda sem cliente **QUANDO** fecho **ENTÃO** ela é registrada como consumidor não identificado, exceto se o pagamento for `wallet`

#### US-018 — Pagamento com forma única

**Como** funcionário, **quero** registrar o pagamento **para** fechar a venda.
`MUST` · P1 P2 · `apps/mobile` `packages/core` `packages/domain` · RF-034, RF-035, RF-036

- **DADO** um carrinho **QUANDO** escolho `cash`, `pix`, `debit`, `credit` ou `wallet` **ENTÃO** a venda é fechada com o total registrado naquela forma
- **DADO** pagamento em `cash` maior que o total **QUANDO** confirmo **ENTÃO** vejo o troco calculado
- **DADO** pagamento em `wallet` **QUANDO** confirmo **ENTÃO** exige cliente identificado e gera conta a receber
- **DADO** uma falha ao fechar **QUANDO** tento de novo **ENTÃO** não é criada uma venda duplicada ([RNF-043](requisitos-nao-funcionais.md))

#### US-019 — Pagamento misto e parcelado

**Como** funcionário, **quero** dividir o pagamento entre formas e parcelar
**para** atender como o cliente pode pagar.
`MUST` · P1 P2 · `apps/mobile` `packages/domain` `packages/money` · RF-037, RF-038, RF-039

- **DADO** um total de R$ 100 **QUANDO** registro R$ 60 em `pix` e R$ 40 em `cash` **ENTÃO** a venda fecha e o restante mostrado é zero
- **DADO** a soma das formas diferente do total **QUANDO** tento fechar **ENTÃO** sou bloqueado com a diferença exibida
- **DADO** um `credit` em 3x **QUANDO** fecho **ENTÃO** são criadas 3 contas a receber com vencimentos e a tarifa de cada parcela
- **DADO** uma divisão com dízima (R$ 100 em 3x) **QUANDO** as parcelas são criadas **ENTÃO** a soma delas é exatamente o total, com o resto na primeira parcela

#### US-020 — Ver o líquido da venda

**Como** lojista, **quero** ver quanto sobra depois de imposto e taxa **para**
saber o lucro real.
`MUST` · P1 · `apps/mobile` `packages/domain` · RF-040, RF-041, RF-042

- **DADO** uma venda fechada **QUANDO** vejo o resumo **ENTÃO** vejo bruto, custo, imposto, tarifa de cartão, líquido e margem
- **DADO** um regime `simples_nacional` **QUANDO** a venda fecha **ENTÃO** o imposto usa a alíquota configurada
- **DADO** um `staff` **QUANDO** fecha a venda **ENTÃO** vê o total, mas não custo, imposto nem margem

#### US-021 — Cancelar ou devolver venda

**Como** lojista, **quero** cancelar ou devolver uma venda **para** corrigir
erro sem apagar histórico.
`MUST` · P1 · `apps/mobile` `packages/core` `packages/fiscal` · RF-043, RF-044

- **DADO** uma venda do dia sem nota emitida **QUANDO** cancelo **ENTÃO** estoque, contas a receber e carteira voltam ao estado anterior
- **DADO** uma venda com nota emitida dentro do prazo legal **QUANDO** cancelo **ENTÃO** a nota é cancelada na SEFAZ antes do estorno
- **DADO** uma devolução parcial **QUANDO** confirmo os itens **ENTÃO** só esses itens voltam ao estoque e o valor proporcional é estornado
- **DADO** qualquer cancelamento **QUANDO** confirmo **ENTÃO** fica registrado quem, quando e por quê — a venda nunca é apagada

---

## E5 — Emissão Fiscal

> Depende de [DEC-004](../decisoes/README.md#dec-004) (provedor fiscal).

#### US-022 — Emitir NFC-e na venda

**Como** lojista, **quero** emitir a nota ao fechar a venda **para** ficar em
dia com o fisco sem passo extra.
`MUST` · P1 P2 · `apps/api` `apps/worker` `packages/fiscal` · RF-045, RF-046, RF-047

- **DADO** uma venda fechada com dados fiscais completos **QUANDO** a emissão é solicitada **ENTÃO** a nota é autorizada e vejo a chave de acesso
- **DADO** um produto sem NCM ou CFOP **QUANDO** tento emitir **ENTÃO** sou avisado de qual produto e qual campo falta, antes de enviar à SEFAZ
- **DADO** uma rejeição da SEFAZ **QUANDO** ela ocorre **ENTÃO** vejo o código e a descrição em linguagem clara, e a venda continua registrada
- **DADO** uma emissão bem-sucedida **QUANDO** ela ocorre **ENTÃO** o XML é guardado pelo prazo legal ([RNF-037](requisitos-nao-funcionais.md))

#### US-023 — Enviar a nota ao cliente

**Como** lojista, **quero** enviar o DANFE ao cliente **para** não precisar
imprimir.
`MUST` · P1 P4 · `packages/whatsapp` `packages/fiscal` · RF-048, RF-049

- **DADO** uma nota autorizada e um cliente com WhatsApp **QUANDO** a venda fecha **ENTÃO** o link/PDF é enviado automaticamente
- **DADO** um cliente sem WhatsApp **QUANDO** a venda fecha **ENTÃO** vejo o QR Code na tela para o cliente fotografar

#### US-024 — Cancelar nota fiscal

**Como** lojista, **quero** cancelar uma nota emitida por engano **para**
corrigir dentro do prazo.
`MUST` · P1 · `packages/fiscal` `packages/core` · RF-050, RF-051

- **DADO** uma nota dentro do prazo legal **QUANDO** cancelo informando a justificativa **ENTÃO** o cancelamento é registrado na SEFAZ
- **DADO** uma nota fora do prazo **QUANDO** tento cancelar **ENTÃO** sou informado do prazo e orientado a emitir devolução

#### US-025 — Emitir em contingência

**Como** lojista, **quero** continuar vendendo com a SEFAZ fora do ar **para**
não parar a loja.
`MUST` · P1 P2 · `apps/worker` `packages/fiscal` · RF-052, RF-053, RF-054

- **DADO** a SEFAZ indisponível **QUANDO** fecho a venda **ENTÃO** a nota entra em contingência e a venda é concluída normalmente
- **DADO** notas em contingência **QUANDO** a SEFAZ volta **ENTÃO** elas são transmitidas automaticamente, em ordem
- **DADO** uma nota em contingência **QUANDO** consulto a venda **ENTÃO** vejo o estado explícito, não um sucesso falso

---

## E6 — Contas a Pagar

#### US-026 — Lançar conta a pagar

**Como** lojista, **quero** registrar uma conta a pagar **para** não esquecer de
pagar.
`MUST` · P1 · `apps/web` `apps/mobile` `packages/core` · RF-055, RF-056

- **DADO** fornecedor, valor e vencimento **QUANDO** salvo **ENTÃO** a conta aparece no fluxo de caixa previsto
- **DADO** um vencimento no passado **QUANDO** salvo **ENTÃO** ela é criada já como `overdue`
- **DADO** uma conta com anexo (boleto/nota) **QUANDO** salvo **ENTÃO** o arquivo fica associado à conta

#### US-027 — Conta recorrente

**Como** lojista, **quero** cadastrar contas que se repetem **para** não lançar
aluguel e luz todo mês.
`SHOULD` · P1 · `apps/worker` `packages/core` · RF-057, RF-058

- **DADO** uma conta mensal **QUANDO** salvo com recorrência **ENTÃO** as próximas ocorrências são geradas com o mesmo dia de vencimento
- **DADO** que altero o valor de uma ocorrência **QUANDO** salvo **ENTÃO** só aquela muda, as futuras seguem o valor padrão
- **DADO** que encerro a recorrência **QUANDO** confirmo **ENTÃO** as ocorrências futuras não pagas são removidas e as pagas permanecem

#### US-028 — Dar baixa em conta paga

**Como** lojista, **quero** marcar a conta como paga **para** o caixa refletir a
realidade.
`MUST` · P1 · `apps/mobile` `packages/core` `packages/money` · RF-059, RF-060

- **DADO** uma conta em aberto **QUANDO** dou baixa informando data e conta bancária **ENTÃO** ela sai do previsto e entra no realizado
- **DADO** um pagamento parcial **QUANDO** registro **ENTÃO** o saldo restante continua em aberto
- **DADO** uma baixa feita por engano **QUANDO** estorno **ENTÃO** a conta volta ao estado anterior com registro do estorno

#### US-029 — Ver contas a vencer

**Como** lojista, **quero** ver o que vence nos próximos dias **para** me
organizar.
`MUST` · P1 · `apps/mobile` `apps/web` `packages/core` · RF-061, RF-062

- **DADO** contas cadastradas **QUANDO** abro a visão de pagar **ENTÃO** vejo vencidas, hoje, esta semana e este mês, com o total de cada grupo
- **DADO** contas vencidas **QUANDO** abro o sistema **ENTÃO** elas aparecem em destaque no topo

---

## E7 — Contas a Receber

#### US-030 — Receber gerado pela venda

**Como** lojista, **quero** que a venda gere o recebível sozinha **para** não
lançar duas vezes.
`MUST` · P1 · `packages/core` `packages/domain` · RF-063, RF-064

- **DADO** uma venda em `credit` parcelado **QUANDO** ela fecha **ENTÃO** é criado um recebível por parcela, com o **valor líquido** e a data prevista de repasse
- **DADO** uma venda em `cash` ou `pix` **QUANDO** ela fecha **ENTÃO** o recebível já nasce liquidado
- **DADO** uma venda em `wallet` **QUANDO** ela fecha **ENTÃO** o recebível fica em aberto vinculado ao cliente

#### US-031 — Lançar recebimento avulso

**Como** lojista, **quero** lançar um valor a receber fora de venda **para**
registrar entradas diversas.
`SHOULD` · P1 · `apps/web` `packages/core` · RF-065

- **DADO** valor, origem e vencimento **QUANDO** salvo **ENTÃO** o recebível entra no fluxo previsto
- **DADO** um recebível avulso **QUANDO** classifico numa conta contábil **ENTÃO** ele entra no DRE naquela linha

#### US-032 — Dar baixa em recebimento

**Como** lojista, **quero** marcar o que recebi **para** saber quem ainda deve.
`MUST` · P1 · `apps/mobile` `packages/core` · RF-066, RF-067

- **DADO** um recebível em aberto **QUANDO** dou baixa **ENTÃO** ele sai do previsto, entra no realizado e o saldo do cliente diminui
- **DADO** um recebimento parcial **QUANDO** registro **ENTÃO** o restante continua em aberto com o mesmo vencimento
- **DADO** uma baixa por engano **QUANDO** estorno **ENTÃO** o saldo do cliente é restaurado

#### US-033 — Enviar cobrança

**Como** lojista, **quero** cobrar o cliente pelo WhatsApp **para** receber sem
constrangimento.
`MUST` · P1 P4 · `packages/whatsapp` `packages/core` · RF-068, RF-069, RF-070

- **DADO** um cliente com recebível vencido e consentimento **QUANDO** envio a cobrança **ENTÃO** ele recebe uma mensagem com valor, vencimento e o que originou a dívida
- **DADO** uma cobrança enviada **QUANDO** consulto o recebível **ENTÃO** vejo data e canal do último envio
- **DADO** um cliente sem consentimento **QUANDO** tento cobrar **ENTÃO** sou bloqueado e orientado
- **DADO** que o cliente paga **QUANDO** dou baixa **ENTÃO** nenhuma cobrança futura daquele recebível é disparada

#### US-034 — Ver inadimplentes

**Como** lojista, **quero** ver quem está devendo **para** priorizar a cobrança.
`MUST` · P1 · `apps/mobile` `apps/web` `packages/core` · RF-071, RF-072

- **DADO** recebíveis vencidos **QUANDO** abro a visão **ENTÃO** vejo clientes ordenados por valor devido, com dias de atraso
- **DADO** um cliente inadimplente **QUANDO** abro o cadastro dele **ENTÃO** vejo o alerta antes de iniciar nova venda

---

## E8 — Bancos & Conciliação

> Depende de [DEC-005](../decisoes/README.md#dec-005) (provedor Open Finance).

#### US-035 — Cadastrar conta bancária

**Como** lojista, **quero** cadastrar minhas contas **para** separar o dinheiro
por origem.
`SHOULD` · P1 · `apps/web` `packages/core` · RF-073

- **DADO** banco, agência e conta **QUANDO** salvo **ENTÃO** ela fica disponível para baixas e conciliação
- **DADO** uma conta com saldo inicial **QUANDO** salvo **ENTÃO** o saldo é o ponto de partida do extrato interno

#### US-036 — Conectar via Open Finance

**Como** lojista, **quero** conectar minha conta bancária **para** o extrato
entrar sozinho.
`SHOULD` · P1 · `packages/banking` `apps/worker` · RF-074, RF-075

- **DADO** que autorizo o acesso no banco **QUANDO** a conexão é concluída **ENTÃO** as transações passam a ser importadas periodicamente
- **DADO** um consentimento expirado **QUANDO** a importação falha **ENTÃO** sou avisado com o link para renovar, e a conciliação anterior é preservada
- **DADO** transações já importadas **QUANDO** a importação roda de novo **ENTÃO** nada é duplicado

#### US-037 — Importar extrato manualmente

**Como** lojista, **quero** subir um OFX/CSV **para** conciliar mesmo sem Open
Finance.
`SHOULD` · P1 · `apps/web` `packages/banking` · RF-076, RF-077

- **DADO** um arquivo OFX válido **QUANDO** importo **ENTÃO** vejo quantas transações entraram e quantas foram ignoradas por duplicidade
- **DADO** um arquivo inválido **QUANDO** importo **ENTÃO** vejo o erro e nada é importado parcialmente

#### US-038 — Conciliar transação

**Como** lojista, **quero** casar o extrato com meus lançamentos **para** ter
certeza de que os números batem.
`SHOULD` · P1 · `apps/web` `packages/core` · RF-078, RF-079, RF-080

- **DADO** uma transação do extrato **QUANDO** abro a conciliação **ENTÃO** o sistema sugere lançamentos compatíveis por valor e data
- **DADO** uma sugestão correta **QUANDO** confirmo **ENTÃO** transação e lançamento ficam conciliados e somem da fila
- **DADO** uma transação sem correspondência **QUANDO** decido **ENTÃO** posso criar o lançamento a partir dela
- **DADO** uma conciliação errada **QUANDO** desfaço **ENTÃO** ambos voltam à fila

---

## E9 — Plano de Contas & Relatórios

#### US-039 — Plano de contas padrão

**Como** lojista, **quero** um plano de contas pronto **para** não ter que
inventar um.
`SHOULD` · P1 · `packages/db` `packages/core` · RF-081, RF-082

- **DADO** uma empresa recém-criada **QUANDO** o onboarding termina **ENTÃO** já existe um plano de contas padrão de varejo
- **DADO** que eu quero ajustar **QUANDO** edito o plano **ENTÃO** posso renomear e criar contas, sem apagar conta que já tem lançamento

#### US-040 — Classificar lançamento

**Como** lojista, **quero** classificar entradas e saídas **para** ver onde o
dinheiro está indo.
`SHOULD` · P1 · `apps/web` `packages/core` · RF-083, RF-084

- **DADO** um lançamento **QUANDO** escolho a conta contábil **ENTÃO** ele passa a compor aquela linha do relatório
- **DADO** um lançamento de venda **QUANDO** ele é criado **ENTÃO** já vem classificado na conta de receita padrão
- **DADO** um fornecedor recorrente **QUANDO** lanço de novo **ENTÃO** a classificação anterior é sugerida

#### US-041 — DRE simplificado

**Como** lojista, **quero** ver receita, custo, despesa e resultado do período
**para** saber se o mês fechou no azul.
`SHOULD` · P1 · `apps/web` `packages/core` · RF-085, RF-086

- **DADO** um período **QUANDO** abro o relatório **ENTÃO** vejo receita bruta, deduções, custo, despesas e resultado
- **DADO** uma linha do relatório **QUANDO** clico **ENTÃO** vejo os lançamentos que a compõem
- **DADO** um período sem movimento **QUANDO** abro **ENTÃO** vejo zeros explícitos, não erro

#### US-042 — Exportar para o contador

**Como** lojista, **quero** exportar o mês fechado **para** mandar ao meu
contador.
`SHOULD` · P1 P3 · `apps/web` `packages/core` · RF-087, RF-088

- **DADO** um mês fechado **QUANDO** exporto **ENTÃO** recebo um pacote com lançamentos em CSV e os XMLs das notas emitidas
- **DADO** uma exportação grande **QUANDO** solicito **ENTÃO** ela é processada em segundo plano e sou avisado quando ficar pronta

---

## E10 — Agenda

#### US-043 — Criar compromisso

**Como** lojista, **quero** anotar compromissos **para** não esquecer entrega e
visita de fornecedor.
`COULD` · P1 · `apps/mobile` `packages/core` · RF-089, RF-090

- **DADO** título, data e hora **QUANDO** salvo **ENTÃO** o compromisso aparece na agenda
- **DADO** um compromisso ligado a um cliente **QUANDO** abro o cliente **ENTÃO** vejo os compromissos dele

#### US-044 — Receber lembrete

**Como** lojista, **quero** ser lembrado antes da hora **para** não perder o
compromisso.
`COULD` · P1 · `apps/worker` `packages/whatsapp` · RF-091, RF-092

- **DADO** um compromisso com lembrete **QUANDO** falta o tempo configurado **ENTÃO** recebo a notificação
- **DADO** um compromisso cancelado **QUANDO** o horário do lembrete chega **ENTÃO** nada é enviado

#### US-045 — Ver a agenda do dia

**Como** lojista, **quero** ver o dia de hoje **para** me organizar de manhã.
`COULD` · P1 · `apps/mobile` `packages/agent` · RF-093

- **DADO** compromissos hoje **QUANDO** abro a agenda ou pergunto ao assistente **ENTÃO** vejo a lista em ordem de horário
- **DADO** nenhum compromisso **QUANDO** consulto **ENTÃO** recebo confirmação explícita de agenda livre

---

## E11 — Assistente WhatsApp

> A tese central do produto. O runtime fechou
> ([ADR-0010](../decisoes/adr/0010-mastra-e-gpt-4o-mini.md)). A identidade do
> canal fechou ([DEC-023](../decisoes/README.md#dec-023) /
> [ADR-0012](../decisoes/adr/0012-identidade-do-canal-whatsapp.md)). Ainda
> dependem de [DEC-003](../decisoes/README.md#dec-003) (provedor) e
> [DEC-011](../decisoes/README.md#dec-011) (memória).

#### US-046 — Vincular o número da loja

**Como** lojista, **quero** que o celular do meu cadastro opere o assistente
**para** mandar mensagem sem um passo extra de código.
`MUST` · P1 · `packages/whatsapp` `packages/core` · RF-094, RF-095, RF-132

- **DADO** que me cadastrei com celular **QUANDO** mando mensagem desse número **ENTÃO** o assistente atende na minha primeira empresa, como `owner`
- **DADO** um número que não é o celular de nenhum owner **QUANDO** a mensagem chega **ENTÃO** o assistente não executa nada e não vaza informação
- **DADO** que pertenço a uma segunda empresa **QUANDO** mando WhatsApp **ENTÃO** continuo operando a primeira
- **DADO** um funcionário com telefone **QUANDO** ele manda mensagem **ENTÃO** o assistente ignora (só o owner tem canal)
- **DADO** que troco o celular no app **QUANDO** a sessão é válida **ENTÃO** o número novo substitui o vínculo e o antigo deixa de operar

#### US-047 — Consultar por mensagem

**Como** lojista, **quero** perguntar em linguagem natural **para** saber meus
números sem abrir o app.
`MUST` · P1 · `packages/agent` `packages/core` · RF-096, RF-097

- **DADO** "quanto vendi hoje?" **QUANDO** envio **ENTÃO** recebo o total do dia, número de vendas e ticket médio
- **DADO** "quem está me devendo?" **QUANDO** envio **ENTÃO** recebo os inadimplentes com valor e dias de atraso
- **DADO** uma pergunta que o assistente não entende **QUANDO** envio **ENTÃO** ele diz o que sabe fazer, em vez de inventar resposta
- **DADO** qualquer consulta **QUANDO** ela é respondida **ENTÃO** os dados vêm do mesmo caso de uso que o app usa, nunca de uma consulta paralela

#### US-048 — Cadastrar cliente por mensagem

**Como** lojista, **quero** cadastrar cliente pela conversa **para** não parar o
atendimento.
`MUST` · P1 · `packages/agent` `packages/core` · RF-098, RF-099

- **DADO** "cadastra o João, 11 98888-7777" **QUANDO** envio **ENTÃO** o assistente mostra o que entendeu e pede confirmação
- **DADO** que confirmo **QUANDO** respondo **ENTÃO** o cliente é criado e recebo o aviso
- **DADO** um telefone já cadastrado **QUANDO** confirmo **ENTÃO** sou avisado do duplicado e escolho o que fazer

#### US-049 — Lançar venda por mensagem

**Como** lojista, **quero** registrar a venda pela conversa **para** não
retrabalhar o que já negociei ali.
`MUST` · P1 · `packages/agent` `packages/core` `packages/domain` · RF-100, RF-101, RF-102

- **DADO** "venda pro João: 2 camisetas M a 49,90, pagou no Pix" **QUANDO** envio **ENTÃO** o assistente mostra cliente, itens, total e forma de pagamento para eu confirmar
- **DADO** que confirmo **QUANDO** respondo **ENTÃO** a venda é criada com os mesmos cálculos do app e o estoque baixa
- **DADO** um produto ambíguo **QUANDO** o assistente não decide **ENTÃO** ele pergunta qual, listando as opções
- **DADO** uma venda sem produto cadastrado **QUANDO** confirmo **ENTÃO** posso registrar como item avulso com descrição e valor

#### US-050 — Confirmar ação sensível

**Como** lojista, **quero** confirmar antes que algo mexa em dinheiro **para**
não criar lançamento errado por engano.
`MUST` · P1 · `packages/agent` · RF-103, RF-104

- **DADO** qualquer ação que cria, altera ou apaga valor **QUANDO** o assistente vai executar **ENTÃO** ele resume e espera confirmação explícita
- **DADO** uma consulta **QUANDO** o assistente responde **ENTÃO** não pede confirmação
- **DADO** uma confirmação pendente **QUANDO** passa o tempo limite **ENTÃO** ela expira e nada é executado
- **DADO** que respondo algo ambíguo a uma confirmação **QUANDO** o assistente lê **ENTÃO** ele trata como "não" e pergunta de novo

#### US-051 — Manter o contexto da conversa

**Como** lojista, **quero** que o assistente lembre do que falamos **para** não
repetir tudo a cada mensagem.
`MUST` · P1 · `packages/agent` · RF-105, RF-106

> Ainda depende da [DEC-011](../decisoes/README.md#dec-011). O recorte da
> [ADR-0012](../decisoes/adr/0012-identidade-do-canal-whatsapp.md) não persiste
> conversa nem liga Memory do Mastra.

- **DADO** que acabei de falar de um cliente **QUANDO** digo "manda a cobrança pra ele" **ENTÃO** o assistente sabe quem é "ele"
- **DADO** uma conversa parada por muito tempo **QUANDO** volto **ENTÃO** o contexto antigo não é aplicado silenciosamente a uma ação nova
- **DADO** o contexto de uma empresa **QUANDO** outra empresa conversa **ENTÃO** nunca há vazamento entre conversas

#### US-052 — Enviar cobrança por mensagem

**Como** lojista, **quero** disparar a cobrança pela conversa **para** cobrar no
momento em que lembro.
`MUST` · P1 · `packages/agent` `packages/whatsapp` · RF-107

- **DADO** "manda a cobrança pro João" **QUANDO** confirmo **ENTÃO** a cobrança é enviada ao cliente e recebo a confirmação do envio
- **DADO** um cliente sem dívida **QUANDO** peço **ENTÃO** o assistente informa que não há o que cobrar

#### US-053 — Receber relatório por mensagem

**Como** lojista, **quero** pedir relatórios pela conversa **para** acompanhar o
negócio de onde eu estiver.
`SHOULD` · P1 · `packages/agent` `packages/core` · RF-108, RF-109

- **DADO** "resumo do mês" **QUANDO** envio **ENTÃO** recebo faturamento, custo, despesas e resultado
- **DADO** um relatório muito grande para uma mensagem **QUANDO** peço **ENTÃO** recebo um resumo e um arquivo ou link para o detalhe

---

## E12 — Assinatura & Cobrança SaaS

> Depende de [DEC-010](../decisoes/README.md#dec-010) e [DEC-012](../decisoes/README.md#dec-012).

#### US-054 — Período de teste

**Como** lojista, **quero** testar antes de pagar **para** ter certeza de que
serve para mim.
`MUST` · P1 · `packages/billing` `packages/core` · RF-110, RF-111

- **DADO** uma empresa nova **QUANDO** o cadastro conclui **ENTÃO** o trial começa com prazo e limites claros
- **DADO** o trial acabando **QUANDO** faltam poucos dias **ENTÃO** sou avisado com antecedência
- **DADO** o trial expirado sem plano **QUANDO** acesso **ENTÃO** continuo podendo **ler e exportar** meus dados, mas não criar novos lançamentos

#### US-055 — Escolher plano e pagar

**Como** lojista, **quero** assinar um plano **para** continuar usando.
`MUST` · P1 · `apps/web` `packages/billing` · RF-112, RF-113

- **DADO** os planos disponíveis **QUANDO** escolho e pago **ENTÃO** a assinatura fica ativa imediatamente
- **DADO** um pagamento recusado **QUANDO** ocorre **ENTÃO** vejo o motivo e posso tentar outra forma sem perder dados
- **DADO** uma assinatura ativa **QUANDO** troco de plano **ENTÃO** a diferença é tratada conforme a regra do plano, sem cobrança duplicada

#### US-056 — Aplicar cupom

**Como** lojista, **quero** usar um cupom **para** aproveitar uma promoção.
`SHOULD` · P1 · `packages/billing` · RF-114, RF-115

- **DADO** um cupom válido **QUANDO** aplico **ENTÃO** vejo o desconto antes de confirmar
- **DADO** um cupom expirado, inválido ou já usado **QUANDO** aplico **ENTÃO** vejo o motivo exato da recusa

#### US-057 — Aviso de inadimplência

**Como** lojista, **quero** ser avisado antes de perder o acesso **para** ter
chance de regularizar.
`MUST` · P1 · `apps/worker` `packages/billing` `packages/whatsapp` · RF-116

- **DADO** uma cobrança não paga **QUANDO** vence **ENTÃO** recebo aviso por WhatsApp e e-mail, com prazo até o bloqueio
- **DADO** que pago dentro do prazo **QUANDO** o pagamento é confirmado **ENTÃO** os avisos param e nada é bloqueado

#### US-058 — Bloqueio por inadimplência

**Como** administradora da plataforma, **quero** que o acesso seja restrito
após o prazo **para** proteger a receita sem sequestrar dados do cliente.
`MUST` · P5 P1 · `packages/billing` `apps/api` · RF-117, RF-118

- **DADO** o prazo de tolerância vencido **QUANDO** o bloqueio ocorre **ENTÃO** o lojista não cria novos lançamentos, mas **continua lendo e exportando** tudo
- **DADO** uma empresa bloqueada **QUANDO** o pagamento é confirmado **ENTÃO** o acesso volta em minutos, sem intervenção manual
- **DADO** uma empresa bloqueada **QUANDO** uma mensagem chega ao assistente **ENTÃO** ele responde informando o bloqueio, sem executar ação

---

## E13 — Plataforma

#### US-059 — Fazer login

**Como** usuário, **quero** entrar no sistema com segurança **para** acessar os
dados da minha empresa.
`MUST` · P1 P2 · `apps/api` `apps/web` `apps/mobile` · RF-119, RF-120

- **DADO** credenciais válidas **QUANDO** entro **ENTÃO** acesso apenas as empresas às quais pertenço
- **DADO** credenciais inválidas **QUANDO** tento **ENTÃO** a mensagem não revela se o usuário existe
- **DADO** várias tentativas falhas **QUANDO** o limite é atingido **ENTÃO** novas tentativas são desaceleradas
- **DADO** um usuário em mais de uma empresa **QUANDO** entro **ENTÃO** escolho qual empresa operar

#### US-060 — Isolamento entre empresas

**Como** lojista, **quero** garantia de que ninguém vê meus dados **para**
confiar o negócio ao sistema.
`MUST` · P1 · `packages/db` `apps/api` · RF-121, RF-122

- **DADO** uma consulta sem empresa no contexto **QUANDO** ela é executada **ENTÃO** ela falha, em vez de retornar tudo
- **DADO** um identificador de outra empresa **QUANDO** tento acessá-lo direto **ENTÃO** recebo "não encontrado", não "sem permissão"
- **DADO** qualquer caso de uso **QUANDO** ele roda **ENTÃO** o isolamento é imposto no banco (RLS), não apenas na aplicação

#### US-061 — Trilha de auditoria

**Como** lojista, **quero** saber quem fez o quê **para** resolver divergência
com meu funcionário.
`MUST` · P1 · `packages/db` `packages/core` · RF-123, RF-124

- **DADO** qualquer ação que altera dado de negócio **QUANDO** ela ocorre **ENTÃO** ficam registrados autor, canal (app ou WhatsApp), data e valores antes/depois
- **DADO** um registro de auditoria **QUANDO** alguém tenta alterá-lo **ENTÃO** é impedido — auditoria é somente-inserção
- **DADO** uma ação feita pelo assistente **QUANDO** consulto **ENTÃO** vejo o usuário humano que confirmou, não "sistema"

#### US-062 — Exportar todos os dados

**Como** lojista, **quero** baixar tudo que é meu **para** não ficar refém do
sistema.
`MUST` · P1 · `apps/web` `apps/worker` · RF-125, RF-126

- **DADO** que solicito a exportação **QUANDO** ela fica pronta **ENTÃO** recebo um pacote com todos os meus dados em formato aberto
- **DADO** uma conta bloqueada por inadimplência **QUANDO** solicito **ENTÃO** a exportação continua disponível

#### US-063 — Exclusão de dados pessoais (LGPD)

**Como** cliente final, **quero** pedir a exclusão dos meus dados **para**
exercer meu direito.
`MUST` · P4 P1 · `packages/core` `packages/db` · RF-127, RF-128

- **DADO** um pedido de exclusão **QUANDO** é processado **ENTÃO** os dados pessoais são anonimizados, preservando o que a lei fiscal obriga a guardar
- **DADO** um cliente anonimizado **QUANDO** consulto vendas antigas **ENTÃO** os totais continuam corretos, sem os dados pessoais
- **DADO** um pedido de exclusão **QUANDO** é processado **ENTÃO** fica registrado quando e por quem

#### US-064 — Diagnosticar falha de integração

**Como** administradora da plataforma, **quero** entender por que uma
integração falhou **para** resolver o chamado sem pedir print ao cliente.
`MUST` · P5 · `apps/api` `apps/worker` · RF-129, RF-130, RF-131

- **DADO** uma falha de emissão, mensagem ou cobrança **QUANDO** investigo **ENTÃO** encontro o erro pelo identificador da requisição, com a resposta do provedor
- **DADO** um job que falhou **QUANDO** o erro é transitório **ENTÃO** ele é reprocessado com espera crescente antes de desistir
- **DADO** que acesso dados de um tenant **QUANDO** faço isso **ENTÃO** o acesso fica registrado com justificativa

---

## Rastreabilidade

| De                   | Para                          | Onde                                                   |
| -------------------- | ----------------------------- | ------------------------------------------------------ |
| História → requisito | `US-xxx` → `RF-xxx`           | linha de metadados de cada história                    |
| Requisito → história | `RF-xxx` → `US-xxx`           | [`requisitos-funcionais.md`](requisitos-funcionais.md) |
| Requisito → módulo   | `RF-xxx` → `packages/*`       | [`requisitos-funcionais.md`](requisitos-funcionais.md) |
| História → tarefa    | `US-xxx` → `NR-xxx`           | [`task-ledger.md`](../processo/task-ledger.md)         |
| Tarefa → código      | `NR-xxx` → branch, PR, commit | [`git-workflow.md`](../engenharia/git-workflow.md)     |
