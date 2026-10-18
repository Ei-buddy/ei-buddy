# Feature Specification: Operação diária do Buddy no WhatsApp

**Feature Branch**: `012-buddy-operacao-whatsapp`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "Pelo WhatsApp, o Buddy cadastra, altera, consulta, baixa, ajusta, cancela e cobra o que a dona já faz na operação diária. O que ele grava aparece na web e no histórico da loja. Ele não apaga registro nenhum. Fonte: `docs/prd/feature-buddy-whatsapp.md`."

## Clarifications

### Session 2026-10-06

- Q: Pedido de apagar um registro — a conversa só recusa, ou marca como deletado? → A: Marca como deletado e a frase diz que foi deletado. O registro sai da lista do dia a dia e continua guardado com essa marca. Nenhuma ação remove o registro guardado.
- Q (plano): “Apagar venda” usa soft-delete? → A: Não. Venda segue cancelamento da venda inteira (permanece no histórico como cancelada). Soft-delete com frase “deletado” vale para cliente e produto. Conta e contato não ganham remoção nesta entrega.

## Escopo desta fatia

A dona já opera o EiBuddy na web e no celular. O Buddy já entende parte desses pedidos na conversa. Esta entrega fecha a operação do dia a dia na mesma conversa do WhatsApp, com os números e os cadastros que a tela já mostra.

**Entra:**

1. Consulta livre: vendas de um período nomeado (hoje, este mês, o mês passado, o ano), com quantidade, total e ticket médio; resumo do período; faturamento por mês; ranking de clientes e de produtos; histórico de compras de um cliente; estoque; contas a pagar; contas a receber; saldo em carteira; agenda de um dia; busca de produto.
2. Gravação só depois de um sim inequívoco: cadastrar cliente; editar um cliente; cadastrar produto; editar um produto (descrição, preço de venda ou custo); registrar venda; lançar conta a pagar; lançar valor a receber que não vem de venda; dar baixa em conta a pagar ou em recebível; ajustar estoque para a quantidade contada, com motivo; cancelar a venda inteira, com motivo; marcar um registro como deletado; criar compromisso; enviar cobrança a um cliente com dívida em aberto.
3. Pedido incompleto: o Buddy pergunta o que falta e só então propõe a ação.
4. Frase ambígua que cabe numa ação já existente: o Buddy diz o que entendeu e espera. “Compra” de um cliente é uma venda.
5. Quem pode falar, conta restrita, falha sem fingir sucesso, e a mesma mensagem de gravação já confirmada entregue de novo.
6. Um roteiro escrito para uma pessoa conferir a conversa contra o histórico da loja e a tela.

**O que a conversa já faz e esta entrega mantém alinhado à tela:** cadastro de cliente e de produto, venda, contas a pagar e a receber, baixa, estoque, agenda, cobrança, vendas do período com ticket médio, faturamento e resumo do período.

**O que esta entrega acrescenta na conversa:** editar um cliente; editar descrição, preço de venda ou custo de um produto, visível na ficha; ranking de clientes; ranking de produtos; histórico de compras do cliente; tratar “compra” do cliente como venda; marcar um registro como deletado e dizer que foi deletado.

**Fora desta fatia:**

| Fora agora                                                    | Por quê                                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------------- |
| Remover o registro guardado                                   | O pedido de apagar marca como deletado; o registro continua guardado |
| Alterar preço de vários produtos de uma vez                   | A edição é de um cliente ou de um produto por vez                    |
| Devolução parcial de itens                                    | O cancelamento desta entrega é da venda inteira                      |
| Certificado, senha de emitente, extrato, conciliação bancária | Continuam na tela; a conversa recusa                                 |
| Comando avulso de emitir ou cancelar nota                     | A nota continua efeito da venda ou do cancelamento da venda          |
| Login, assinatura e administração da plataforma               | Não são a operação diária da loja                                    |
| Outra pessoa, outro papel ou outro celular                    | Só a dona com cadastro ativo, no celular já vinculado                |
| Foto de código de barras                                      | Continua com o comportamento já entregue                             |

**Definition of Done:** na conversa da dona no WhatsApp, cada capacidade desta spec responde ou grava como a tela, pede o que falta, só grava no sim, e o que foi gravado aparece na web. Pedido de apagar confirmado marca o registro como deletado, a frase diz que foi deletado, e o registro continua guardado. Uma pessoa consegue seguir o roteiro e conferir conversa, histórico e tela.

## User Scenarios & Testing _(mandatory)_

Persona: **Cláudia**, dona da loja, com cadastro ativo. O celular de onde ela escreve já está vinculado à empresa dela. Ela atende no balcão e fala com o Buddy na mesma conversa do WhatsApp.

### User Story 1 - Consultar a loja na conversa (Priority: P1)

Cláudia pergunta quanto vendeu, o ticket médio, o resumo, o faturamento, os rankings, o histórico de um cliente, o estoque, as contas, o fiado, a agenda ou um produto. O Buddy responde na hora, com os mesmos nomes e valores da tela, sem pedir confirmação.

**Why this priority**: a decisão no balcão depende do número que a tela já calcula. Consulta errada ou inventada quebra a confiança antes de qualquer cadastro.

**Independent Test**: com vendas, clientes e produtos conhecidos, fazer cada pergunta da lista de consultas e comparar a frase com a tela no mesmo período ou no mesmo cadastro. Nenhuma dessas perguntas grava nem pede sim.

**Acceptance Scenarios**:

1. **Given** vendas conhecidas num período que ela nomeou (hoje, este mês, o mês passado ou o ano), **When** ela pergunta quanto vendeu ou o ticket médio, **Then** a frase traz a quantidade, o total e o ticket médio que a tela mostra para esse período. (US-047, RF-096)
2. **Given** um período sem vendas, **When** ela pergunta o ticket médio, **Then** a frase diz que não houve venda e não apresenta um ticket médio. (US-047)
3. **Given** um período com movimento, **When** ela pede o resumo, **Then** a frase traz faturamento, custo, despesas e resultado do mesmo período da tela. (US-053, RF-108)
4. **Given** faturamento já visível por mês na tela, **When** ela pede o faturamento por mês, **Then** os valores coincidem com a tela.
5. **Given** ranking de clientes ou de produtos na tela para o período que ela perguntou, **When** o Buddy responde, **Then** nomes e valores coincidem com essa consulta.
6. **Given** um cliente com compras, **When** ela pede o histórico, **Then** a frase lista as compras da mais recente para a mais antiga, com data, itens e valor, iguais à tela. (US-006, RF-011)
7. **Given** um cliente sem compras, **When** ela pede o histórico, **Then** a frase diz que não há compras.
8. **Given** estoque, contas a pagar, contas a receber, saldo em carteira, agenda de um dia ou um produto que ela busca, **When** ela pergunta, **Then** a resposta coincide com a tela e não pede confirmação. (US-065, US-066, US-067, US-045, RF-133, RF-134, RF-135, RF-093)

---

### User Story 2 - Cadastrar e corrigir cliente e produto (Priority: P1)

Cláudia inclui um cliente ou um produto falando, e corrige um cadastro que já existe. O que o Buddy grava é o que ela vê na web. Um pedido curto demais não vira cadastro.

**Why this priority**: cadastro errado no balcão vira venda errada em seguida. Cliente e produto são o começo da operação.

**Independent Test**: mandar “adicione café” e conferir que o produto não existe; completar unidade, custo e preço, confirmar, e ver o produto na web. Alterar só o telefone de um cliente e só o preço de um produto, e conferir que o resto ficou igual.

**Acceptance Scenarios**:

1. **Given** “adicione café” sem unidade, custo e preço de venda, **When** o Buddy responde, **Then** ele pede esses dados e o produto não existe na loja nem na web.
2. **Given** descrição, unidade, custo e preço de venda informados e um sim inequívoco, **When** o cadastro conclui, **Then** o produto na web tem esses quatro dados, com o nome e o preço que foram gravados. (US-069, RF-140, US-010)
3. **Given** preço de venda menor que o custo, **When** ela pede o cadastro, **Then** nada é gravado e a frase informa a recusa. (RF-021)
4. **Given** um cliente novo só com o nome, **When** ela confirma, **Then** o cliente passa a existir na web. O Buddy tinha dito quais dados são obrigatórios e quais são opcionais.
5. **Given** telefone ou documento igual ao de um cliente já cadastrado, **When** ela pede outro cadastro, **Then** o Buddy mostra o cadastro parecido e não cria outro até ela decidir. (RF-010)
6. **Given** um cliente já cadastrado, **When** ela pede para alterar só o telefone e confirma, **Then** o telefone muda e o restante do cadastro permanece, na web e no histórico.
7. **Given** um produto já cadastrado, **When** ela pede para alterar o preço de venda e confirma, **Then** a ficha do produto na web mostra o preço novo e o custo anterior.
8. **Given** dois clientes ou dois produtos com o mesmo nome, **When** ela pede a ação, **Then** o Buddy pergunta qual e não escolhe sozinho. (RF-102)
9. **Given** um pedido para mudar o preço de vários produtos de uma vez, **When** o Buddy responde, **Then** ele não altera o lote.

---

### User Story 3 - Registrar a venda, inclusive quando ela diz compra (Priority: P1)

Cláudia descreve a venda na conversa. Se ela disser que o cliente fez uma compra, o lançamento é uma venda da empresa dela, a mesma da tela.

**Why this priority**: a venda é o movimento do balcão. Tratar “compra” como outro documento suja o histórico.

**Independent Test**: com cliente e produto já existentes, descrever uma venda completa dizendo “compra”, confirmar, e ver uma venda da empresa dela na web, com itens, quantidades, valores e forma de pagamento.

**Acceptance Scenarios**:

1. **Given** um cliente citado numa frase de compra e os dados da venda completos (itens, quantidades, valores e forma de pagamento), **When** ela confirma, **Then** existe uma venda da empresa dela, visível na web. (US-049, RF-100, RF-101)
2. **Given** a frase ainda sem item, quantidade, valor ou forma de pagamento, **When** o Buddy responde, **Then** ele diz que entendeu uma venda e pergunta o que falta. Nada é gravado.
3. **Given** dois clientes ou dois produtos possíveis, **When** ela pede a venda, **Then** o Buddy pergunta qual e não escolhe sozinho.
4. **Given** ela confirma, **When** a venda entra, **Then** a frase usa o cliente, os itens, as quantidades e os valores que ficaram gravados, os mesmos da tela.

---

### User Story 4 - Contas, estoque, cancelamento, agenda e cobrança (Priority: P2)

Cláudia lança e baixa contas, acerta o estoque contado, cancela uma venda inteira, marca um compromisso e envia cobrança sem abrir o sistema no balcão.

**Why this priority**: completa o dia a dia depois que consulta, cadastro e venda já funcionam. Cada uma dessas ações já existe na tela e passa a caber na conversa com a mesma regra.

**Independent Test**: executar uma ação de cada tipo, com os dados que a tela exige, confirmar, e ver o mesmo efeito na web. Recusar ou deixar expirar e ver que nada mudou.

**Acceptance Scenarios**:

1. **Given** valor, vencimento e descrição de uma conta a pagar, **When** ela confirma, **Then** a conta aparece na web como na tela. (US-070, RF-141)
2. **Given** um valor a receber que não vem de venda, com os dados que a tela exige, **When** ela confirma, **Then** o recebível aparece na web. (US-071, RF-142)
3. **Given** uma conta a pagar ou um recebível em aberto, **When** ela confirma a baixa, **Then** a baixa é a mesma da tela. (US-072, US-073, RF-143, RF-144)
4. **Given** uma quantidade contada e um motivo, **When** ela confirma o ajuste de estoque, **Then** o saldo na web fica nessa quantidade. (US-074, RF-145)
5. **Given** uma venda e um motivo, **When** ela confirma o cancelamento da venda inteira, **Then** a venda continua no histórico como cancelada. (US-075, RF-147)
6. **Given** título, data e hora, **When** ela confirma o compromisso, **Then** ele aparece na agenda. (US-076, RF-148)
7. **Given** um cliente com dívida em aberto, **When** ela confirma o envio da cobrança, **Then** a cobrança é enviada e ela recebe o aviso do envio. (US-052, RF-107)
8. **Given** um cliente sem dívida, **When** ela pede cobrança, **Then** o Buddy informa que não há o que cobrar e nada é enviado.

---

### User Story 5 - Só gravar depois do sim (Priority: P1)

Nada é gravado, alterado, baixado, cancelado ou enviado a outra pessoa antes de Cláudia dizer sim. Se faltar dado, o Buddy pergunta. Se a gravação falhar, ele não diz que deu certo. Se a mesma mensagem já confirmada chegar de novo, não nasce outro registro.

**Why this priority**: um pedido curto ou um sim atrasado não pode virar lançamento. Esta história vale sozinha em qualquer uma das gravações.

**Independent Test**: propor um cadastro de produto completo, responder “não”, um texto ambíguo, ficar em silêncio e responder sim depois do prazo. Em todos, o produto não existe. No sim dentro do prazo, existe um produto. Entregar de novo a mesma mensagem já confirmada e continuar com um só produto.

**Acceptance Scenarios**:

1. **Given** uma ação de escrita com dados suficientes, **When** o Buddy responde, **Then** ele descreve o que vai fazer e espera. Nada muda antes do sim. (US-050, RF-103)
2. **Given** uma confirmação pendente, **When** a resposta é não, ambígua ou silêncio, **Then** nada muda na loja nem na web. (RF-104)
3. **Given** uma confirmação já expirada, **When** ela responde sim, **Then** nada é gravado e o Buddy pede para enviar o pedido de novo.
4. **Given** a gravação falha, **When** o Buddy responde, **Then** a frase explica a falha e não afirma que gravou.
5. **Given** a mesma mensagem de gravação já confirmada entregue de novo, **When** o sistema a recebe, **Then** não nasce um segundo registro.
6. **Given** uma frase que não corresponde a nenhuma ação que o sistema já faz, **When** o Buddy responde, **Then** ele diz que não faz isso e não grava. (RF-097)

---

### User Story 6 - Marcar como deletado (Priority: P1)

Cláudia pede para apagar um cliente ou um produto. O Buddy confirma, marca o registro como deletado e diz que foi deletado. O registro sai da lista do dia a dia e continua guardado. Se ela pede para apagar uma venda, o Buddy trata como cancelamento da venda inteira: a frase diz que foi cancelada e a venda permanece no histórico. Conta e contato não são removidos pela conversa nesta entrega.

**Why this priority**: ela precisa ouvir o desfecho, e a loja precisa conservar o registro. Remover o que está guardado não tem volta. Venda não some: correção é cancelamento.

**Independent Test**: pedir para apagar um cliente e um produto, confirmar, ouvir que foi deletado, ver fora da lista e ainda guardado. Pedir para apagar uma venda, confirmar, e ver a venda cancelada no histórico. Pedir para apagar conta ou contato e ver recusa sem remoção.

**Acceptance Scenarios**:

1. **Given** um pedido para apagar um cliente ou um produto, **When** o Buddy responde e ela ainda não disse sim, **Then** ele descreve que vai marcar o registro como deletado e espera. O registro continua como estava.
2. **Given** esse pedido e um sim inequívoco, **When** a marcação conclui, **Then** o registro fica marcado como deletado, sai da lista do dia a dia, continua guardado com essa marca, e a frase diz que foi deletado.
3. **Given** a marcação falha, **When** o Buddy responde, **Then** a frase não diz que foi deletado.
4. **Given** um pedido para apagar uma venda, com motivo e sim, **When** a ação conclui, **Then** a venda aparece cancelada no histórico, não ausente. A frase comunica o cancelamento.
5. **Given** um pedido para apagar uma conta ou um contato, **When** o Buddy responde, **Then** ele não remove o registro e explica que não faz essa remoção pela conversa nesta entrega.

---

### User Story 7 - Só a dona opera a loja (Priority: P1)

O Buddy atende Cláudia pelo celular do cadastro ativo, na empresa já vinculada a esse celular. Outro número não vê dado da loja. Conta restrita consulta e não grava.

**Why this priority**: número errado ou conta bloqueada não pode lançar nem revelar se a loja existe.

**Independent Test**: enviar a mesma pergunta de um celular de dona ativa, de um número sem cadastro, de um celular antigo e de uma conta restrita. Só o primeiro consulta e, no sim, grava. A conta restrita consulta e, ao tentar gravar, não grava.

**Acceptance Scenarios**:

1. **Given** Cláudia com cadastro ativo, **When** ela manda um texto ao número do produto, **Then** o Buddy responde na mesma conversa. (US-046, RF-094)
2. **Given** um número sem cadastro ativo de dona, inativo ou que deixou de ser o celular atual, **When** chega uma mensagem, **Then** não há consulta nem gravação da loja, e o texto não confirma se o número existe. (RF-095, RF-132)
3. **Given** uma conta restrita, **When** ela pergunta quanto vendeu, **Then** recebe o número da loja, como na tela.
4. **Given** uma conta restrita, **When** ela pede para gravar e confirmaria, **Then** nada é gravado e a frase explica que a conta não pode lançar agora. (RF-117, RF-118)

### Edge Cases

- Período de ranking ou de histórico não nomeado: o Buddy pergunta o período e não escolhe um sozinho.
- Dois cadastros com o mesmo nome: o Buddy lista e espera a escolha.
- Preço de venda abaixo do custo: recusa antes de gravar, com a mesma regra da tela.
- Telefone ou documento repetido: mostra o cadastro parecido e espera a decisão dela.
- Confirmação expirada, “não”, texto ambíguo ou silêncio: nenhum efeito.
- Sim atrasado, depois do prazo: não grava a proposta velha.
- Mensagem nova que já é outro pedido, com a confirmação anterior vencida: a proposta velha não executa; a mensagem nova é tratada como pedido novo.
- A mesma mensagem já confirmada chega outra vez: um só registro. Uma frase nova, mandada de propósito depois, pode ser outro pedido.
- Falha na gravação: a frase não diz que deu certo. Falha ao marcar como deletado: a frase não diz que deletou.
- Pedido de apagar confirmado: a frase diz que deletou; o registro fica marcado como deletado, sai da lista do dia a dia e continua guardado.
- Pedido de certificado, senha, extrato, conciliação, nota avulsa, login, assinatura ou administração: uma frase de recusa, sem gravação.
- “Emite a nota” ou “cancela a nota” sem a venda: recusa. A nota segue a venda ou o cancelamento da venda.
- Cliente sem dívida: cobrança não é enviada.
- Ajuste de estoque sem motivo, ou cancelamento sem motivo: o Buddy pede o motivo e não grava.
- Edição pede só um campo: os outros campos do cadastro permanecem.
- Loja de outra dona: nenhuma consulta e nenhuma gravação desta conversa alcançam essa loja.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: O Buddy MUST responder na mesma conversa do WhatsApp à dona com cadastro ativo, identificada pelo celular que enviou a mensagem, na empresa já vinculada a esse celular. (US-046, RF-094)
- **FR-002**: Número sem cadastro ativo de dona, cadastro inativo ou celular que deixou de ser o atual MUST receber recusa sem informar se o número existe, e MUST NOT consultar nem alterar dado da loja. (RF-095, RF-132)
- **FR-003**: Conta restrita MUST poder consultar a própria loja e MUST NOT gravar, alterar, baixar, cancelar, ajustar, marcar como deletado, criar compromisso nem enviar cobrança. A frase MUST explicar a restrição. (RF-117, RF-118)
- **FR-004**: Consulta de vendas do período, ticket médio, resumo, faturamento por mês, ranking, histórico de compras, estoque, contas a pagar, contas a receber, saldo em carteira, agenda do dia e busca de produto MUST ser respondida sem confirmação. (US-047, US-050, RF-096, RF-103)
- **FR-005**: Para um período nomeado na pergunta, a resposta de vendas MUST trazer quantidade, total e ticket médio iguais aos da tela nesse período. Período sem venda MUST dizer que não houve venda e MUST NOT apresentar ticket médio. (US-047)
- **FR-006**: O resumo do período MUST trazer faturamento, custo, despesas e resultado iguais aos da tela. O faturamento por mês MUST coincidir com a tela. (US-053, RF-108)
- **FR-007**: Ranking de clientes e ranking de produtos, no período perguntado, MUST coincidir em nomes e valores com a consulta da tela. Se o período não foi dito, o Buddy MUST perguntar qual é.
- **FR-008**: O histórico de compras de um cliente MUST coincidir com a tela, da compra mais recente para a mais antiga, com data, itens e valor. Cliente sem compras MUST receber uma frase de que não há compras, não uma lista inventada. (US-006, RF-011)
- **FR-009**: Estoque, contas, saldo em carteira, agenda de um dia e busca de produto MUST usar o mesmo resultado que a tela mostra para a mesma pergunta. (US-065, US-066, US-067, US-045)
- **FR-010**: Dado que a frase não trouxe MUST NOT ser inventado. O Buddy MUST perguntar o que falta e só então propor a ação. Nenhum efeito de escrita ocorre enquanto faltar dado obrigatório.
- **FR-011**: Produto novo MUST exigir descrição, unidade, custo e preço de venda. “Adicione café”, sem esses dados, MUST NOT criar produto.
- **FR-012**: Preço de venda menor que o custo MUST ser recusado pela mesma regra da tela, antes de gravar, e a frase MUST informar a recusa. (RF-021, US-010)
- **FR-013**: Cliente novo MUST exigir nome. O Buddy MUST dizer quais dados são obrigatórios e quais são opcionais. Telefone ou documento repetido MUST mostrar o cadastro parecido e MUST NOT criar outro até a dona decidir. (US-005, RF-010)
- **FR-014**: Frase em que o cliente “fez uma compra” MUST ser tratada como venda da empresa da dona. (US-049, RF-100)
- **FR-015**: Venda MUST exigir os mesmos dados que a tela exige para fechar: itens, quantidades, valores e forma de pagamento. Mais de um cliente ou mais de um produto com o mesmo nome MUST gerar pergunta, e o Buddy MUST NOT escolher sozinho. (RF-101, RF-102)
- **FR-016**: Edição nesta entrega MUST ser de um cliente ou de um produto por vez. MUST NOT haver alteração de preço em lote. A edição MUST alterar só o que a dona pediu; o restante do cadastro permanece.
- **FR-017**: Depois de confirmar novo preço de venda de um produto, a ficha na web MUST mostrar o preço novo e o custo anterior, salvo se ela também tiver pedido para mudar o custo.
- **FR-018**: Cadastrar cliente, editar cliente, cadastrar produto, editar produto, registrar venda, lançar conta a pagar, lançar valor a receber fora de venda, dar baixa, ajustar estoque, cancelar venda inteira, marcar como deletado, criar compromisso e enviar cobrança MUST ocorrer só depois de sim inequívoco. Valor, quantidade, data e nome na frase de resultado MUST ser os que foram gravados e MUST coincidir com a tela. (US-050, RF-103)
- **FR-019**: Não, silêncio e resposta ambígua MUST NOT executar a ação pendente. Confirmação expirada MUST NOT ser executada por um sim posterior. (RF-104)
- **FR-020**: Falha ao gravar MUST virar frase de falha. O Buddy MUST NOT dizer que gravou.
- **FR-021**: A mesma mensagem de gravação já confirmada, entregue de novo, MUST NOT criar um segundo registro daquela ação. (RNF-043)
- **FR-022**: Pedido de apagar cliente ou produto MUST, depois do sim, marcar o registro como deletado. A frase MUST dizer que foi deletado. O registro MUST sair da lista do dia a dia e MUST continuar guardado. Pedido de apagar venda MUST seguir o cancelamento da venda inteira (FR-023), sem marca de deletado na venda. Pedido de apagar conta ou contato MUST ser recusado sem remoção nesta entrega. Esta entrega MUST NOT incluir ação que remova o registro guardado.
- **FR-023**: Cancelar a venda inteira, com motivo e sim, MUST manter a venda no histórico como cancelada. O efeito em estoque e em valores MUST ser o mesmo da tela. (US-075, RF-147)
- **FR-024**: Pedido de certificado, senha de emitente, extrato, conciliação, nota avulsa, login, assinatura ou administração da plataforma MUST ser recusado em uma frase, sem gravação. Nota fiscal MUST continuar efeito da venda ou do cancelamento da venda. (RF-149, RF-150, RF-151)
- **FR-025**: Frase que não corresponde a uma ação que o sistema já faz MUST ser recusada, sem gravação. (RF-097)
- **FR-026**: Frase ambígua que corresponde a uma ação existente MUST ser devolvida como o que o Buddy entendeu, à espera do que falta ou da confirmação.
- **FR-027**: Ajuste de estoque MUST pedir a quantidade contada e o motivo. Cancelamento de venda MUST pedir o motivo. Sem o motivo, nada é gravado. (US-074, US-075)
- **FR-028**: Cobrança MUST ir apenas a cliente com dívida em aberto, e só depois do sim. Cliente sem dívida MUST receber a informação de que não há o que cobrar, sem envio. (US-052, RF-107)
- **FR-029**: Dado de uma loja MUST NOT aparecer na conversa de outra. (RF-121)
- **FR-030**: Ao final da entrega MUST existir um roteiro enumerado de prompts. Cada capacidade desta spec MUST ter ao menos uma linha, com a mensagem enviada, o comportamento esperado da resposta, e o que conferir no histórico da loja e na web depois do sim, quando houver gravação. O roteiro MUST ser executável por uma pessoa contra a conversa, o histórico e a tela. O roteiro não substitui a conferência automática de cada comportamento.

### Key Entities

- **Dona**: quem opera a loja na conversa. Identificada pelo celular do cadastro ativo, na empresa já vinculada a esse celular. Conta restrita continua sendo ela, com consulta liberada e gravação bloqueada.
- **Cliente**: cadastro da loja. Nome obrigatório. Telefone e documento, quando informados, não repetem outro cadastro até ela decidir. Edição muda só o campo pedido.
- **Produto**: cadastro com descrição, unidade, custo e preço de venda. A ficha na web mostra o preço e o custo depois da edição. Preço de venda abaixo do custo não grava.
- **Venda**: lançamento da empresa dela, com itens, quantidades, valores e forma de pagamento. “Compra” do cliente é esta venda. Cancelada, permanece no histórico como cancelada. Apagada, fica marcada como deletada e continua guardada.
- **Registro marcado como deletado**: cliente, produto, venda, conta, contato ou outro cadastro que a dona pediu para apagar e confirmou. Sai da lista do dia a dia. A conversa diz que foi deletado. O registro guardado permanece.
- **Conta a pagar e recebível**: obrigações da loja. Recebível desta entrega que não nasce de venda é lançamento avulso. Baixa segue a mesma regra da tela.
- **Compromisso**: item da agenda com título, data e hora.
- **Consulta**: leitura de um período ou de um cadastro. Não pede confirmação. Período sem movimento não ganha número inventado.
- **Confirmação pendente**: resumo do que será feito, à espera de um sim inequívoco, com prazo para expirar. Não, silêncio, ambiguidade e prazo vencido não geram efeito.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Em 100% das mensagens de texto da dona com cadastro ativo cobertas por esta spec, ela recebe resposta na mesma conversa do WhatsApp.
- **SC-002**: Em 100% das tentativas de gravação sem sim inequívoco dentro do prazo, cadastro, venda, estoque, conta, agenda e cobrança permanecem como estavam.
- **SC-003**: Em 100% das perguntas de vendas sobre um período com movimento conhecido, a frase usa a mesma quantidade, o mesmo total e o mesmo ticket médio que a tela mostra para esse período.
- **SC-004**: Em 100% dos períodos sem venda, a resposta não apresenta ticket médio.
- **SC-005**: Em 100% dos rankings e históricos pedidos com período ou cliente identificado, nomes e valores coincidem com a consulta da tela.
- **SC-006**: Em 100% das edições confirmadas de um único campo, os demais campos do cadastro permanecem iguais na web.
- **SC-007**: Em 100% das confirmações de novo preço de venda, a ficha do produto mostra o preço novo e o custo que ela não pediu para mudar.
- **SC-008**: Em 100% das entregas repetidas da mesma mensagem de gravação já confirmada, existe um único registro daquela ação.
- **SC-009**: Em 100% das mensagens de número sem cadastro ativo de dona, nenhum dado da loja é consultado nem alterado, e a resposta não revela se o número existe.
- **SC-010**: Em 100% dos pedidos de apagar cliente ou produto confirmados, a frase diz que foi deletado, o registro sai da lista do dia a dia e continua guardado marcado como deletado. Em 100% dos pedidos de apagar venda confirmados, a venda permanece no histórico como cancelada. Em 100% desses casos nenhuma linha de negócio é removida de forma definitiva.
- **SC-011**: Uma pessoa executa o roteiro uma vez e confere cada capacidade desta spec na conversa, no histórico da loja e na web, com pelo menos uma linha por capacidade.
- **SC-012**: Consulta respondida e resumo de confirmação chegam no tempo que a dona já espera do assistente: consulta em até 5 segundos e, depois do sim, a frase com o resultado em até 8 segundos, no uso normal do balcão. (RNF-006)

## Assumptions

- Cláudia é a dona (`owner`). Não há operador de outro papel nesta entrega. O celular do cadastro ativo continua sendo a identidade da conversa, na empresa já vinculada a esse celular.
- O prazo da confirmação pendente permanece 5 minutos, contados da proposta, como já vale para o assistente (RF-104). Sim inequívoco é o mesmo tipo de aceite que a conversa já usa. “Não”, silêncio e texto ambíguo não executam.
- “A mesma mensagem entregue de novo” é a reentrega da mensagem que já foi confirmada, não uma frase nova que ela manda depois de propósito. Frase nova pode ser outro pedido.
- Cliente novo exige nome, como o PRD desta entrega decidiu. Telefone e documento são opcionais; se vierem e repetirem um cadastro, vale a duplicata. O catálogo ainda diz, em RF-009, que o cadastro exige nome e telefone. O planejamento deve alinhar o catálogo a esta spec, em vez de voltar a exigir telefone.
- Conta restrita é a dona que ainda lê a loja e não pode lançar (trial encerrado ou tolerância de pagamento esgotada, RF-117). Consulta permanece. Tentativa de gravar é recusada com a explicação do bloqueio (RF-118).
- Ranking ou histórico sem período nomeado: o Buddy pergunta. Não adota “este mês” em silêncio.
- Quantidade, total, ticket médio, custo, despesa, resultado e imposto vêm da mesma regra que a tela já usa. O Buddy não recalcula esses números na redação. A redação muda as palavras e conserva o fato gravado ou consultado.
- Cada comportamento novo desta entrega é provado por conferência automática antes de ser dado como pronto. O roteiro de prompts é conferência humana, separada, no caminho `docs/qa/buddy-roteiro-de-prompts.md`, com uma linha por capacidade: mensagem, resposta esperada em comportamento (não frase idêntica), e o que deve existir, mudar ou permanecer no histórico e na web.
- Edição de cliente e de produto, ranking e histórico de compras na conversa ainda não têm identificador próprio no catálogo de requisitos. Até o catálogo ser atualizado, a fonte desses quatro comportamentos é esta spec, junto com RF-010, RF-011, RF-021 e a ficha que a web já mostra.
- Foto de código de barras, devolução parcial, preço em lote e as recusas de certificado, extrato e nota avulsa ficam fora do que esta entrega acrescenta. O que a tela já faz nesses temas não é desfeito.
- Pedido de apagar cliente ou produto, depois do sim, marca como deletado e a frase diz que foi deletado (história 6, FR-022). Pedido de apagar venda mapeia para cancelamento (FR-023). Conta e contato: recusa sem remoção nesta entrega. Não existe ação cujo efeito seja remover o registro guardado.
