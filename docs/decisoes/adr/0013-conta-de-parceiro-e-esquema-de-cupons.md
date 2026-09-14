---
adr: 0013
titulo: Conta de Parceiro e esquema de cupons de indicação
status: Aceita
data: 2026-09-14
decisores: [produto, engenharia]
substitui: null
substituida_por: null
---

# ADR-0013 — Conta de Parceiro e esquema de cupons de indicação

|                       |                                 |
| --------------------- | ------------------------------- |
| **Status**            | Aceita                          |
| **Data**              | 2026-09-14                      |
| **Decisores**         | Produto, Engenharia             |
| **Decisão de origem** | [DEC-012](../README.md#dec-012) |

## Contexto

`DEC-012` ficou aberta perguntando: há autocadastro ou só por convite? Existe
indicação entre lojistas? Cupom é desconto percentual, valor fixo ou período
grátis? Cumulativo? Quem emite? O schema já tinha um desenho parcial
(`partners`, `coupons` em `packages/db/src/migrations/0007_acrescimos.sql`)
pensado para cupom promocional emitido pela plataforma — sem dono, sem PIX,
sem status de aprovação, sem tabela de resgate. Não cobria indicação
gerada pelo próprio usuário, nem dois tipos de benefício distintos.

O que faltava decidir não era só "como o schema fica", mas o produto por trás:
um programa de indicação com dois perfis — um Parceiro externo que ganha
comissão recorrente por trazer clientes, e qualquer lojista que ganha
mensalidade grátis por indicar outro lojista.

## Opções consideradas

### Opção A — Estender `partners`/`coupons` como estão, um tipo de cupom só

Manter só desconto (percent/amount) emitido por um `partners` sem dono,
tratando indicação de lojista como o mesmo mecanismo.

| Prós                | Contras                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Menos tabelas novas | Não modela comissão recorrente nem crédito de mês grátis — são formas de benefício estruturalmente diferentes (uma é % sobre cobrança futura indefinida, outra é crédito consumível) |
| —                   | `partners` sem dono não dá para aprovar/recusar nem saber quem recebe o PIX                                                                                                          |

### Opção B — Dois tipos de cupom discriminados no schema, com dono e aprovação

Cupom de Parceiro (`partner_id`) e cupom de Lojista (`owner_company_id`) na
mesma tabela `coupons`, mutuamente exclusivos por `CHECK`. `partners` ganha
dono, PIX, mensagem e um fluxo `pending → active/rejected`. Uma tabela nova
(`coupon_redemptions`) grava o vínculo cliente→indicador permanentemente, por
cópia no instante do resgate. Crédito de mês grátis do lojista fica numa
tabela própria (`lojista_free_month_credits`), tenant-isolada, consumida
FIFO — separada de `coupon_redemptions` porque tem dono único (quem indicou),
ao contrário do resgate em si (que liga duas empresas).

| Prós                                                                                                                                         | Contras                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cada tipo de benefício no seu formato natural (percentual recorrente vs. crédito cumulativo)                                                 | Mais uma tabela e mais funções `SECURITY DEFINER` para manter                                                                                       |
| Aprovação de Parceiro reaproveita o mecanismo de Super Admin já existente (`platform_admins`/`platform_admin_is`, ADR-0007) — sem papel novo | `partners`/`coupon_redemptions` são cross-tenant, então RLS é "negar tudo, acesso só por função" — mais rígido de testar que RLS por tenant simples |
| Vínculo permanente sobrevive a cupom editado/desativado depois (mesma disciplina de `ticket_messages.author_name`)                           | —                                                                                                                                                   |

## Decisão

**Escolhemos a Opção B.**

1. **Autocadastro existe para os dois tipos de conta** (lojista e Parceiro) —
   não é por convite. A conta de Parceiro entra em análise (`pending`) depois
   do autocadastro; não é aprovação prévia ao cadastro, é aprovação prévia à
   **ativação**.
2. **Indicação entre lojistas existe**, separada da indicação por Parceiro —
   dois tipos de cupom, discriminados no schema por qual referência está
   preenchida (`coupons.partner_id` xor `coupons.owner_company_id`), nunca
   por escolha explícita de quem se cadastra. O sistema identifica o tipo
   pelo próprio código do cupom.
3. **Desconto ao cliente indicado é sempre percentual (30%) e de ciclo
   único** — a primeira mensalidade, igual nos dois tipos de cupom.
4. **Comissão do Parceiro é percentual e recorrente/vitalícia** — enquanto o
   cliente indicado continuar pagando. O percentual mora em
   `partners.commission_percent` (não em `coupons`), ajustável por parceiro,
   com 30% de default. **Cálculo e pagamento da comissão ficam fora desta
   ADR** — o que aqui se fecha é só onde a taxa mora e que o resgate
   (`coupon_redemptions`) é o ponto de partida para quem for calcular.
5. **Crédito de mês grátis do Lojista é período grátis cumulativo, não
   percentual** — uma linha em `lojista_free_month_credits` por indicação
   concluída, consumida FIFO na geração do próximo ciclo de cobrança. Duas
   indicações concluídas são dois créditos, não um crédito dobrado.
6. **Quem aprova/recusa Parceiro é o mecanismo de Super Admin já existente**
   (`platform_admins`, `platform_admin_is`, ADR-0007) — não um papel novo. O
   enum `role: 'platform_admin'` em `packages/contracts/src/common/primitives.ts`
   continua vestigial e não-concedível, como `auth.ts` já documenta; esta ADR
   não muda isso.
7. **Reenvio após recusa não tem carência** — `partner_application_resend`
   simplesmente reabre o mesmo registro para `pending`, sem prazo de espera
   nem novo registro.
8. **Vínculo cliente→indicador é permanente por cópia no instante do
   resgate** (`coupon_redemptions`), não por referência viva ao cupom — uma
   empresa nova só resgata um cupom uma vez na vida
   (`coupon_redemptions_redeemed_company_unique`).
9. **Crédito de mês grátis é concedido no cadastro concluído**, não espera
   confirmação de pagamento do indicado. Risco aceito conscientemente: um
   cadastro que nunca chega a pagar ainda gera crédito para quem indicou. Fica
   registrado como ponto de revisão (ver "Quando revisitar"), não como
   default silencioso.
10. **`partners` deixa de ser tabela sem RLS.** Hoje `partners`/`coupons`
    estão na lista `NAO_TENANT` de `packages/db/src/schema.test.ts` — sem
    nenhuma política, qualquer papel de aplicação lê a linha inteira. Isso
    era aceitável enquanto `partners` só tinha nome; agora carrega PIX e
    mensagem de candidatura. Esta ADR muda **as duas tabelas** para
    `FORCE ROW LEVEL SECURITY` sem política permissiva — acesso só pelas
    funções `partner_application_*`/`coupon_*`, `SECURITY DEFINER`, mesmo
    padrão de `company_connections` (ADR-0008). A leitura pública de cupom
    por código (`coupon_lookup`) continua possível do mesmo jeito que
    `company_connections_search` já prova: função `SECURITY DEFINER` com
    retorno mínimo, nunca a tabela aberta.
11. **`coupon_redemptions` é cross-tenant sem política** (like
    `company_connections`); **`lojista_free_month_credits` é tenant-isolado
    normal** (`enable_tenant_isolation`, como `subscriptions`) — a assimetria
    existe porque o resgate liga duas empresas, e o crédito pertence a uma só.
12. **Consumo do crédito e cálculo/pagamento da comissão ficam fora de
    escopo desta ADR.** O schema abre o gancho (`lojista_free_month_credits`,
    `coupon_redemptions`, `partners.commission_percent`); quem fecha o
    cálculo é o trabalho de billing (NR-063) e de repasse ao parceiro
    (NR-118), em cima do que esta ADR deixa pronto.

O que foi abdicado: um desenho mais simples (Opção A) que reusaria uma
tabela só para os dois tipos de benefício — abdicado porque comissão
recorrente e crédito cumulativo têm ciclos de vida e consultas
estruturalmente diferentes, e forçá-los na mesma forma exigiria campos
nulos cruzados e mais `CASE` do que tabelas.

## Consequências

### Positivas

- Aprovação de Parceiro não inventa mecanismo de permissão novo — reusa
  Super Admin já auditado (ADR-0007).
- Vínculo cliente→indicador sobrevive a qualquer edição futura do cupom.
- `partners` para de ser uma tabela sem proteção nenhuma.

### Negativas

- Mais duas tabelas cross-tenant sem política (`partners`, `coupon_redemptions`)
  para testar com o mesmo rigor de `company_connections` — RLS forçada exige
  suite própria provando que o papel comum não lê nada sem passar pela
  função.
- Crédito concedido no cadastro (não no pagamento confirmado) é uma
  superfície de abuso conhecida e aceita — precisa de monitoramento, não
  está bloqueada por controle nenhum nesta ADR.

### Neutras

- `coupons.kind` (`percent`/`amount`, desconto ao indicado) e
  `partners.commission_percent` (comissão recorrente) são dois números
  percentuais com significados diferentes na mesma vizinhança de tabelas —
  fica registrado aqui para não confundir os dois na hora de ler o schema.

## Impacto na documentação

Atualizados no mesmo PR desta ADR:

- [x] `packages/db/src/migrations/0014_conta_de_parceiro_e_cupons.sql`
- [x] `packages/db/src/schema.test.ts` (remove `partners`/`coupons` de `NAO_TENANT`)
- [x] `packages/db/src/privacy-repository.ts` (comentários + `coupon_redemptions`/`lojista_free_month_credits`)
- [x] `DEC-012` marcada como 🟢 e removida da lista de abertas

## Quando revisitar

- Se o crédito-no-cadastro (item 9) virar vetor de abuso relevante
  (cadastros-fantasma para gerar mês grátis), revisitar para condicionar o
  crédito à confirmação do primeiro pagamento — depende de NR-063 existir
  para sequer medir a taxa de conversão.
- Se o volume de Parceiros crescer a ponto de exigir campanhas/percentuais
  diferentes por parceiro em massa, `partners.commission_percent` por linha
  pode não escalar operacionalmente — revisitar para um modelo de "planos de
  comissão" nomeados.
