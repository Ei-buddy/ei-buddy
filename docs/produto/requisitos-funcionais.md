# Requisitos Funcionais

151 requisitos, derivados das [User Stories](user-stories.md). Descrevem **o que
o sistema faz**. Como ele se comporta (desempenho, segurança, disponibilidade)
está em [Requisitos Não Funcionais](requisitos-nao-funcionais.md).

## Como ler

| Coluna          | Significado                                                                     |
| --------------- | ------------------------------------------------------------------------------- |
| **ID**          | Permanente. Nunca renumerado nem reaproveitado                                  |
| **Requisito**   | Uma capacidade verificável. Se não dá para escrever um teste, não é requisito   |
| **US**          | História de origem                                                              |
| **Módulo dono** | Onde a regra vive — **um só**. Outros módulos podem consumir, não reimplementar |
| **Pri**         | `M` MUST · `S` SHOULD · `C` COULD                                               |
| **St**          | ✅ pendente · 🟨 em andamento · ✅ pronto · ❌ cancelado                        |

**Regra de ouro:** o módulo dono de uma regra de negócio é sempre
`packages/domain` ou `packages/core` — nunca um `apps/*`. Ver
[princípios](../arquitetura/principios.md).

**Resumo:** 151 requisitos · 105 `MUST` · 35 `SHOULD` · 6 `COULD` · 5
cancelados (equipe/`staff`: RF-005, RF-006, RF-008, RF-012, RF-042).
IDs cancelados não se reaproveitam. RF-146 é elegibilidade de emissão na Focus
(não é recorte de equipe).

---

## E1 — Onboarding & Empresa

| ID     | Requisito                                                                                                  | US     | Módulo dono | Pri | St  |
| ------ | ---------------------------------------------------------------------------------------------------------- | ------ | ----------- | :-: | :-: |
| RF-001 | Cadastrar empresa a partir do CNPJ, com preenchimento automático de razão social, nome fantasia e endereço | US-001 | `core`      |  M  | ✅  |
| RF-002 | Impedir cadastro de CNPJ já existente, sem revelar dados da empresa existente                              | US-001 | `core`      |  M  | ✅  |
| RF-003 | Registrar regime tributário da empresa e usá-lo no cálculo de imposto das vendas                           | US-002 | `domain`    |  M  | ✅  |
| RF-004 | Armazenar certificado digital A1 cifrado e alertar 30 dias antes do vencimento                             | US-002 | `fiscal`    |  M  | ✅  |
| RF-005 | Convidar usuário por e-mail ou telefone e atribuir papel (`owner`, `staff`)                                | US-003 | `core`      |  M  | ❌  |
| RF-006 | Revogar acesso de usuário encerrando as sessões e preservando o histórico de ações                         | US-003 | `core`      |  M  | ❌  |
| RF-007 | Configurar taxas da adquirente por bandeira e número de parcelas                                           | US-004 | `domain`    |  M  | ✅  |
| RF-008 | Configurar limite de desconto por papel e bloquear venda que o exceda                                      | US-003 | `domain`    |  M  | ❌  |

## E2 — Clientes / CRM

| ID     | Requisito                                                                                   | US     | Módulo dono | Pri | St  |
| ------ | ------------------------------------------------------------------------------------------- | ------ | ----------- | :-: | :-: |
| RF-009 | Cadastrar cliente exigindo apenas nome e telefone                                           | US-005 | `core`      |  M  | ⬜  |
| RF-010 | Detectar cliente duplicado por telefone ou CPF e oferecer reuso do existente                | US-005 | `core`      |  M  | ⬜  |
| RF-011 | Listar histórico de compras do cliente em ordem decrescente de data                         | US-006 | `core`      |  M  | ⬜  |
| RF-012 | Ocultar custo e margem no histórico para o papel `staff`                                    | US-003 | `core`      |  M  | ❌  |
| RF-013 | Manter saldo em carteira (fiado) por cliente, alterado por venda `wallet` e por recebimento | US-007 | `domain`    |  M  | ⬜  |
| RF-014 | Avisar o operador do saldo devedor do cliente ao iniciar nova venda para ele                | US-007 | `core`      |  M  | ⬜  |
| RF-015 | Vincular número de WhatsApp ao cadastro do cliente e usá-lo como destino de mensagens       | US-008 | `core`      |  M  | ⬜  |
| RF-016 | Registrar consentimento e opt-out do cliente, bloqueando envio sem consentimento            | US-008 | `core`      |  M  | ⬜  |

## E3 — Produtos & Estoque

| ID     | Requisito                                                                                                | US     | Módulo dono | Pri | St  |
| ------ | -------------------------------------------------------------------------------------------------------- | ------ | ----------- | :-: | :-: |
| RF-017 | Cadastrar produto a partir da leitura de código de barras                                                | US-009 | `core`      |  M  | ⬜  |
| RF-018 | Localizar produto existente pelo código de barras lido                                                   | US-009 | `core`      |  M  | ⬜  |
| RF-019 | Gerar código interno para produto sem código de barras                                                   | US-009 | `core`      |  M  | ⬜  |
| RF-020 | Registrar custo e preço de venda e calcular margem em valor e percentual                                 | US-010 | `domain`    |  M  | ⬜  |
| RF-021 | Recusar gravação quando o preço de venda for menor que o custo, com mensagem clara para corrigir valores | US-010 | `domain`    |  M  | ⬜  |
| RF-022 | Consultar saldo, preço e localização de um produto, distinguindo "sem controle de estoque" de saldo zero | US-011 | `core`      |  M  | ⬜  |
| RF-023 | Ajustar saldo de estoque registrando `InventoryMovement` com autoria, motivo e data                      | US-012 | `core`      |  M  | ⬜  |
| RF-024 | Baixar estoque automaticamente ao fechar a venda e restaurá-lo no cancelamento ou devolução              | US-012 | `core`      |  M  | ⬜  |
| RF-025 | Definir estoque mínimo por produto e detectar o cruzamento desse mínimo                                  | US-013 | `core`      |  S  | ⬜  |
| RF-026 | Consolidar alertas de estoque baixo do dia em uma única notificação                                      | US-013 | `core`      |  S  | ⬜  |

## E4 — Vendas & PDV

| ID     | Requisito                                                                                                  | US     | Módulo dono | Pri | St  |
| ------ | ---------------------------------------------------------------------------------------------------------- | ------ | ----------- | :-: | :-: |
| RF-027 | Adicionar item ao carrinho por leitura de código de barras, somando quantidade se já presente              | US-014 | `core`      |  M  | ⬜  |
| RF-028 | Alertar venda de produto sem saldo em estoque, permitindo prosseguir por decisão do operador               | US-014 | `core`      |  M  | ⬜  |
| RF-029 | Buscar produto por nome, ordenando resultados por volume de vendas                                         | US-015 | `core`      |  M  | ⬜  |
| RF-030 | Aplicar desconto em valor ou percentual, no item ou na venda, recalculando o total                         | US-016 | `domain`    |  M  | ⬜  |
| RF-031 | Recusar desconto superior ao total da venda                                                                | US-016 | `domain`    |  M  | ⬜  |
| RF-032 | Vincular venda a um cliente, com busca e criação sem sair do fluxo de venda                                | US-017 | `core`      |  M  | ⬜  |
| RF-033 | Permitir venda sem cliente identificado, exceto quando a forma de pagamento for `wallet`                   | US-017 | `core`      |  M  | ⬜  |
| RF-034 | Registrar pagamento em `cash`, `pix`, `debit`, `credit` ou `wallet`                                        | US-018 | `core`      |  M  | ⬜  |
| RF-035 | Calcular troco para pagamento em `cash` superior ao total                                                  | US-018 | `domain`    |  M  | ⬜  |
| RF-036 | Garantir idempotência no fechamento da venda, impedindo duplicidade em caso de reenvio                     | US-018 | `core`      |  M  | ⬜  |
| RF-037 | Aceitar pagamento dividido entre várias formas, exigindo que a soma seja exatamente o total                | US-019 | `core`      |  M  | ⬜  |
| RF-038 | Gerar uma conta a receber por parcela em pagamento `credit` parcelado, com vencimento e tarifa de cada uma | US-019 | `domain`    |  M  | ⬜  |
| RF-039 | Distribuir resto de divisão entre parcelas de forma que a soma seja exatamente o total                     | US-019 | `money`     |  M  | ⬜  |
| RF-040 | Calcular e exibir bruto, custo, imposto, tarifa de cartão, líquido e margem da venda                       | US-020 | `domain`    |  M  | ⬜  |
| RF-041 | Calcular imposto conforme o regime tributário configurado para a empresa                                   | US-020 | `domain`    |  M  | ⬜  |
| RF-042 | Ocultar custo, imposto e margem do resumo da venda para o papel `staff`                                    | US-003 | `core`      |  M  | ❌  |
| RF-043 | Cancelar venda estornando estoque, contas a receber e saldo de carteira                                    | US-021 | `core`      |  M  | ✅  |
| RF-044 | Registrar devolução total ou parcial, estornando apenas os itens e o valor proporcional                    | US-021 | `core`      |  M  |     | ✅  |

## E5 — Emissão Fiscal

| ID     | Requisito                                                                                           | US     | Módulo dono | Pri | St  |
| ------ | --------------------------------------------------------------------------------------------------- | ------ | ----------- | :-: | :-: |
| RF-045 | Emitir NFC-e a partir de uma venda fechada e registrar a chave de acesso                            | US-022 | `fiscal`    |  M  | ✅  |
| RF-046 | Validar dados fiscais obrigatórios (NCM, CFOP, CST/CSOSN) antes de chamar a Focus NFe               | US-022 | `fiscal`    |  M  | ✅  |
| RF-047 | Traduzir rejeição devolvida pela Focus em mensagem compreensível, preservando a venda registrada    | US-022 | `fiscal`    |  M  | ✅  |
| RF-048 | Enviar DANFE ou link da nota ao cliente por WhatsApp após a autorização                             | US-023 | `core`      |  M  | ⬜  |
| RF-049 | Exibir QR Code da nota na tela para cliente sem WhatsApp cadastrado                                 | US-023 | `fiscal`    |  M  | ✅  |
| RF-050 | Cancelar nota fiscal via Focus NFe mediante justificativa, dentro do prazo legal                    | US-024 | `fiscal`    |  M  | ✅  |
| RF-051 | Bloquear cancelamento fora do prazo legal e orientar a emissão de devolução                         | US-024 | `fiscal`    |  M  | ✅  |
| RF-052 | Emitir em contingência quando a Focus estiver indisponível, sem bloquear a venda                    | US-025 | `fiscal`    |  M  | ✅  |
| RF-053 | Consultar a Focus em ordem e atualizar notas em contingência; não inventar retransmissão            | US-025 | `fiscal`    |  M  | ⬜  |
| RF-054 | Exibir o estado fiscal da venda de forma explícita (autorizada, contingência, rejeitada, cancelada) | US-025 | `core`      |  M  | ✅  |
| RF-146 | Recusar emissão na Focus se a empresa não for MEI ou Simples sem reforma híbrida                    | US-022 | `fiscal`    |  M  | ⬜  |

## E6 — Contas a Pagar

| ID     | Requisito                                                                                  | US     | Módulo dono | Pri | St  |
| ------ | ------------------------------------------------------------------------------------------ | ------ | ----------- | :-: | :-: |
| RF-055 | Lançar conta a pagar com fornecedor, valor, vencimento e anexo                             | US-026 | `core`      |  M  | ⬜  |
| RF-056 | Marcar como `overdue` conta cujo vencimento já passou                                      | US-026 | `domain`    |  M  | ⬜  |
| RF-057 | Gerar ocorrências futuras de conta recorrente mantendo o dia de vencimento                 | US-027 | `core`      |  S  | ⬜  |
| RF-058 | Alterar uma ocorrência sem afetar as demais, e encerrar a recorrência preservando as pagas | US-027 | `core`      |  S  | ⬜  |
| RF-059 | Dar baixa em conta a pagar informando data e conta bancária, total ou parcial              | US-028 | `core`      |  M  | ⬜  |
| RF-060 | Estornar baixa restaurando o estado anterior e registrando o estorno                       | US-028 | `core`      |  M  | ⬜  |
| RF-061 | Agrupar contas a pagar por vencidas, hoje, semana e mês, com total por grupo               | US-029 | `core`      |  M  | ⬜  |
| RF-062 | Destacar contas vencidas na abertura do sistema                                            | US-029 | `core`      |  M  | ⬜  |

## E7 — Contas a Receber

| ID     | Requisito                                                                                                  | US     | Módulo dono | Pri | St  |
| ------ | ---------------------------------------------------------------------------------------------------------- | ------ | ----------- | :-: | :-: |
| RF-063 | Gerar contas a receber automaticamente ao fechar a venda, com o valor líquido e a data prevista de repasse | US-030 | `domain`    |  M  | ⬜  |
| RF-064 | Criar recebível já liquidado para pagamento em `cash` ou `pix`, e em aberto para `wallet`                  | US-030 | `domain`    |  M  | ⬜  |
| RF-065 | Lançar recebível avulso com valor, origem, vencimento e classificação contábil                             | US-031 | `core`      |  S  | ⬜  |
| RF-066 | Dar baixa em recebível, total ou parcial, atualizando o saldo do cliente                                   | US-032 | `core`      |  M  | ⬜  |
| RF-067 | Estornar baixa de recebível restaurando o saldo do cliente                                                 | US-032 | `core`      |  M  | ⬜  |
| RF-068 | Enviar cobrança ao cliente com valor, vencimento e origem da dívida                                        | US-033 | `core`      |  M  | ⬜  |
| RF-069 | Registrar data e canal do último envio de cobrança por recebível                                           | US-033 | `core`      |  M  | ⬜  |
| RF-070 | Impedir cobrança a cliente sem consentimento e interromper cobranças de recebível liquidado                | US-033 | `core`      |  M  | ⬜  |
| RF-071 | Listar clientes inadimplentes ordenados por valor devido, com dias de atraso                               | US-034 | `core`      |  M  | ⬜  |
| RF-072 | Alertar inadimplência do cliente ao abrir seu cadastro ou iniciar venda                                    | US-034 | `core`      |  M  | ⬜  |

## E8 — Bancos & Conciliação

| ID     | Requisito                                                                                        | US     | Módulo dono | Pri | St  |
| ------ | ------------------------------------------------------------------------------------------------ | ------ | ----------- | :-: | :-: |
| RF-073 | Cadastrar conta bancária com saldo inicial                                                       | US-035 | `core`      |  S  | ⬜  |
| RF-074 | Conectar conta bancária via Open Finance e importar transações periodicamente                    | US-036 | `banking`   |  S  | ⬜  |
| RF-075 | Detectar consentimento expirado, avisar o lojista e preservar conciliações anteriores            | US-036 | `banking`   |  S  | ⬜  |
| RF-076 | Importar extrato em OFX ou CSV, informando quantas transações entraram e quantas foram ignoradas | US-037 | `banking`   |  S  | ✅  |
| RF-077 | Rejeitar arquivo de extrato inválido sem importação parcial                                      | US-037 | `banking`   |  S  | ✅  |
| RF-078 | Sugerir lançamentos compatíveis com uma transação bancária por valor e data                      | US-038 | `core`      |  S  | ✅  |
| RF-079 | Conciliar transação com lançamento e permitir criar o lançamento a partir da transação           | US-038 | `core`      |  S  | ✅  |
| RF-080 | Desfazer conciliação devolvendo transação e lançamento à fila                                    | US-038 | `core`      |  S  | ✅  |

## E9 — Plano de Contas & Relatórios

| ID     | Requisito                                                                            | US     | Módulo dono | Pri | St  |
| ------ | ------------------------------------------------------------------------------------ | ------ | ----------- | :-: | :-: |
| RF-081 | Criar plano de contas padrão de varejo ao concluir o onboarding                      | US-039 | `db`        |  S  | ⬜  |
| RF-082 | Editar o plano de contas, impedindo exclusão de conta com lançamento                 | US-039 | `core`      |  S  | ⬜  |
| RF-083 | Classificar lançamento em conta contábil                                             | US-040 | `core`      |  S  | ⬜  |
| RF-084 | Sugerir classificação a partir do histórico do mesmo fornecedor ou origem            | US-040 | `core`      |  S  | ⬜  |
| RF-085 | Gerar DRE simplificado do período com receita, deduções, custo, despesas e resultado | US-041 | `core`      |  S  | ⬜  |
| RF-086 | Detalhar os lançamentos que compõem cada linha do relatório                          | US-041 | `core`      |  S  | ⬜  |
| RF-087 | Exportar período com lançamentos em CSV e XMLs das notas emitidas                    | US-042 | `core`      |  S  | ⬜  |
| RF-088 | Processar exportação grande em segundo plano, notificando quando pronta              | US-042 | `core`      |  S  | ⬜  |

## E10 — Agenda

| ID     | Requisito                                                                                 | US     | Módulo dono | Pri | St  |
| ------ | ----------------------------------------------------------------------------------------- | ------ | ----------- | :-: | :-: |
| RF-089 | Criar compromisso com título, data e hora                                                 | US-043 | `core`      |  C  | ⬜  |
| RF-090 | Vincular compromisso a um cliente e exibi-lo no cadastro dele                             | US-043 | `core`      |  C  | ⬜  |
| RF-091 | Enviar lembrete de compromisso no tempo configurado antes do horário                      | US-044 | `core`      |  C  | ⬜  |
| RF-092 | Cancelar lembrete de compromisso cancelado                                                | US-044 | `core`      |  C  | ⬜  |
| RF-093 | Listar compromissos do dia em ordem de horário, com confirmação explícita de agenda livre | US-045 | `core`      |  C  | ⬜  |

## E11 — Assistente WhatsApp

| ID     | Requisito                                                                                                             | US     | Módulo dono | Pri | St  |
| ------ | --------------------------------------------------------------------------------------------------------------------- | ------ | ----------- | :-: | :-: |
| RF-094 | Tratar o celular obrigatório do owner no cadastro como vínculo WhatsApp da primeira empresa; só o owner opera o canal | US-046 | `core`      |  M  | ⬜  |
| RF-095 | Ignorar mensagens de números não vinculados, sem executar ação nem revelar informação                                 | US-046 | `agent`     |  M  | ⬜  |
| RF-096 | Interpretar consulta em linguagem natural e respondê-la a partir dos casos de uso de `core`                           | US-047 | `agent`     |  M  | ⬜  |
| RF-097 | Declarar as capacidades disponíveis quando a intenção não for reconhecida, sem inventar resposta                      | US-047 | `agent`     |  M  | ⬜  |
| RF-098 | Extrair dados de cadastro de cliente a partir de mensagem em linguagem natural                                        | US-048 | `agent`     |  M  | ⬜  |
| RF-099 | Detectar duplicidade de cliente também no fluxo conversacional                                                        | US-048 | `core`      |  M  | ⬜  |
| RF-100 | Interpretar venda em linguagem natural (cliente, itens, quantidades, valores, forma de pagamento)                     | US-049 | `agent`     |  M  | ⬜  |
| RF-101 | Registrar venda pelo assistente usando exatamente o mesmo caso de uso do aplicativo                                   | US-049 | `core`      |  M  | ⬜  |
| RF-102 | Solicitar desambiguação quando o produto informado corresponder a mais de um cadastro                                 | US-049 | `agent`     |  M  | ⬜  |
| RF-103 | Exigir confirmação explícita antes de qualquer ação que crie, altere ou exclua valor                                  | US-050 | `agent`     |  M  | ⬜  |
| RF-104 | Expirar confirmação pendente após tempo limite, tratando resposta ambígua como recusa                                 | US-050 | `agent`     |  M  | ⬜  |
| RF-105 | Manter contexto da conversa para resolver referências ("ele", "essa venda")                                           | US-051 | `agent`     |  M  | ⬜  |
| RF-106 | Isolar contexto de conversa por empresa e expirar contexto antigo antes de aplicá-lo a nova ação                      | US-051 | `agent`     |  M  | ⬜  |
| RF-107 | Disparar cobrança pelo assistente e confirmar o envio ao lojista                                                      | US-052 | `agent`     |  M  | ⬜  |
| RF-108 | Gerar resumo de período pelo assistente com faturamento, custo, despesas e resultado                                  | US-053 | `agent`     |  S  | ⬜  |
| RF-109 | Entregar relatório extenso como arquivo ou link, com resumo na mensagem                                               | US-053 | `agent`     |  S  | ⬜  |
| RF-132 | Substituir o celular do owner pela sessão do aplicativo; o número anterior deixa de autorizar o WhatsApp              | US-046 | `core`      |  M  | ⬜  |
| RF-133 | Consultar estoque por mensagem usando o mesmo caso de uso do aplicativo                                               | US-065 | `agent`     |  M  | ⬜  |
| RF-134 | Consultar contas a pagar por vencimento por mensagem usando o mesmo caso de uso do aplicativo                         | US-066 | `agent`     |  M  | ⬜  |
| RF-135 | Consultar saldo em carteira do cliente por mensagem usando o mesmo caso de uso do aplicativo                          | US-067 | `agent`     |  M  | ⬜  |
| RF-136 | Interpretar desconto, pagamento misto/parcelado e fiado na venda por mensagem, com as mesmas recusas do app           | US-049 | `agent`     |  M  | ⬜  |
| RF-137 | Tratar foto de código de barras, sem pedido de cadastro, como item de venda                                           | US-068 | `agent`     |  S  | ⬜  |
| RF-138 | Tratar foto de código com pedido explícito de cadastro como cadastro de produto                                       | US-068 | `agent`     |  S  | ⬜  |
| RF-139 | Recusar foto ilegível ou código sem produto e orientar venda ou cadastro por texto                                    | US-068 | `agent`     |  S  | ⬜  |
| RF-140 | Cadastrar produto por mensagem usando o mesmo caso de uso do aplicativo                                               | US-069 | `agent`     |  S  | ✅  |
| RF-141 | Lançar conta a pagar por mensagem usando o mesmo caso de uso do aplicativo                                            | US-070 | `agent`     |  S  | ✅  |
| RF-142 | Lançar recebível avulso por mensagem usando o mesmo caso de uso do aplicativo                                         | US-071 | `agent`     |  S  | ✅  |
| RF-143 | Dar baixa em conta a pagar por mensagem usando o mesmo caso de uso do aplicativo                                      | US-072 | `agent`     |  S  | ✅  |
| RF-144 | Dar baixa em recebível por mensagem usando o mesmo caso de uso do aplicativo                                          | US-073 | `agent`     |  S  | ✅  |
| RF-145 | Ajustar estoque por mensagem usando o mesmo caso de uso do aplicativo                                                 | US-074 | `agent`     |  S  | ✅  |
| RF-147 | Cancelar ou devolver venda por mensagem usando o mesmo caso de uso do aplicativo, com Focus se houver nota            | US-075 | `agent`     |  S  | ✅  |
| RF-148 | Criar compromisso por mensagem usando o mesmo caso de uso do aplicativo                                               | US-076 | `agent`     |  C  | ✅  |
| RF-149 | Recusar certificado A1, senha e cadastro de emitente pelo WhatsApp, orientando o app                                  | US-077 | `agent`     |  M  | ⬜  |
| RF-150 | Recusar importação de extrato, Open Finance e conciliação pelo WhatsApp, orientando o app                             | US-078 | `agent`     |  M  | ⬜  |
| RF-151 | Recusar comando avulso de emitir ou cancelar nota; nota só como efeito da venda ou do cancelamento da venda           | US-079 | `agent`     |  M  | ⬜  |

## E12 — Assinatura & Cobrança SaaS

| ID     | Requisito                                                                                             | US     | Módulo dono | Pri | St  |
| ------ | ----------------------------------------------------------------------------------------------------- | ------ | ----------- | :-: | :-: |
| RF-110 | Iniciar período de teste ao concluir o cadastro da empresa, com prazo e limites explícitos            | US-054 | `billing`   |  M  | ⬜  |
| RF-111 | Avisar o lojista com antecedência do fim do período de teste                                          | US-054 | `billing`   |  M  | ⬜  |
| RF-112 | Ativar assinatura imediatamente após confirmação do pagamento                                         | US-055 | `billing`   |  M  | ⬜  |
| RF-113 | Informar o motivo da recusa de pagamento e permitir nova tentativa sem perda de dados                 | US-055 | `billing`   |  M  | ⬜  |
| RF-114 | Aplicar cupom de desconto exibindo o valor final antes da confirmação                                 | US-056 | `billing`   |  S  | ⬜  |
| RF-115 | Recusar cupom expirado, inválido ou já utilizado, informando o motivo exato                           | US-056 | `billing`   |  S  | ⬜  |
| RF-116 | Notificar inadimplência por WhatsApp e e-mail informando o prazo até o bloqueio                       | US-057 | `billing`   |  M  | ⬜  |
| RF-117 | Restringir criação de novos lançamentos após o prazo de tolerância, mantendo leitura e exportação     | US-058 | `billing`   |  M  | ⬜  |
| RF-118 | Restaurar o acesso automaticamente após confirmação do pagamento, e informar o bloqueio no assistente | US-058 | `billing`   |  M  | ⬜  |

## E13 — Plataforma

| ID     | Requisito                                                                                                       | US     | Módulo dono | Pri | St  |
| ------ | --------------------------------------------------------------------------------------------------------------- | ------ | ----------- | :-: | :-: |
| RF-119 | Autenticar usuário e restringir o acesso às empresas às quais ele pertence                                      | US-059 | `core`      |  M  | ⬜  |
| RF-120 | Não revelar existência de usuário em falha de login e desacelerar tentativas repetidas                          | US-059 | `api`       |  M  | ⬜  |
| RF-121 | Rejeitar consulta a dados de negócio sem empresa no contexto                                                    | US-060 | `db`        |  M  | ⬜  |
| RF-122 | Impor isolamento entre empresas no banco via RLS, respondendo "não encontrado" para recurso de outra empresa    | US-060 | `db`        |  M  | ⬜  |
| RF-123 | Registrar em trilha de auditoria autor, canal, data e valores antes/depois de toda alteração de dado de negócio | US-061 | `core`      |  M  | ⬜  |
| RF-124 | Impedir alteração ou exclusão de registro de auditoria                                                          | US-061 | `db`        |  M  | ⬜  |
| RF-125 | Exportar todos os dados da empresa em formato aberto, sob solicitação                                           | US-062 | `core`      |  M  | ✅  |
| RF-126 | Manter exportação disponível mesmo com a conta bloqueada por inadimplência                                      | US-062 | `billing`   |  M  | ⬜  |
| RF-127 | Anonimizar dados pessoais mediante pedido de exclusão, preservando o que a legislação fiscal obriga a reter     | US-063 | `core`      |  M  | ✅  |
| RF-128 | Preservar a integridade de totais e relatórios após anonimização de um cliente                                  | US-063 | `core`      |  M  | ✅  |
| RF-129 | Correlacionar erro de integração ao identificador da requisição, incluindo a resposta do provedor               | US-064 | `api`       |  M  | ⬜  |
| RF-130 | Reprocessar job falho com espera crescente e limite de tentativas antes de descartar                            | US-064 | `worker`    |  M  | ⬜  |
| RF-131 | Registrar acesso administrativo a dados de tenant com justificativa                                             | US-064 | `core`      |  M  | ✅  |

---

## Requisitos por módulo dono

Quem implementa o quê. Base para a divisão de trilhas em
[`task-ledger.md`](../processo/task-ledger.md).

| Módulo             | Qtd | Faixas de requisitos                                                                                                                                                |
| ------------------ | --: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`    |  69 | RF-001, 002, 009–011, 014–019, 022–029, 032–034, 036, 037, 043, 044, 048, 054, 055, 057–062, 065–073, 078–080, 082–094, 099, 101, 119, 123, 125, 127, 128, 131, 132 |
| `packages/domain`  |  14 | RF-003, 007, 013, 020, 021, 030, 031, 035, 038, 040, 041, 056, 063, 064                                                                                             |
| `packages/agent`   |  31 | RF-095–098, 100, 102–109, 133–145, 147–151                                                                                                                          |
| `packages/billing` |  10 | RF-110–118, 126                                                                                                                                                     |
| `packages/fiscal`  |  10 | RF-004, 045–047, 049–053, 146                                                                                                                                       |
| `packages/banking` |   4 | RF-074–077                                                                                                                                                          |
| `packages/db`      |   4 | RF-081, 121, 122, 124                                                                                                                                               |
| `apps/api`         |   2 | RF-120, 129                                                                                                                                                         |
| `packages/money`   |   1 | RF-039                                                                                                                                                              |
| `apps/worker`      |   1 | RF-130                                                                                                                                                              |

> Nenhum requisito tem `apps/mobile` ou `apps/web` como dono — **por construção**.
> Os apps consomem casos de uso; não são donos de regra de negócio. Se um
> requisito novo parecer pertencer a um app, ele está mal localizado. Ver
> [princípios](../arquitetura/principios.md#a-regra-de-dependência).

## Requisitos bloqueados por decisão em aberto

| Decisão                                                                | Requisitos bloqueados                                                                        |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [DEC-003](../decisoes/README.md#dec-003) WhatsApp ✅ Meta Cloud API    | — (NR-046 ⬜, [ADR-0014](../decisoes/adr/0014-meta-cloud-api.md))                            |
| [DEC-023](../decisoes/README.md#dec-023) identidade do canal ✅        | — (RF-094, RF-095, RF-132: [ADR-0012](../decisoes/adr/0012-identidade-do-canal-whatsapp.md)) |
| [DEC-004](../decisoes/README.md#dec-004) provedor fiscal               | RF-045 a RF-054, RF-146                                                                      |
| [DEC-005](../decisoes/README.md#dec-005) Open Finance                  | RF-074, RF-075                                                                               |
| [DEC-006](../decisoes/README.md#dec-006) PSP ✅ Asaas                  | — (NR-044 pode começar)                                                                      |
| [DEC-007](../decisoes/README.md#dec-007) LLM ✅ Mastra + `gpt-4o-mini` | — (NR-060 ⬜); RAG auxiliar [ADR-0017](../decisoes/adr/0017-rag-com-tools-e-rls.md) / NR-120 |
| [DEC-008](../decisoes/README.md#dec-008) autenticação                  | RF-119, RF-120                                                                               |
| [DEC-010](../decisoes/README.md#dec-010) cobrança SaaS ✅              | preço/trial → [QST-002](../decisoes/README.md#qst-002)                                       |
| [DEC-011](../decisoes/README.md#dec-011) memória do agente ✅          | — (NR-062 ✅, [ADR-0016](../decisoes/adr/0016-memoria-da-conversa-tabelas-nossas.md))        |
| [DEC-012](../decisoes/README.md#dec-012) usuários e cupons             | RF-114, RF-115                                                                               |

Um requisito bloqueado **pode** ter sua interface e seus testes escritos antes
da decisão — é exatamente para isso que servem as portas dos adapters. O que não
pode é ter a implementação do provedor escolhida por omissão.

## Documentos relacionados

- [User Stories](user-stories.md) — a origem de cada requisito
- [Requisitos Não Funcionais](requisitos-nao-funcionais.md) — como o sistema se comporta
- [Módulos](../arquitetura/modulos.md) — onde cada módulo dono está documentado
