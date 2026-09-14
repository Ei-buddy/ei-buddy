# whatsapp

Adapter do provedor de WhatsApp.

**Estado:** 🟡 porta e adapter falso prontos (`NR-045`) · 🚧 adapter real bloqueado por [DEC-003](../../docs/decisoes/README.md#dec-003) (`NR-046`)

## Responsabilidade

Enviar e receber mensagens, e verificar a assinatura dos webhooks recebidos.

**O que não faz:** decidir regra de negócio. O adapter traduz entre a porta e o
provedor — nada mais.

## Fronteiras

|                       |                                                            |
| --------------------- | ---------------------------------------------------------- |
| **Implementa**        | `MessageSender`, declarada por [`core`](../core/README.md) |
| **Depende de**        | `contracts`, `money`                                       |
| **Proibido importar** | `core`, `db`, `domain` — a seta aponta para dentro         |
| **Quem depende**      | a raiz de composição de `api` e `worker`                   |

A proibição de importar `core` é verificada na CI pela regra
`adapter-nao-importa-core`. Adapter que conhece `core` não é substituível — e
substituibilidade é a única razão de ele existir.

## O que a porta precisa cobrir

| Capacidade                                                     | Requisito                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| Enviar mensagem de texto e mídia                               | [RF-015](../../docs/produto/requisitos-funcionais.md)      |
| Receber webhook com assinatura verificada                      | [RNF-028](../../docs/produto/requisitos-nao-funcionais.md) |
| Respeitar consentimento e opt-out                              | [RF-016](../../docs/produto/requisitos-funcionais.md)      |
| Vincular número à empresa (celular do owner; a regra é de `core`) | [RF-094](../../docs/produto/requisitos-funcionais.md) · [ADR-0012](../../docs/decisoes/adr/0012-identidade-do-canal-whatsapp.md) |
| Ignorar mensagem de número não vinculado, sem vazar informação | [RF-095](../../docs/produto/requisitos-funcionais.md)      |

## Consentimento não é opcional

Enviar mensagem a cliente final **sem consentimento registrado** é sanção da
ANPD e denúncia por spam — ameaça T3 do
[modelo de ameaças](../../docs/arquitetura/seguranca.md#modelo-de-ameaças).
A verificação acontece em `core`, antes de chegar aqui, mas o adapter não deve
oferecer caminho que a contorne.

**Como a porta cumpre isso:** todo pedido de envio carrega `consent`, e o tipo
não permite omitir. Isso **não verifica** consentimento — quem verifica é
`core`, que tem o cadastro do cliente. O que o campo faz é tornar o
esquecimento _inexpressável_: não existe chamada de envio sem declarar a base.

| Base              | Quando vale                                                      |
| ----------------- | ---------------------------------------------------------------- |
| `customer_opt_in` | cliente registrou consentimento; carrega **quando**              |
| `own_user`        | destinatário é a própria lojista — não é marketing para terceiro |
| `service_reply`   | resposta dentro de conversa que o cliente iniciou                |

E a porta **não tem envio em massa**: um método que aceitasse lista de
destinatários seria o caminho mais curto entre este sistema e uma denúncia por
spam. Enviar para muitos é enfileirar muitos envios.

## A janela de atendimento de 24 horas

A regra do provedor que mais surpreende quem nunca integrou: passadas 24 horas
desde a última mensagem **do cliente**, só sai mensagem de modelo aprovado.

Isso volta como `outside_service_window` — uma recusa explícita, e não uma
falha. A distinção importa porque **retentar não resolve**: sem ela, alguém
reenfileira a mesma mensagem para sempre.

O envio de mensagem de modelo **não está na porta**, e isso é deliberado: nome,
idioma e variáveis de modelo são específicos do provedor, e inventar a
assinatura antes da [DEC-003](../../docs/decisoes/README.md#dec-003) seria
desenhar às cegas. Entra com `NR-046`.

## O adapter não interpreta

Duas coisas que ele deliberadamente **não** decide:

- **se o número está vinculado a uma empresa** ([RF-094](../../docs/produto/requisitos-funcionais.md),
  [ADR-0012](../../docs/decisoes/adr/0012-identidade-do-canal-whatsapp.md)).
  Depende de `users.phone` do owner. E [RF-095](../../docs/produto/requisitos-funcionais.md)
  exige ignorar número não vinculado _sem revelar informação_ — o que significa
  que quem responde não pode ser o adapter.
- **se um texto é pedido de opt-out.** "PARAR" é opt-out? Depende de regra, e
  regra é de `core`. Adapter que interpreta é adapter que precisa ser reescrito
  quando a regra muda.

## O vínculo do número é a credencial

Uma mensagem de texto não carrega credencial. O celular obrigatório do owner
no cadastro faz esse papel
([ADR-0012](../../docs/decisoes/adr/0012-identidade-do-canal-whatsapp.md)) —
com todas as consequências, inclusive a fragilidade a SIM swap. Ver
[`seguranca.md`](../../docs/arquitetura/seguranca.md#autenticação-do-canal-whatsapp).

## Modo falso

`WHATSAPP_PROVIDER=fake` responde de forma determinística, sem rede. Isso permite
que o sistema suba local sem credencial nenhuma e que o trabalho não espere a
decisão do fornecedor.

**O adapter falso implementa a mesma porta, inclusive os caminhos de erro.**
Falso que só devolve sucesso esconde exatamente o que precisa ser testado.

Aqui isso pesa mais que nas outras portas, porque **nenhuma** das recusas de
envio é falha de infraestrutura: número sem WhatsApp, cliente que bloqueou a
loja, janela de 24 horas, limite de taxa. Todas são resultado, e cada uma pede
tratamento diferente em `core`.

```ts
import { createFakeMessageSender } from '@na-regua/whatsapp'

const remetente = createFakeMessageSender()
const bloqueado = createFakeMessageSender({
  recusas: { '5541999990000': 'blocked_by_recipient' },
})
```

| Opção                   | O que provoca                                                        |
| ----------------------- | -------------------------------------------------------------------- |
| `webhookSecret`         | troca o segredo do HMAC                                              |
| `recusas`               | mapa de número → motivo de recusa                                    |
| `limitePorEmpresa`      | envios permitidos antes de `rate_limited`, **por empresa**           |
| `falhaDeInfraestrutura` | **lança**, porque não é recusa de destinatário — é job para retentar |

`assinar()`, `corpoDeEntrada()` e `corpoDeRecibo()` são apoio de teste — não
fazem parte da porta. `corpoDeEntrada` monta o corpo **aninhado** que o provedor
manda de verdade (`entry[].changes[].value.messages[]`), e `corpoDeRecibo` monta
o recibo de entrega, que chega no **mesmo endpoint** em `statuses` em vez de
`messages` e precisa ser ignorado — responder 4xx a ele faria o provedor
reentregar para sempre.

> A janela de 24h do falso é indexada pelo número do **cliente**, não pelo par
> (loja, cliente): no recebimento o adapter conhece o número da loja, no envio
> conhece a empresa, e ele não tem como ligar os dois — esse mapa é de `core`
> (RF-094). O adapter real deve trocar isso pelo id de conversa do provedor,
> assim que a DEC-003 disser qual é o provedor.

## Testes

| Camada                     | Onde roda                                      |
| -------------------------- | ---------------------------------------------- |
| Contrato da porta          | CI — falso e real satisfazem a **mesma** suíte |
| Contra sandbox do provedor | manual ou agendado, fora do PR                 |
| Corpo de webhook gravado   | CI — inclusive os casos estranhos documentados |

A suíte de contrato está em
[`src/message-sender-contract.ts`](src/message-sender-contract.ts) e **não
conhece o falso**, só a porta:

```ts
verificarContratoDoRemetente('FakeMessageSender', () => createFakeMessageSender())
```

Ela não é exportada pelo `index.ts` de propósito — importa `vitest`, que é
dependência de desenvolvimento.

## Variáveis de ambiente

`WHATSAPP_PROVIDER`, `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_WEBHOOK_SECRET`.

Em desenvolvimento, o webhook exige URL HTTPS pública — `localhost` é recusado.
Use um túnel e coloque a URL em `PUBLIC_WEBHOOK_URL`.

Ver [`ambientes.md`](../../docs/engenharia/ambientes.md).
