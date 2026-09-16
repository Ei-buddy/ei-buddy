# Feature Specification: EiBuddy MVP — ERP operacional por conversa

**Feature Branch**: `[001-eibuddy-mvp]`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "Faça com base em docs/"

**Fonte de verdade**: esta spec amarra o recorte do MVP já documentado em `docs/` para o fluxo Spec Kit (`/speckit-plan`, `/speckit-tasks`, `/speckit-implement`). Não substitui os catálogos permanentes. Em conflito de detalhe, prevalecem a [constitution](../../.specify/memory/constitution.md), o [escopo do MVP](../../docs/produto/escopo-mvp.md) e os IDs `US-xxx` / `RF-xxx` / `RNF-xxx`.

| Artefato permanente                                                  | Papel nesta spec                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------- |
| [Visão](../../docs/produto/visao.md)                                 | Problema, público, princípios e métricas                      |
| [Escopo do MVP](../../docs/produto/escopo-mvp.md)                    | O que entra, o que fica fora, critérios de saída              |
| [User Stories](../../docs/produto/user-stories.md)                   | 64 histórias com aceite (US-001–064)                          |
| [Requisitos funcionais](../../docs/produto/requisitos-funcionais.md) | 131 RFs rastreáveis                                           |
| [RNFs](../../docs/produto/requisitos-nao-funcionais.md)              | Comportamento mensurável                                      |
| [Personas](../../docs/produto/personas.md)                           | Cláudia (`owner`); Marcos fora do recorte; Roberto, João, Ana |
| [Glossário](../../docs/produto/glossario.md)                         | Linguagem ubíqua                                              |

## User Scenarios & Testing _(mandatory)_

Critério de corte do MVP ([escopo](../../docs/produto/escopo-mvp.md)): a Cláudia (P1, papel `owner`) opera o mês **sem planilha paralela** — registra vendas, emite nota, sabe o que tem a receber e a pagar, e cobra quem está devendo. App e WhatsApp acionam **as mesmas regras**, com as mesmas validações e a mesma trilha de auditoria. **Não há funcionário como usuário:** o que em outro ERP seria história do `staff` é da lojista ([US-003](../../docs/produto/user-stories.md#us-003--convidar-equipe) é `WON'T`).

Prioridade MoSCoW das histórias de origem: `MUST` entra; `SHOULD` entra se couber no recorte; `COULD` (Agenda, US-043–045) fica fora desta spec.

### User Story 1 - Da instalação à primeira venda (Priority: P1)

A Cláudia cadastra a empresa pelo CNPJ, revisa os dados, informa regime tributário e formas de pagamento (com taxas de cartão), cadastra um produto e um cliente com o mínimo de campos, e fecha a primeira venda. O período de teste começa ao concluir o cadastro, com prazo e limites explícitos.

**Why this priority**: sem este caminho o produto não é adotado. A métrica M3 da visão exige primeira venda em até 15 minutos.

**Independent Test**: uma lojista nova, com CNPJ válido, completa cadastro + um produto + um cliente + uma venda à vista e vê o comprovante da venda registrada, sem planilha.

**Acceptance Scenarios** (US-001, US-002, US-004, US-005, US-009, US-018, US-054 · RF-001–004, RF-007, RF-009–010, RF-017–019, RF-034, RF-110):

1. **Given** um CNPJ válido ainda não cadastrado, **When** a lojista confirma, **Then** razão social, nome fantasia e endereço vêm preenchidos e ela só revisa.
2. **Given** um CNPJ inválido ou inexistente, **When** ela confirma, **Then** vê o erro no campo e nada é criado.
3. **Given** um CNPJ já cadastrado, **When** ela confirma, **Then** é orientada a pedir acesso ao dono, **sem** revelar dados da empresa existente.
4. **Given** a consulta ao CNPJ indisponível, **When** ela confirma, **Then** pode preencher manualmente e seguir.
5. **Given** o cadastro da empresa concluído, **When** o onboarding termina, **Then** o período de teste começa com prazo e limites claros.
6. **Given** nome e telefone de um cliente, **When** ela salva, **Then** o cliente já pode ser usado na venda.
7. **Given** um código de barras novo, **When** ela cadastra o produto com preço, **Then** o produto entra no carrinho na venda seguinte.
8. **Given** um carrinho com item e pagamento em dinheiro ou Pix, **When** ela fecha, **Then** a venda fica registrada e o estoque baixa.

---

### User Story 2 - Venda no balcão (Priority: P1)

A Cláudia (P1, papel `owner`) monta o carrinho bipando código de barras ou buscando por nome, aplica desconto, vincula ou cria cliente sem sair da venda, recebe em uma ou várias formas (incluindo parcelado no crédito e troco em dinheiro) e fecha. Com internet ruim, os itens entram no carrinho na hora e sincronizam depois. Reenvio por falha de rede não duplica a venda.

**Why this priority**: é o caminho crítico do produto — o que acontece várias vezes por dia, em pé, com cliente esperando.

**Independent Test**: a lojista fecha vendas com leitor, busca, desconto, pagamento misto e fiado bloqueado sem cliente; um reenvio não cria segunda venda.

**Acceptance Scenarios** (US-014–019, US-021 · RF-027–039, RF-043–044 · RNF-003, RNF-043, RNF-051):

1. **Given** um carrinho aberto, **When** a lojista bipa um código válido, **Then** o item entra com o preço atual e a quantidade soma se o item já estiver no carrinho.
2. **Given** um código inexistente, **When** ela bipa, **Then** vê o erro e o carrinho não muda.
3. **Given** um produto sem estoque, **When** ela bipa, **Then** é avisada e decide se continua.
4. **Given** internet instável ou ausente, **When** ela bipa em sequência, **Then** cada item aparece no carrinho de imediato, sem esperar a rede.
5. **Given** parte do nome do produto, **When** ela busca, **Then** vê resultados ordenados pelos mais vendidos; se nada aparece, pode cadastrar ali mesmo.
6. **Given** um desconto em % ou em valor, **When** aplica, **Then** o total recalcula e ela vê o impacto na margem; desconto maior que o total é recusado.
7. **Given** uma venda sem cliente, **When** o pagamento é fiado (`wallet`), **Then** o fechamento é recusado até identificar o cliente; nas demais formas, fecha como consumidor não identificado.
8. **Given** total de R$ 100, **When** registra R$ 60 no Pix e R$ 40 em dinheiro, **Then** a venda fecha e o restante é zero; se a soma diferir do total, o fechamento é bloqueado com a diferença.
9. **Given** crédito em 3× de um valor que não divide exatamente, **When** as parcelas são criadas, **Then** a soma delas é exatamente o total (resto na primeira parcela) e cada parcela tem vencimento e tarifa.
10. **Given** dinheiro acima do total, **When** confirma, **Then** o troco aparece calculado.
11. **Given** uma falha ao fechar, **When** ela tenta de novo, **Then** não nasce uma venda duplicada.
12. **Given** uma venda do dia sem nota emitida, **When** ela cancela, **Then** estoque, contas a receber e carteira voltam ao estado anterior e a venda **não** é apagada.
13. **Given** uma devolução parcial, **When** ela confirma os itens, **Then** só esses itens voltam ao estoque e o valor proporcional é estornado.

---

### User Story 3 - Lucro real no fechamento (Priority: P1)

Ao fechar a venda, o sistema calcula sozinho — sem a lojista informar — custo dos itens, imposto do regime da empresa, tarifa de cartão conforme bandeira e parcelamento, e o valor líquido. Ela vê bruto, custo, imposto, tarifa, líquido e margem. Os recebíveis nascem da venda: Pix/dinheiro já liquidados; crédito em parcelas com data de repasse e líquido; fiado em aberto no cliente.

**Why this priority**: sem este cálculo o produto é um caderno digital — é a promessa de valor da visão.

**Independent Test**: fechar uma venda no crédito parcelado e conferir totais e parcelas; conferir que app e assistente produzem os mesmos números para a mesma venda.

**Acceptance Scenarios** (US-020, US-030 · RF-003, RF-007, RF-040–041, RF-063–064):

1. **Given** uma venda fechada, **When** a lojista abre o resumo, **Then** vê bruto, custo, imposto, tarifa de cartão, líquido e margem.
2. **Given** regime Simples Nacional configurado, **When** a venda fecha, **Then** o imposto usa a alíquota da empresa.
3. **Given** venda em dinheiro ou Pix, **When** fecha, **Then** o recebível já nasce liquidado.
4. **Given** venda em crédito parcelado, **When** fecha, **Then** nasce um recebível por parcela, com valor líquido e data prevista de repasse.
5. **Given** venda em fiado, **When** fecha, **Then** o recebível fica em aberto, o saldo devedor do cliente aumenta e a lojista é avisada desse saldo na próxima venda daquele cliente.
6. **Given** falha no meio do fechamento, **When** a operação não conclui, **Then** não resta venda sem estoque, nem estoque baixado sem venda, nem recebível órfão.

---

### User Story 4 - Operar pelo WhatsApp (Priority: P1)

A Cláudia se cadastra com celular — esse número é o vínculo do assistente na primeira empresa — e passa a perguntar e lançar em linguagem natural: vendas do dia, quem deve, cadastrar cliente, lançar venda simples, mandar cobrança. Consultar é livre. Criar, alterar ou apagar valor, e enviar mensagem a terceiro, exige confirmação explícita. Confirmação pendente expira; resposta ambígua conta como não. O assistente não inventa: se não entende, diz o que sabe fazer. Dados vêm dos mesmos casos de uso do aplicativo.

**Why this priority**: a tese do produto é a conversa como interface principal; o diferencial é a equivalência com o ERP, não o chatbot.

**Independent Test**: número vinculado consulta totais do dia, cadastra cliente com confirmação, lança venda simples com os mesmos números do app, dispara cobrança; número estranho não executa nada; “talvez” numa confirmação não executa.

**Acceptance Scenarios** (US-046–052 · RF-094–107):

1. **Given** que a lojista cadastrou um celular, **When** manda mensagem desse número, **Then** o assistente atende na primeira empresa, como owner.
2. **Given** um celular já usado por outro owner, **When** tenta cadastrar, **Then** é recusada sem ver de quem é a loja.
3. **Given** mensagem de um número que não é celular de owner, **When** chega, **Then** o assistente não executa nada e não vaza informação.
4. **Given** “quanto vendi hoje?”, **When** envia, **Then** recebe total do dia, número de vendas e ticket médio, provenientes do mesmo caso de uso do app.
5. **Given** “quem está me devendo?”, **When** envia, **Then** recebe inadimplentes com valor e dias de atraso.
6. **Given** uma pergunta que o assistente não entende, **When** envia, **Then** ele declara o que sabe fazer, sem inventar número.
7. **Given** “cadastra o João, 11 98888-7777”, **When** envia, **Then** o assistente mostra o que entendeu e pede confirmação; só cria depois do sim.
8. **Given** “venda pro João: 2 camisetas M a 49,90, pagou no Pix”, **When** confirma, **Then** a venda é criada com os mesmos cálculos do app e o estoque baixa.
9. **Given** produto ambíguo, **When** o assistente não decide, **Then** pergunta qual, listando as opções; item sem cadastro pode ser avulso com descrição e valor.
10. **Given** ação que mexe em valor ou envia mensagem a terceiro, **When** o assistente vai executar, **Then** resume e espera confirmação explícita; consulta não pede confirmação.
11. **Given** confirmação pendente, **When** passa o tempo limite ou a resposta é ambígua, **Then** nada é executado (ambíguo = não).
12. **Given** que acabou de falar de um cliente, **When** diz “manda a cobrança pra ele”, **Then** o assistente resolve “ele”; contexto antigo demais não se aplica silenciosamente a ação nova; conversas de empresas diferentes nunca se misturam.
13. **Given** “manda a cobrança pro João” e João tem dívida e consentimento, **When** ela confirma, **Then** a cobrança é enviada e ela recebe confirmação; se não há dívida, o assistente informa que não há o que cobrar.

---

### User Story 5 - NFC-e sem parar o caixa (Priority: P1)

Fechar a venda não espera a nota. A NFC-e é emitida em seguida. Autorizada, a lojista vê a chave e o cliente recebe o DANFE por WhatsApp (ou vê o QR Code na tela). Rejeição da SEFAZ vem em linguagem clara e a venda permanece. SEFAZ fora do ar: a venda fecha, a nota entra em contingência visível (não como sucesso falso) e transmite sozinha, em ordem, quando o serviço volta. Cancelar nota só dentro do prazo legal; fora, o caminho é devolução.

**Why this priority**: ficar em dia com o fisco sem passo extra, e sem multa por loja parada.

**Independent Test**: fechar venda com dados fiscais completos e obter nota autorizada (ou contingência explícita); rejeição não apaga a venda; cancelamento fora do prazo é recusado.

**Acceptance Scenarios** (US-022–025 · RF-045–054 · RNF-004, RNF-037, RNF-038):

1. **Given** venda fechada com dados fiscais completos, **When** a emissão corre, **Then** a nota é autorizada e a lojista vê a chave de acesso; o XML fica guardado pelo prazo legal.
2. **Given** produto sem NCM ou CFOP, **When** tenta emitir, **Then** é avisada de qual produto e qual campo falta, antes de enviar à SEFAZ.
3. **Given** rejeição da SEFAZ, **When** ocorre, **Then** vê código e descrição em linguagem clara e a venda continua registrada.
4. **Given** nota autorizada e cliente com WhatsApp e consentimento, **When** a venda fecha, **Then** o link/PDF é enviado; sem WhatsApp, o QR Code aparece na tela.
5. **Given** nota dentro do prazo legal, **When** cancela com justificativa, **Then** o cancelamento é registrado na SEFAZ **antes** do estorno da venda.
6. **Given** nota fora do prazo, **When** tenta cancelar, **Then** é informada do prazo e orientada a emitir devolução.
7. **Given** SEFAZ indisponível, **When** fecha a venda, **Then** a nota entra em contingência, a venda conclui normalmente e o estado fiscal fica explícito.
8. **Given** notas em contingência, **When** a SEFAZ volta, **Then** elas são transmitidas automaticamente, em ordem.

---

### User Story 6 - Fiado, a receber e cobrança (Priority: P2)

A Cláudia controla fiado no cadastro do cliente, vê quem deve (ordenado por valor e atraso), dá baixa total ou parcial, estorna baixa feita por engano e dispara cobrança pelo WhatsApp com valor, vencimento e origem. Sem consentimento do cliente final, o envio é bloqueado. Opt-out encerra envios futuros. Recebível liquidado não gera cobrança nova.

**Why this priority**: substitui o caderno de fiado e tira o constrangimento da cobrança — parte do critério de saída do MVP.

**Independent Test**: vender no fiado, listar inadimplente, cobrar com consentimento, recusar sem consentimento, baixar e ver saldo zerar.

**Acceptance Scenarios** (US-007, US-008, US-032–034 · RF-013–016, RF-066–072):

1. **Given** cliente com saldo devedor, **When** inicia nova venda, **Then** é avisada do saldo antes de fechar.
2. **Given** recebível em aberto, **When** dá baixa, **Then** sai do previsto, entra no realizado e o saldo do cliente diminui no mesmo valor; parcial deixa o resto em aberto.
3. **Given** baixa por engano, **When** estorna, **Then** o saldo do cliente é restaurado.
4. **Given** cliente com recebível vencido e consentimento, **When** envia a cobrança, **Then** ele recebe valor, vencimento e origem; o recebível guarda data e canal do último envio.
5. **Given** cliente sem consentimento, **When** tenta cobrar, **Then** é bloqueada e orientada; após opt-out, o sistema para de enviar e registra a data.
6. **Given** recebíveis vencidos, **When** abre a visão, **Then** vê clientes ordenados por valor devido, com dias de atraso, e o alerta também aparece no cadastro antes de nova venda.

---

### User Story 7 - Contas a pagar no fluxo de caixa (Priority: P2)

A Cláudia lança contas a pagar (fornecedor, valor, vencimento, anexo), dá baixa total ou parcial na conta bancária, estorna baixa errada e vê o que vence: atrasadas, hoje, semana e mês, com totais. Vencidas aparecem em destaque ao abrir o sistema. Vencimento no passado já nasce como atrasada.

**Why this priority**: sem a pagar, o mês ainda exige planilha — o critério de saída do MVP pede as duas pontas do caixa.

**Independent Test**: lançar uma conta, vê-la no grupo de vencimento certo, baixar e ver o realizado; estornar e ver o estado anterior.

**Acceptance Scenarios** (US-026, US-028, US-029 · RF-055–056, RF-059–062):

1. **Given** fornecedor, valor e vencimento, **When** salva, **Then** a conta aparece no fluxo previsto; anexo fica associado.
2. **Given** vencimento no passado, **When** salva, **Then** a conta já nasce atrasada.
3. **Given** conta em aberto, **When** dá baixa com data e conta bancária, **Then** sai do previsto e entra no realizado; parcial deixa saldo em aberto.
4. **Given** baixa por engano, **When** estorna, **Then** a conta volta ao estado anterior com registro do estorno.
5. **Given** contas cadastradas, **When** abre a visão a pagar, **Then** vê vencidas, hoje, esta semana e este mês, com total de cada grupo; vencidas no topo.

---

### User Story 8 - Confiança, isolamento e dados (Priority: P2)

A loja é operada só pelo `owner`. Convite de equipe, papel `staff` e alçada de desconto estão fora ([US-003](../../docs/produto/user-stories.md#us-003--convidar-equipe) `WON'T`). A Cláudia entra só nas empresas às quais pertence; falha de login não revela se a conta existe; tentativas repetidas desaceleram. Nenhuma loja vê dado de outra: recurso alheio parece inexistente. Toda alteração de negócio fica com autor, canal (app ou WhatsApp), data e valores antes/depois; auditoria não se altera. A lojista exporta tudo em formato aberto, inclusive com conta restrita por inadimplência. Pedido de exclusão de dados do cliente final anonimiza o pessoal e preserva totais e obrigação fiscal.

**Why this priority**: sem isolamento e dono dos dados, o lojista não confia o negócio ao sistema.

**Independent Test**: acesso cruzado entre empresas falha como “não encontrado”; exportação completa chega em formato aberto; anonimização preserva totais.

**Acceptance Scenarios** (US-059–063 · RF-119–128):

1. **Given** credenciais válidas, **When** entra, **Then** acessa só as empresas às quais pertence; se houver várias, escolhe qual operar.
2. **Given** credenciais inválidas, **When** tenta, **Then** a mensagem não revela se o usuário existe; após várias falhas, novas tentativas desaceleram.
3. **Given** consulta sem empresa no contexto, **When** executa, **Then** falha em vez de retornar tudo.
4. **Given** identificador de outra empresa, **When** tenta acessar direto, **Then** recebe “não encontrado”, não “sem permissão”.
5. **Given** qualquer alteração de dado de negócio, **When** ocorre, **Then** ficam autor, canal, data e valores antes/depois; ação do assistente registra o humano que confirmou.
6. **Given** um registro de auditoria, **When** alguém tenta alterá-lo, **Then** é impedido.
7. **Given** solicitação de exportação (conta ativa ou restrita), **When** fica pronta, **Then** o lojista recebe um pacote com todos os dados em formato aberto.
8. **Given** pedido de exclusão de dados pessoais, **When** é processado, **Then** o pessoal é anonimizado, totais de vendas antigas continuam corretos e fica registrado quando e por quem.

---

### User Story 9 - Assinatura sem sequestro de dados (Priority: P2)

Empresa nova entra em teste. Antes do fim, a lojista é avisada. Sem plano, passa a só ler e exportar — não cria lançamentos. Ao pagar, a assinatura ativa na hora; recusa de pagamento explica o motivo e permite nova tentativa sem perder dados. Inadimplência gera aviso por WhatsApp e e-mail com prazo até a restrição. Restrita: sem novos lançamentos, com leitura e exportação; o assistente informa o bloqueio e não executa ação. Pagamento confirmado restaura o acesso em minutos, sem intervenção humana.

**Why this priority**: o MVP precisa cobrar a plataforma sem contradizer “o lojista é dono dos dados”.

**Independent Test**: expirar o teste e verificar leitura+exportação sem escrita; pagar e voltar a lançar; assistente na conta restrita só informa o bloqueio.

**Acceptance Scenarios** (US-054–055, US-057–058 · RF-110–113, RF-116–118, RF-126):

1. **Given** trial acabando, **When** faltam poucos dias, **Then** a lojista é avisada com antecedência.
2. **Given** trial expirado sem plano, **When** acessa, **Then** lê e exporta, mas não cria lançamentos.
3. **Given** planos disponíveis, **When** escolhe e o pagamento confirma, **Then** a assinatura fica ativa imediatamente.
4. **Given** pagamento recusado, **When** ocorre, **Then** vê o motivo e tenta de novo sem perder dados.
5. **Given** cobrança não paga, **When** vence, **Then** recebe aviso por WhatsApp e e-mail com prazo até a restrição; pagamento no prazo cancela avisos.
6. **Given** prazo de tolerância vencido, **When** a restrição ocorre, **Then** não cria lançamentos, continua lendo e exportando, e o assistente explica o bloqueio sem executar.
7. **Given** empresa restrita, **When** o pagamento confirma, **Then** o acesso volta em minutos, sem intervenção manual.

---

### User Story 10 - Relatórios e pacote para o contador (Priority: P3)

A empresa nasce com plano de contas padrão de varejo. A Cláudia classifica lançamentos, vê um DRE simplificado do período (receita, deduções, custo, despesas, resultado) e exporta o mês em CSV + XMLs das notas para o Roberto (P3). Exportação grande roda em segundo plano com aviso quando pronta. Relatório de período sem movimento mostra zeros, não erro.

**Why this priority**: `SHOULD` no catálogo; não bloqueia o caixa do dia, mas reduz retrabalho com o contador e influencia permanência.

**Independent Test**: abrir DRE de um mês com vendas e uma despesa; exportar o pacote; período vazio mostra zeros.

**Acceptance Scenarios** (US-039–042 · RF-081–088):

1. **Given** empresa recém-criada, **When** o onboarding termina, **Then** já existe plano de contas padrão de varejo; conta com lançamento não pode ser apagada.
2. **Given** um lançamento de venda, **When** é criado, **Then** já vem na conta de receita padrão; fornecedor recorrente sugere a classificação anterior.
3. **Given** um período, **When** abre o relatório, **Then** vê receita bruta, deduções, custo, despesas e resultado; clicar a linha mostra os lançamentos; período parado mostra zeros.
4. **Given** um mês fechado, **When** exporta, **Then** recebe lançamentos em CSV e os XMLs das notas; volume grande processa em segundo plano com aviso.

---

### User Story 11 - Contas bancárias e conciliação assistida (Priority: P3)

A Cláudia cadastra contas bancárias, importa extrato (arquivo) sem duplicar linhas e casa transações com lançamentos a partir de sugestões por valor e data. Pode criar o lançamento a partir da transação e desfazer conciliação errada. Conexão automática com o banco (Open Finance) é desejável, não obrigatória para o recorte mínimo desta história.

**Why this priority**: `SHOULD` no catálogo; conciliação por arquivo já entrega conferência de caixa sem depender de decisão de Open Finance.

**Independent Test**: importar um extrato válido, conciliar uma linha, desfazer, rejeitar arquivo inválido sem importação parcial.

**Acceptance Scenarios** (US-035, US-037–038 · RF-073, RF-076–080):

1. **Given** banco, agência, conta e saldo inicial, **When** salva, **Then** a conta fica disponível para baixas e conciliação.
2. **Given** arquivo de extrato válido, **When** importa, **Then** vê quantas transações entraram e quantas foram ignoradas por duplicidade; reimportar não duplica.
3. **Given** arquivo inválido, **When** importa, **Then** vê o erro e nada entra pela metade.
4. **Given** uma transação do extrato, **When** abre a conciliação, **Then** o sistema sugere lançamentos compatíveis por valor e data; confirmar casa os dois; sem correspondência, pode criar o lançamento a partir dela; desfazer devolve ambos à fila.

---

### Edge Cases

- CNPJ duplicado, inválido ou consulta cadastral fora do ar no onboarding.
- Telefone ou CPF de cliente já existente: oferecer reuso, não silenciar o duplicado.
- Preço de venda menor que o custo: avisar, permitir confirmar.
- Produto sem controle de estoque: exibir “sem controle de estoque”, nunca saldo zero enganoso.
- Ajuste de estoque que deixaria saldo negativo: segundo aviso antes de gravar.
- Pagamento misto cuja soma não fecha o total: bloquear com a diferença em centavos.
- Parcelamento com dízima: soma das parcelas exatamente igual ao total.
- Reenvio de fechamento de venda (rede instável): uma única venda.
- Venda e nota: falha na nota **não** desfaz a venda; estado fiscal explícito (autorizada, contingência, rejeitada, cancelada).
- Cancelamento de venda com nota: só após cancelar a nota no prazo; fora do prazo, devolução.
- Mensagem de número não vinculado ao assistente: silêncio operacional, sem vazamento.
- Confirmação do assistente expirada ou ambígua: nada executado.
- Cobrança ou DANFE sem consentimento do cliente final: bloqueio, nunca envio.
- Conta restrita por trial/inadimplência: leitura e exportação permanecem; escrita e ferramentas do assistente que alteram valor não executam.
- Pedido de exclusão LGPD: anonimiza pessoal, preserva obrigação fiscal e totais.
- Acesso a recurso de outra empresa: resposta de “não encontrado”.
- Administradora da plataforma (P5) acessando dado de loja: só com justificativa registrada; não vê conversa sem consentimento explícito.
- Provedor fiscal, de mensagens, de cobrança ou de banco indisponível: o restante do sistema continua; a lojista vê o que falhou em linguagem clara.

## Requirements _(mandatory)_

Requisitos abaixo são o recorte testável desta spec. O catálogo canônico permanece em [`requisitos-funcionais.md`](../../docs/produto/requisitos-funcionais.md). IDs `RF-xxx` são permanentes.

### Equivalência de canais

- **FR-001**: Toda operação de negócio disponível no aplicativo e no assistente MUST produzir o mesmo resultado (validações, cálculos, estoque, recebíveis, auditoria) para a mesma entrada. Não existe regra só em um canal. (Princípio de produto; RF-101, RF-096)
- **FR-002**: Consultar MUST ser livre de confirmação. Criar, alterar ou excluir valor, e enviar mensagem a terceiro, MUST exigir confirmação explícita no canal em que a ação foi pedida. (RF-103, RF-104)

### Empresa e loja

- **FR-003**: O sistema MUST cadastrar empresa a partir do CNPJ com preenchimento automático de razão social, nome fantasia e endereço, permitir preenchimento manual se a consulta falhar, e recusar CNPJ duplicado sem revelar dados da empresa existente. (RF-001, RF-002)
- **FR-004**: O sistema MUST registrar o regime tributário da empresa e usá-lo no imposto das vendas; MUST guardar certificado digital da empresa de forma protegida e avisar com 30 dias de antecedência do vencimento; certificado vencido ou senha errada MUST ser recusado com o motivo. (RF-003, RF-004)
- **FR-005**: Convite de equipe, papel `staff` e revogação de funcionário estão fora deste recorte. O operador da loja é o `owner`. (US-003 `WON'T`; RF-005, RF-006, RF-008, RF-012, RF-042 cancelados)
- **FR-006**: A lojista MUST configurar taxas da adquirente por bandeira e parcelamento e formas de pagamento ativas. (RF-007)

### Clientes

- **FR-007**: O sistema MUST cadastrar cliente com apenas nome e telefone; CPF, se informado, MUST ser validado e usado na nota; duplicidade por telefone ou CPF MUST oferecer reuso. (RF-009, RF-010)
- **FR-008**: O sistema MUST listar o histórico de compras do cliente (data, itens, valor) em ordem decrescente; cadastro sem compras MUST ter estado vazio explícito. (RF-011)
- **FR-009**: O sistema MUST manter saldo de fiado por cliente, alterado por venda `wallet` e por recebimento, e avisar o saldo devedor ao iniciar nova venda. (RF-013, RF-014)
- **FR-010**: O sistema MUST vincular o número de WhatsApp ao cadastro do cliente, registrar consentimento e opt-out, e recusar envio sem consentimento. (RF-015, RF-016)

### Produtos e estoque

- **FR-011**: O sistema MUST cadastrar e localizar produto pela leitura de código de barras e gerar código interno quando não houver código de barras. (RF-017, RF-018, RF-019)
- **FR-012**: O sistema MUST registrar custo e preço, calcular margem em valor e percentual, e alertar (sem bloquear) preço abaixo do custo. Valores monetários MUST ser exatos até o centavo. (RF-020, RF-021)
- **FR-013**: O sistema MUST consultar saldo, preço e localização, distinguindo “sem controle de estoque” de saldo zero. (RF-022)
- **FR-014**: Ajuste de estoque MUST registrar autoria, motivo e data; venda fechada MUST baixar estoque; cancelamento ou devolução MUST restaurar o que couber; ajuste para saldo negativo MUST exigir confirmação extra. (RF-023, RF-024)

### Vendas

- **FR-015**: O operador MUST adicionar item por código de barras (somando quantidade se repetido) ou por busca de nome ordenada pelos mais vendidos, com aviso de falta de estoque permitindo seguir. (RF-027, RF-028, RF-029)
- **FR-016**: A lojista MUST aplicar desconto em valor ou percentual, no item ou na venda; desconto maior que o total MUST ser recusado. (RF-030, RF-031)
- **FR-017**: O operador MUST vincular ou criar cliente sem sair da venda; venda sem cliente MUST ser permitida, exceto no fiado. (RF-032, RF-033)
- **FR-018**: O sistema MUST registrar pagamento em dinheiro, Pix, débito, crédito ou fiado; calcular troco em dinheiro; aceitar pagamento dividido cuja soma seja exatamente o total; e impedir venda duplicada em reenvio. (RF-034, RF-035, RF-036, RF-037)
- **FR-019**: Crédito parcelado MUST gerar uma conta a receber por parcela, com vencimento e tarifa; a soma das parcelas MUST ser exatamente o total. (RF-038, RF-039)
- **FR-020**: Ao fechar, o sistema MUST calcular e exibir bruto, custo, imposto, tarifa, líquido e margem. (RF-040, RF-041)
- **FR-021**: Cancelamento MUST estornar estoque, recebíveis e carteira sem apagar a venda; devolução total ou parcial MUST estornar só os itens e o valor proporcional; autoria, data e motivo MUST ficar registrados. (RF-043, RF-044)
- **FR-022**: Fechamento da venda MUST atualizar venda, estoque e recebível juntos — nunca pela metade. (comportamento de RNF-046)

### Emissão fiscal

- **FR-023**: O sistema MUST emitir NFC-e a partir da venda fechada **sem** impedir o fechamento da venda; MUST validar NCM/CFOP/CST-CSOSN antes de transmitir; MUST traduzir rejeição em linguagem clara preservando a venda; MUST guardar o XML pelo prazo legal. (RF-045, RF-046, RF-047)
- **FR-024**: Nota autorizada MUST ser entregue ao cliente por WhatsApp quando houver número e consentimento, ou por QR Code na tela. (RF-048, RF-049)
- **FR-025**: Cancelamento de nota MUST exigir justificativa e respeitar o prazo legal; fora do prazo, o sistema MUST orientar devolução. (RF-050, RF-051)
- **FR-026**: Com a SEFAZ indisponível, a nota MUST entrar em contingência com estado explícito; ao voltar, as notas MUST ser transmitidas em ordem. (RF-052, RF-053, RF-054)

### Contas a pagar e a receber

- **FR-027**: O sistema MUST lançar conta a pagar com fornecedor, valor, vencimento e anexo, marcar atraso quando o vencimento já passou, dar baixa total ou parcial e permitir estorno da baixa. (RF-055, RF-056, RF-059, RF-060)
- **FR-028**: O sistema MUST agrupar contas a pagar em vencidas, hoje, semana e mês, com total por grupo, e destacar vencidas na abertura. (RF-061, RF-062)
- **FR-029**: O fechamento da venda MUST gerar os recebíveis automaticamente: líquido e data de repasse no crédito; já liquidado em dinheiro/Pix; em aberto no fiado. (RF-063, RF-064)
- **FR-030**: O sistema MUST dar baixa total ou parcial em recebível atualizando o saldo do cliente, e estornar baixa restaurando o saldo. (RF-066, RF-067)
- **FR-031**: O sistema MUST enviar cobrança com valor, vencimento e origem, registrar data e canal do último envio, recusar envio sem consentimento e não cobrar recebível já liquidado. (RF-068, RF-069, RF-070)
- **FR-032**: O sistema MUST listar inadimplentes por valor devido e dias de atraso, e alertar a inadimplência no cadastro e ao iniciar venda. (RF-071, RF-072)

### Assistente

- **FR-033**: O sistema MUST tratar o celular obrigatório do owner no cadastro como vínculo WhatsApp da primeira empresa (somente o owner opera o canal); mensagem de número não vinculado MUST ser ignorada sem executar ação nem revelar informação. Troca de celular MUST exigir sessão do aplicativo e substituir o vínculo. (RF-094, RF-095, RF-132)
- **FR-034**: O assistente MUST responder consulta em linguagem natural a partir dos mesmos casos de uso do aplicativo e, se não reconhecer a intenção, declarar capacidades sem inventar. (RF-096, RF-097)
- **FR-035**: O assistente MUST extrair cadastro de cliente e venda (cliente, itens, quantidades, valores, forma de pagamento) da mensagem, detectar duplicidade de cliente, desambiguar produto e permitir item avulso. (RF-098, RF-099, RF-100, RF-102)
- **FR-036**: Venda lançada pelo assistente MUST usar o mesmo caso de uso do aplicativo. (RF-101)
- **FR-037**: Confirmação pendente MUST expirar após o tempo limite configurado; resposta ambígua MUST ser tratada como recusa. (RF-104)
- **FR-038**: O assistente MUST manter contexto da conversa para referências (“ele”, “essa venda”), isolar contexto por empresa e não reaplicar contexto antigo silenciosamente. (RF-105, RF-106)
- **FR-039**: O assistente MUST disparar cobrança após confirmação e informar o lojista do resultado, inclusive quando não há dívida. (RF-107)

### Assinatura

- **FR-040**: Cadastro de empresa MUST iniciar período de teste com prazo e limites explícitos e avisar a lojista antes do fim. (RF-110, RF-111)
- **FR-041**: Pagamento confirmado MUST ativar a assinatura de imediato; recusa MUST explicar o motivo e permitir nova tentativa sem perda de dados. (RF-112, RF-113)
- **FR-042**: Inadimplência MUST gerar aviso por WhatsApp e e-mail com prazo até a restrição. Conta restrita (trial expirado ou tolerância esgotada) MUST impedir novos lançamentos e manter leitura e exportação. O assistente MUST informar o bloqueio sem executar ação. Pagamento confirmado MUST restaurar o acesso automaticamente em minutos. (RF-116, RF-117, RF-118, RF-126)

### Plataforma, privacidade e operação visível

- **FR-043**: O sistema MUST autenticar o usuário, restringir o acesso às empresas às quais ele pertence, não revelar existência de usuário em falha de login e desacelerar tentativas repetidas. (RF-119, RF-120)
- **FR-044**: Consulta de negócio sem empresa no contexto MUST falhar. Isolamento entre empresas MUST ser imposto no armazenamento, não só na tela; recurso de outra empresa MUST parecer inexistente. (RF-121, RF-122)
- **FR-045**: Toda alteração de dado de negócio MUST gerar trilha somente-inclusão com autor, canal, data e valores antes/depois. (RF-123, RF-124)
- **FR-046**: A lojista MUST poder exportar todos os dados da empresa em formato aberto a qualquer momento, inclusive com conta restrita. (RF-125, RF-126)
- **FR-047**: Pedido de exclusão de dados pessoais MUST anonimizar o pessoal em até 15 dias, preservar o que a lei fiscal obriga a reter e manter totais corretos. (RF-127, RF-128 · RNF-033)
- **FR-048**: Falha de emissão, mensagem ou cobrança MUST ser correlacionável a um identificador da requisição, com a resposta do provedor em linguagem acionável para suporte; falha transitória MUST ser retentada com espera crescente antes de desistir. Acesso da administradora da plataforma a dado de loja MUST ficar registrado com justificativa. (RF-129, RF-130, RF-131)
- **FR-049**: Mensagens ao lojista e à interface MUST estar em português do Brasil, tom direto; erro MUST dizer o que aconteceu e o que fazer, sem jargão nem código cru. (RNF-054, RNF-057)

### Recorte SHOULD (entra no MVP se couber; não bloqueia o critério de saída do caixa)

- **FR-050**: O sistema SHOULD alertar estoque baixo de forma consolidada no dia, quando o produto tiver mínimo definido. (RF-025, RF-026)
- **FR-051**: O sistema SHOULD gerar contas a pagar recorrentes no mesmo dia de vencimento, permitir alterar uma ocorrência isolada e encerrar a recorrência preservando as pagas. (RF-057, RF-058)
- **FR-052**: O sistema SHOULD lançar recebível avulso com origem, vencimento e classificação. (RF-065)
- **FR-053**: O sistema SHOULD cadastrar conta bancária, importar extrato sem duplicar nem importar pela metade, sugerir conciliação por valor e data, permitir criar lançamento a partir da transação e desfazer conciliação. Conexão Open Finance (RF-074, RF-075) permanece desejável e depende de decisão de provedor. (RF-073, RF-076–080)
- **FR-054**: O sistema SHOULD oferecer plano de contas padrão, classificação de lançamentos, DRE simplificado e exportação CSV+XML para o contador, com processamento em segundo plano quando o volume for grande. (RF-081–088)
- **FR-055**: O assistente SHOULD enviar resumo de período (faturamento, custo, despesas, resultado) e, se o relatório for grande demais para uma mensagem, um resumo mais arquivo ou link. (RF-108, RF-109)
- **FR-056**: O sistema SHOULD aplicar cupom de assinatura mostrando o valor final antes de confirmar, e recusar cupom inválido, expirado ou já usado com o motivo. (RF-114, RF-115)

### Key Entities _(include if feature involves data)_

Nomes de negócio em PT-BR; identificadores em inglês conforme o [glossário](../../docs/produto/glossario.md).

- **Empresa (`Company`)**: tenant. Isolamento, regime tributário, certificado, taxas de cartão. Nunca se confunde com filial no MVP.
- **Usuário (`User`) e Papel (`Role`)**: o operador da loja é `owner`. `staff` é valor reservado, fora do recorte. `accountant` fica fora do MVP como login; `platform_admin` opera a plataforma.
- **Cliente (`Customer`)**: nome, telefone, CPF opcional, WhatsApp, consentimento/opt-out, saldo de fiado, histórico de compras.
- **Produto (`Product`)**: código de barras ou interno, preço, custo, margem, saldo, mínimo opcional, dados fiscais (NCM, CFOP).
- **Movimentação de estoque (`InventoryMovement`)**: autoria, motivo, data; gerada por venda, ajuste, cancelamento e devolução.
- **Carrinho (`Cart`) e Venda (`Sale`)**: documento fechado (não pedido). Itens, descontos, pagamentos, totais (bruto, custo, imposto, tarifa, líquido, margem). Nunca apagada.
- **Pagamento (`Payment`) e Parcela (`Installment`)**: formas `debit`, `credit`, `pix`, `cash`, `wallet`; soma das parcelas = total.
- **Nota (`ConsumerInvoice` / NFC-e)**: chave, XML, estado (autorizada, contingência, rejeitada, cancelada), prazo legal de cancelamento.
- **Conta a receber (`Receivable`) e Conta a pagar (`Payable`)**: vencimento, liquidação total/parcial, estorno, origem (venda ou avulsa).
- **Cobrança**: envio ao cliente final com valor, vencimento, origem, data/canal, condicionado a consentimento.
- **Conta bancária (`BankAccount`), Extrato (`BankStatement`) e Conciliação (`Reconciliation`)**: casamento transação × lançamento.
- **Plano de contas (`ChartOfAccounts`) e Lançamento (`Entry`)**: classificação e DRE simplificado.
- **Assistente (`Agent`), Conversa (`Conversation`), Confirmação (`Confirmation`)**: contexto isolado por empresa; confirmação com prazo.
- **Assinatura (`Subscription`)**: trial, ativa, vencida, restrita (leitura+exportação), encerrada.
- **Auditoria (`AuditLog`)**: somente inclusão; autor humano inclusive quando o canal é o assistente.
- **Exportação**: pacote completo da empresa em formato aberto; pacote mensal CSV+XML para o contador.

## Success Criteria _(mandatory)_

Alvos M1–M7 da [visão](../../docs/produto/visao.md#métricas-de-sucesso) são hipóteses iniciais (QST-007), não metas validadas. Servem como critério de produto desta spec até revisão com clientes reais.

### Measurable Outcomes

- **SC-001**: Uma lojista nova registra a primeira venda em até 15 minutos após começar o cadastro da empresa (M3), sem treinamento formal.
- **SC-002**: Após 30 dias, pelo menos 60% das lojistas que concluíram o onboarding continuam ativas (M1).
- **SC-003**: Pelo menos 40% das vendas das lojistas ativas são lançadas pelo WhatsApp (M2), com os mesmos totais que teriam no aplicativo.
- **SC-004**: Lojista ativa registra pelo menos 20 vendas por semana (M4).
- **SC-005**: Pelo menos 85% das intenções enviadas ao assistente são atendidas sem correção humana posterior (M5).
- **SC-006**: No balcão, o fechamento da venda conclui sem esperar a nota; o operador percebe a venda registrada de imediato (alvo de engenharia: até 1,5 s até a confirmação na tela, excluindo a SEFAZ).
- **SC-007**: Ao bipar, o item aparece no carrinho de forma imediata mesmo com rede ruim ou ausente (alvo: até 200 ms percebidos no aparelho).
- **SC-008**: Consulta pelo assistente é respondida em até 5 segundos; ação com confirmação, em até 8 segundos após o “sim”.
- **SC-009**: Em 100% das vendas parceladas e dos pagamentos mistos, a soma das partes é exatamente o total, até o centavo.
- **SC-010**: Reenvio do mesmo fechamento de venda nunca cria segunda venda.
- **SC-011**: Em 100% dos testes de acesso cruzado, uma loja não lê dado de outra; o caso aparece como registro inexistente.
- **SC-012**: O operador da loja é o `owner` e vê custo, margem e imposto no resumo da venda; não há usuário `staff` neste recorte.
- **SC-013**: Lojista com conta restrita exporta a base completa em formato aberto; tentativa de novo lançamento é recusada com mensagem clara.
- **SC-014**: Uma lojista real opera um mês inteiro sem planilha paralela para vendas, notas, a receber, a pagar e cobrança (critério de saída do MVP).
- **SC-015**: Churn mensal de lojistas pagantes ≤ 5% (M6), medido após a primeira coorte fora do teste.
- **SC-016**: Custo de inteligência artificial por lojista ativa permanece ≤ 15% da mensalidade (M7 / RNF-072), com teto por empresa e degradação avisada em vez de fatura surpresa.

## Assumptions

- Público do MVP: comércio varejista de pequeno porte no Brasil, com CNPJ, Simples Nacional, operado pelo próprio dono no balcão, que já vende pelo WhatsApp e emite (ou deveria emitir) NFC-e. Prestador de serviço com NFS-e e negócio sem CNPJ ficam para depois.
- Canais do MVP: aplicativo (o que é melhor na tela: código de barras, relatório, fechamento) e WhatsApp (interface principal de operação). Não há atendimento ao cliente final pelo assistente.
- Papéis no MVP: `owner` na loja; `platform_admin` na operação da plataforma. `staff` está fora (US-003 `WON'T`). Login de `accountant` fica fora; o contador recebe exportação enviada pela lojista.
- Confirmação pendente do assistente expira em **5 minutos** se `docs/` não definir outro prazo (RF-104 exige expiração; o valor exato não está no catálogo).
- Duração e preço do trial e dos planos seguem a tabela comercial quando QST-002 fechar; o **comportamento** (avisar, restringir escrita, manter leitura/exportação) já está especificado e não espera a tabela para ser testável.
- Provedores externos (WhatsApp, fiscal, PSP, Open Finance, memória do assistente) podem estar em decisão aberta (`DEC-xxx`); a spec descreve o comportamento. Implementação de fornecedor concreto não faz parte deste documento.
- Importação de extrato por arquivo é o caminho de conciliação que não depende de Open Finance; RF-074/075 permanecem SHOULD.
- Alerta de estoque baixo, conta recorrente, cupom, DRE e relatório pelo assistente são SHOULD: entregam valor, não bloqueiam o critério de saída do caixa.
- Métricas M1–M7 e alvos numéricos de desempenho são hipóteses a recalibrar com dados reais (QST-007, QST-008).
- Identidade: número de WhatsApp prova continuidade de conversa, não identidade forte. Vincular número, trocar conta de repasse, exportar ou anonimizar a base exige sessão no aplicativo (segundo canal).
- Offline completo do aplicativo web está fora; offline do PDV no celular (carrinho local + sincronização) está dentro (RNF-051).
- Esta spec cobre **um** recorte de produto (o MVP). Tarefas de engenharia, trilhas e ledger continuam em `docs/processo/`; ADRs em `docs/decisoes/adr/`.

## Out of Scope

Itens explícitos de [Fora do MVP](../../docs/produto/escopo-mvp.md#fora-do-mvp) e histórias `COULD` / `WON'T`. Não entram por conveniência de sprint.

- Agenda (US-043–045, RF-089–093).
- Marketplace, vitrine, propaganda, gamificação, IA proativa, parcerias por elegibilidade.
- Atendimento ao cliente final pelo assistente; aplicativo para o cliente final.
- Portal do contador (exportação manual no MVP).
- Múltiplas filiais, múltiplos depósitos, kit/composição, lote e validade.
- Orçamento, pedido, delivery, comanda.
- NFS-e; régua de cobrança automática; negativação; pagamento pelo sistema; múltiplas moedas.
- Emitir nota, conciliar banco ou alterar preço em lote **por mensagem**.
- Plataforma de atendimento, marketplace, sistema contábil ou instituição de pagamento (o produto gera cobrança Pix/link via PSP e registra a maquininha da loja; não custodia dinheiro).

## Dependencies

Decisões que travam implementação de provedor (portas e testes com dublê podem existir antes):

| Decisão | Impacto na spec                                                                                                |
| ------- | -------------------------------------------------------------------------------------------------------------- |
| DEC-003 | Canal WhatsApp ✅ Meta Cloud API ([ADR-0014](../../docs/decisoes/adr/0014-meta-cloud-api.md)); adapter NR-046  |
| DEC-004 | Provedor fiscal (RF-045–054)                                                                                   |
| DEC-005 | Open Finance (RF-074, 075) — SHOULD                                                                            |
| DEC-009 | Hospedagem ✅ VPS + Compose ([ADR-0015](../../docs/decisoes/adr/0015-vps-docker-compose.md)); workflows NR-015 |
| DEC-011 | Memória do assistente (RF-105, 106)                                                                            |
| DEC-012 | Cupons (RF-114, 115) — SHOULD                                                                                  |
| QST-002 | Preço, trial e limites comerciais                                                                              |
| QST-007 | Recalibração das métricas de sucesso                                                                           |

Já fechadas e assumidas: marca e domínio EiBuddy / eibuddy.com.br (ADR-0011); identidade própria no aplicativo (ADR-0002 / ADR-0003); isolamento por linha (ADR-0001).
