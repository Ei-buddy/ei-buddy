# Escopo do MVP

> Documento de recorte. A pergunta que ele responde é: **o que precisa existir
> para uma lojista real operar o negócio dela inteiro no sistema?**

Critério de corte do MVP: a Cláudia ([P1](personas.md#p1--cláudia-a-lojista))
consegue, sem planilha paralela, registrar todas as vendas de um mês, emitir
nota, saber o que tem a receber e a pagar, e cobrar quem está devendo.

---

## Módulos de negócio

Os nove módulos herdados da apresentação comercial, com o recorte de cada um:

| #   | Módulo               | Épico                                                 | No MVP                                                           | Fora do MVP                                          |
| --- | -------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | **Empresa**          | [E1](user-stories.md#e1--onboarding--empresa)         | Cadastro, CNPJ, regime tributário, usuário `owner`               | Múltiplas filiais, equipe/`staff`                    |
| 2   | **Clientes / CRM**   | [E2](user-stories.md#e2--clientes--crm)               | Cadastro, histórico de compras, saldo em carteira                | Segmentação, campanhas, funil                        |
| 3   | **Produtos**         | [E3](user-stories.md#e3--produtos--estoque)           | Cadastro, código de barras, preço, custo, estoque simples        | Composição/kit, múltiplos depósitos, lote e validade |
| 4   | **Vendas**           | [E4](user-stories.md#e4--vendas--pdv)                 | Carrinho, leitor de código de barras, pagamento misto, devolução | Orçamento, pedido, delivery, comanda                 |
| 5   | **Contas a Pagar**   | [E6](user-stories.md#e6--contas-a-pagar)              | Lançamento, recorrência, baixa, alerta de vencimento             | Aprovação em fluxo, pagamento automatizado           |
| 6   | **Contas a Receber** | [E7](user-stories.md#e7--contas-a-receber)            | Geração automática pela venda, parcelas, baixa, cobrança         | Régua de cobrança automática, negativação            |
| 7   | **Bancos**           | [E8](user-stories.md#e8--bancos--conciliação)         | Conta bancária, importação de extrato, conciliação assistida     | Pagamento pelo sistema, múltiplas moedas             |
| 8   | **Plano de Contas**  | [E9](user-stories.md#e9--plano-de-contas--relatórios) | Plano padrão, classificação de lançamento, DRE simplificado      | Plano contábil completo, centro de custo hierárquico |
| 9   | **Agenda**           | [E10](user-stories.md#e10--agenda)                    | Compromissos, lembretes                                          | Agendamento pelo cliente final, recursos/salas       |

Mais os quatro módulos de plataforma, que não aparecem na apresentação
comercial mas sem os quais nada funciona:

| #   | Módulo                  | Épico                                                 | No MVP                                                                   |
| --- | ----------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| 10  | **Emissão Fiscal**      | [E5](user-stories.md#e5--emissão-fiscal)              | NFC-e na venda, cancelamento no prazo legal, contingência, guarda de XML |
| 11  | **Assistente WhatsApp** | [E11](user-stories.md#e11--assistente-whatsapp)       | Operação dos módulos 1–9 por mensagem, com confirmação de ação sensível  |
| 12  | **Assinatura SaaS**     | [E12](user-stories.md#e12--assinatura--cobrança-saas) | Planos, trial, cobrança, aviso e bloqueio por inadimplência              |
| 13  | **Plataforma**          | [E13](user-stories.md#e13--plataforma)                | Autenticação, multi-tenant, auditoria, observabilidade, exportação       |

## Fluxo de venda — o caminho crítico

O fluxo que define o MVP. Detalhamento técnico em
[`fluxos.md`](../arquitetura/fluxos.md#venda-completa).

```
selecionar cliente → montar carrinho (código de barras) → ajustar itens
   → pagamento (débito · crédito · Pix · dinheiro · carteira)
   → emissão fiscal
```

Ao fechar a venda o sistema calcula automaticamente, sem intervenção:

| Cálculo                                            | Onde vive                                            |
| -------------------------------------------------- | ---------------------------------------------------- |
| Custo dos itens (`costAmount`)                     | [`packages/domain`](../../packages/domain/README.md) |
| Imposto conforme o regime tributário               | [`packages/domain`](../../packages/domain/README.md) |
| Tarifa de cartão conforme bandeira e parcelamento  | [`packages/domain`](../../packages/domain/README.md) |
| **Valor líquido** → lançamento em contas a receber | [`packages/core`](../../packages/core/README.md)     |

É esse cálculo automático que entrega a promessa "saber o lucro real" da
[visão](visao.md#proposta-de-valor). Sem ele, o produto é um caderno digital.

## Escopo do assistente no MVP

O assistente **não** precisa cobrir 100% do ERP para o MVP ter valor. A
prioridade é o que a lojista faz várias vezes por dia:

| Prioridade      | Capacidade                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **MUST**        | Consultar (vendas do dia, a receber, a pagar, estoque, saldo de cliente)                                                  |
| **MUST**        | Cadastrar cliente                                                                                                         |
| **MUST**        | Lançar venda por texto (desconto, misto, fiado; nota via Focus se a loja estiver apta)                                    |
| **MUST**        | Enviar cobrança                                                                                                           |
| **SHOULD**      | Lançar conta a pagar/receber; dar baixa; ajustar estoque; cancelar/devolver venda                                         |
| **SHOULD**      | Cadastrar produto por texto; foto do código (padrão = venda; cadastro só se pedir)                                        |
| **SHOULD**      | Gerar e enviar relatório                                                                                                  |
| **COULD**       | Criar compromisso; enviar catálogo                                                                                        |
| **WON'T (MVP)** | Certificado A1, banco/conciliação, comando avulso emitir/cancelar nota, cadastrar empresa pelo Zap, alterar preço em lote |

Ações que criam ou alteram valor exigem confirmação explícita — princípio 3 da
[visão](visao.md#princípios-de-produto).

## Fora do MVP

Explicitamente adiado. Registrar aqui evita rediscussão a cada sprint.

| Item                                         | Por que fica fora                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Marketplace de lojas                         | Depende de massa crítica de lojistas que ainda não existe                                                |
| Vitrine de especialidades                    | Idem                                                                                                     |
| Espaço para propaganda                       | Modelo de receita secundário; não valida a tese                                                          |
| Gamificação                                  | Retenção via valor primeiro; gamificação não salva produto sem uso                                       |
| IA proativa (recomendações)                  | Precisa de histórico real para não recomendar besteira                                                   |
| Parcerias por elegibilidade                  | Depende de volume e de dado consolidado                                                                  |
| Atendimento ao cliente final pelo assistente | Multiplica risco de LGPD e custo de IA antes de validar o principal                                      |
| Múltiplas filiais / depósitos                | Fora do público-alvo do MVP                                                                              |
| Equipe / usuário `staff` na loja             | O operador é o owner; convite e alçada ficam [US-003](user-stories.md#us-003--convidar-equipe) (`WON'T`) |
| Portal do contador                           | Exportação manual resolve no MVP                                                                         |
| App para o cliente final                     | Sem demanda validada                                                                                     |
| Aplicativo web offline-first completo        | Offline fica restrito ao PDV mobile ([RNF-051](requisitos-nao-funcionais.md))                            |
| Integração com e-commerce / ERP terceiro     | Sem demanda validada                                                                                     |
| NFS-e                                        | Público secundário; entra logo após o MVP                                                                |

## Roadmap pós-MVP

Ordem de intenção, não compromisso de data. Cada fase só começa quando as
métricas da anterior sustentam.

### Fase 2 — Consolidar o uso

Portal do contador · NFS-e para prestadores de serviço · Régua de cobrança
automática · Relatórios avançados e DRE completo · Assistente com mais
cobertura de escrita.

### Fase 3 — Inteligência

IA proativa (alerta de estoque, previsão de caixa, sugestão de preço) ·
Recomendação de compra por histórico · Atendimento ao cliente final ·
Gamificação de metas.

### Fase 4 — Rede

Marketplace de lojas · Vitrine de especialidades · Espaço para propaganda ·
Parcerias por elegibilidade (alto faturamento, CNPJ regular). Uma proposta
concreta desta fase — busca de fornecedores próximos por CEP, com pedido de
conexão — já tem desenho registrado em
[DEC-021](../decisoes/README.md#dec-021), adiado pelo mesmo motivo do
marketplace: depende de massa crítica de lojistas.

> [!NOTE]
> As fases 2–4 vêm da apresentação comercial e ainda não têm requisitos
> escritos. Elas serão detalhadas quando entrarem em planejamento — não há
> `RF-xxx` para elas hoje, e isso é intencional.

## Critérios de saída do MVP

O MVP está pronto quando **todos** forem verdade:

- [ ] Uma lojista real opera um mês inteiro sem planilha paralela
- [ ] Todos os `RF-xxx` marcados `MUST` estão implementados e testados
- [ ] Todos os `RNF-xxx` marcados `MUST` estão medidos, não presumidos
- [ ] NFC-e emitida com sucesso em produção, incluindo contingência
- [ ] Assistente cobre as capacidades `MUST` desta página
- [ ] Cobrança de assinatura funcionando ponta a ponta, incluindo bloqueio
- [ ] Nenhum `DEC-xxx` bloqueante em aberto ([decisões](../decisoes/README.md))
- [ ] Exportação completa de dados disponível ao lojista

## Documentos relacionados

- [Visão do produto](visao.md) — o porquê deste recorte
- [User Stories](user-stories.md) — o detalhamento de cada épico
- [Task Ledger](../processo/task-ledger.md) — como isso vira trabalho de 3 devs
