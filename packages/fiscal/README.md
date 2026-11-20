# fiscal

Adapter de emissão fiscal — NFC-e e NFS-e.

**Estado:** 🟡 porta e adapter falso prontos (`NR-040`) · 🚧 adapter real bloqueado por [DEC-004](../../docs/decisoes/README.md#dec-004) (`NR-042`)

## Responsabilidade

Emitir e cancelar nota fiscal, tratar contingência quando a SEFAZ cai, e guardar
o XML pelo prazo legal.

**O que não faz:** decidir regra de negócio. O adapter traduz entre a porta e o
provedor — nada mais.

## Fronteiras

|                       |                                                            |
| --------------------- | ---------------------------------------------------------- |
| **Implementa**        | `InvoiceIssuer`, declarada por [`core`](../core/README.md) |
| **Depende de**        | `contracts`, `money`                                       |
| **Proibido importar** | `core`, `db`, `domain` — a seta aponta para dentro         |
| **Quem depende**      | a raiz de composição de `api` e `worker`                   |

A proibição de importar `core` é verificada na CI pela regra
`adapter-nao-importa-core`. Adapter que conhece `core` não é substituível — e
substituibilidade é a única razão de ele existir.

### Como o adapter satisfaz uma porta que não pode importar

Consequência direta dessa proibição: **nenhum tipo da porta `InvoiceIssuer` mora
em `core`.** Todos vêm de [`contracts`](../contracts/README.md)
(`IssueInvoiceRequest`, `InvoiceIssueResult`, `CancelInvoiceRequest`,
`InvoiceCancellation`). O adapter satisfaz a porta **estruturalmente**, e o
TypeScript confere a compatibilidade na raiz de composição, onde os dois se
encontram.

É o que diferencia esta porta de `AppointmentRepository`, cujos tipos podem
morar em `core` porque quem a implementa é `db` — e `db` tem permissão para
importar `core`.

## O que a porta cobre

| Capacidade                                              | Requisito                                                                                                    | Estado                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Emitir NFC-e a partir de uma venda fechada              | [RF-045](../../docs/produto/requisitos-funcionais.md)                                                        | ✅ porta + falso · real em `NR-042`           |
| Validar NCM, CFOP e CST/CSOSN **antes** de transmitir   | [RF-046](../../docs/produto/requisitos-funcionais.md)                                                        | ✅ o falso valida e não transmite             |
| Traduzir rejeição da SEFAZ em mensagem compreensível    | [RF-047](../../docs/produto/requisitos-funcionais.md)                                                        | ✅ estrutura · tabela de códigos em `NR-042`  |
| Cancelar dentro do prazo legal, com justificativa       | [RF-050](../../docs/produto/requisitos-funcionais.md)                                                        | ✅ porta + falso · o **prazo** é de `core`    |
| Emitir em contingência e retransmitir em ordem          | [RF-052](../../docs/produto/requisitos-funcionais.md), [RF-053](../../docs/produto/requisitos-funcionais.md) | ✅ contingência · retransmissão em `NR-041`   |
| Guardar XML por ≥ 5 anos                                | [RNF-037](../../docs/produto/requisitos-nao-funcionais.md)                                                   | ✅ a porta entrega o XML · guardar é de `db`  |
| Numeração sequencial sem lacuna, mesmo sob concorrência | [RNF-039](../../docs/produto/requisitos-nao-funcionais.md)                                                   | ✅ no falso · no real é o provedor que numera |

**RF-053 não tem superfície na porta ainda**, e isso é deliberado:
retransmitir em ordem exige o consumidor de fila, que entra com `NR-041`.
Inventar um método sem consumidor seria desenhar às cegas. O falso já mantém as
notas em contingência na ordem de emissão (`pendentesDeRetransmissao`), então o
trabalho tem por onde começar.

## Rejeição e contingência são resultado, não exceção

A decisão de projeto mais importante da porta. `issue` devolve uma união
discriminada:

```ts
type InvoiceIssueResult =
  | { status: 'authorized'; accessKey; number; series; danfeUrl; xml; issuedAt }
  | { status: 'contingency'; accessKey; number; series; xml; issuedAt; reason }
  | { status: 'rejected'; rejection: { code; message } }
```

Se rejeição fosse exceção, o `catch` mais próximo poderia desfazer a transação
da venda — e [RF-047](../../docs/produto/requisitos-funcionais.md) e
[RF-052](../../docs/produto/requisitos-funcionais.md) exigem o contrário: **a
venda permanece registrada mesmo quando a nota não sai.** O tipo obriga quem
chama a decidir o que fazer nos três casos.

Exceção fica reservada ao que é falha de infraestrutura de verdade — token
inválido, certificado vencido, resposta ilegível. Aí o job deve ser retentado.

## Certificado digital A1

O segredo mais perigoso do sistema. Cifrado em repouso com chave **fora** do
banco, decifrado só em memória no momento da emissão, senha nunca registrada em
log — nem mascarada, simplesmente não é registrada. Acesso auditado. Alerta 30
dias antes do vencimento. Ver
[`seguranca.md`](../../docs/arquitetura/seguranca.md#certificado-digital-a1--tratamento-especial).

## Emissão é assíncrona

A venda **fecha antes da nota**. A SEFAZ é instável e o balcão não pode parar
por causa disso — [RNF-004](../../docs/produto/requisitos-nao-funcionais.md).
A emissão vai para a fila `invoice-issue`.

Por isso o pedido de emissão carrega o `companyId` **dentro** dele, e não como
parâmetro separado: quem emite é um job, e o pedido precisa ser serializável
inteiro. Continua valendo que o tenant vem do `ExecutionContext`, nunca do
cliente ([princípio 8](../../docs/arquitetura/principios.md)).

E é também por isso que `issue` é **idempotente por `saleId`**: fila
reprocessa, e nota duplicada não é inconveniência, é problema fiscal que o
lojista resolve com o contador — [RNF-043](../../docs/produto/requisitos-nao-funcionais.md).

## NFS-e no padrão nacional (NR-240)

A NFS-e sai pelo padrão **nacional** da Focus (`/v2/nfsen`), e não pela API
municipal (`/v2/nfse`): as lojas podem estar em qualquer município, e o padrão
nacional serve a todos — [DEC-031](../../docs/decisoes/README.md#dec-031). A
documentação da Focus que o código segue está copiada em
[`docs/assets/focus-nfse-nacional/`](../../docs/assets/focus-nfse-nacional/README.md).

| O que muda em relação à NFC-e                                                 | Como o código trata                                                        |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Assíncrona:** o `POST` só pré-valida e volta `processando_autorizacao`      | `issue` devolve `processing`; quem consulta de novo (`consult`) é o worker |
| **A referência não se repete** (`"Já existe um DPS com esta referência"`)     | `issue` consulta antes de enviar; nota já enviada devolve o estado dela    |
| **Um serviço por nota** (um código, uma descrição, um valor)                  | o contrato `ServiceInvoiceRequest` tem `service`, e não uma lista de itens |
| **Numeração da Focus** (`serie_nfsen_*`, `proximo_numero_nfsen_*` na empresa) | a nota sai sem `serie_dps` nem `numero_dps`                                |
| **Autorizada sem PDF ou XML** enquanto a Focus monta os arquivos              | continua `processing`, e nunca vira rejeição                               |

A referência é o `saleId` sem hífens, com o sufixo `nfse`: a Focus aceita só
letras e números, e a mesma venda pode ter NFC-e e NFS-e — uma referência não
pode valer pelas duas. Depois de uma rejeição, a nota corrigida sai com a
**mesma** referência: a Focus aceita o reenvio enquanto a nota não foi
autorizada, e `issue` só reenvia quando a consulta diz que ela foi rejeitada.

O cadastro da empresa na Focus liga `habilita_nfsen_producao` e
`habilita_nfsen_homologacao` para quem informou o Código de Tributação Nacional
(quem presta serviço). A NFS-e municipal (`habilita_nfse`) fica sempre
desligada: a Focus recusa as duas juntas em produção. Loja só de serviço se
cadastra sem o CSC, que é da NFC-e.

Os campos da Reforma Tributária que a lista da Focus marca como obrigatórios
saem com os valores do caso geral (`finalidade_emissao` 0, IBS/CBS CST `000` e
classificação `000001`). Se a homologação recusar algum para loja do Simples,
o ajuste é só em `corpoDaNfsen`.

### Ligada à venda (NR-241)

Os itens cujo produto tem **NBS** são serviço e saem na NFS-e; o resto continua
na NFC-e, que agora deixa os serviços de fora e leva só a parte dos pagamentos
que cabe à mercadoria. Uma NFS-e por venda (tabela `service_invoices`):

1. `POST /vendas/:id/nfse` (`requestServiceInvoice`, em `core`) confere o que a
   loja precisa — Código de Tributação Nacional, cidade e UF — e grava
   "processando". O código IBGE da cidade vem da BrasilAPI na primeira vez e
   fica guardado na empresa.
2. O worker envia (`service-invoice-issue`) e, enquanto a nota segue
   "processando", consulta de novo (`service-invoice-check`): 15 s dobrando
   até 15 min, no máximo 12 vezes.
3. `GET /vendas/:id/nfse` mostra o estado, e a visita aproveita para perguntar
   à Focus — no máximo a cada 20 s.
4. `POST /vendas/:id/nfse/cancelamento` cancela a autorizada, com justificativa.

Rejeitada, a nota é pedida de novo depois da correção, com a mesma referência.
O valor é a soma dos serviços; o desconto da venda entra na proporção deles; e
vai o NBS do serviço de maior valor (a DPS leva um só).

`criarEmissorNfsenFalso()` imita o caminho assíncrono: o pedido volta
`processing`, e a nota aparece autorizada na consulta seguinte. Descrição com
`REJEITAR` simula a rejeição.

## Modo falso

`FISCAL_PROVIDER=fake` responde de forma determinística, sem rede. Isso permite
que o sistema suba local sem credencial nenhuma e que o trabalho não espere a
decisão do fornecedor.

**O adapter falso implementa a mesma porta, inclusive os caminhos de erro.**
Falso que só devolve sucesso esconde exatamente o que precisa ser testado — e na
emissão fiscal rejeição e contingência são o caso comum, não a exceção.

```ts
import { createFakeInvoiceIssuer } from '@na-regua/fiscal'

const emissor = createFakeInvoiceIssuer()
const emissorOffline = createFakeInvoiceIssuer({ sefazDisponivel: false })
```

| Opção                    | O que provoca                                                  |
| ------------------------ | -------------------------------------------------------------- |
| `sefazDisponivel: false` | contingência — RF-052                                          |
| `rejeitarCom`            | rejeição com código e mensagem escolhidos — RF-047             |
| `falhaDeInfraestrutura`  | **lança**, porque não é resultado fiscal — é job para retentar |

`configurar()` troca as opções no meio do teste, para simular SEFAZ que cai e
volta.

A chave de acesso segue o layout real —
`cUF AAMM CNPJ mod série nNF tpEmis cNF cDV`, 44 dígitos, com dígito
verificador módulo 11 calculado. Não é capricho: chave que passa em validador
exercita o schema, o campo do banco e a tela do mesmo jeito que a real. Falso
com formato de brinquedo esconde erro de formato para descobrir em produção.

## Testes

| Camada                     | Onde roda                                      |
| -------------------------- | ---------------------------------------------- |
| Contrato da porta          | CI — falso e real satisfazem a **mesma** suíte |
| Contra sandbox do provedor | manual ou agendado, fora do PR                 |
| Corpo de webhook gravado   | CI — inclusive os casos estranhos documentados |

A suíte de contrato vive em
[`src/invoice-issuer-contract.ts`](src/invoice-issuer-contract.ts) e **não
conhece o falso**, só a porta. Quando o adapter real entrar, ele chama
`verificarContratoDoEmissor` com a própria implementação — e ou passa, ou não é
substituível:

```ts
verificarContratoDoEmissor('FakeInvoiceIssuer', () => createFakeInvoiceIssuer())
```

Ela não é exportada pelo `index.ts` de propósito: importa `vitest`, que é
dependência de desenvolvimento. Quem a usa está dentro deste pacote.

O que **não** está na suíte compartilhada é injeção de falha específica de
provedor — SEFAZ fora do ar, rejeição forçada. Isso depende de sandbox e roda
fora do PR; no falso vira teste próprio em
[`src/fake-issuer.test.ts`](src/fake-issuer.test.ts).

## Variáveis de ambiente

`FISCAL_PROVIDER`, `FISCAL_API_TOKEN`, `FISCAL_ENVIRONMENT`.
O certificado A1 **não** é variável de ambiente: é dado por empresa, cifrado.

A escolha do provedor por `FISCAL_PROVIDER` acontece na raiz de composição e
entra com `NR-042`, junto do adapter real — hoje existe só um provedor para
escolher.

Ver [`ambientes.md`](../../docs/engenharia/ambientes.md).
