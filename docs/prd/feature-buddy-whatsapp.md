# PRD — Buddy, assistente no WhatsApp

> Tipo: Feature · Data: 2026-10-05
> Status: Pronto para planejamento

## Visão geral e objetivo

A dona da loja já opera o EiBuddy na web e no mobile, e o assistente já entende parte desses pedidos. Falta ela conseguir fazer a operação do dia a dia falando com o Buddy no WhatsApp, e receber respostas sobre a loja com os números que o sistema já calcula.

O resultado desta entrega: pelo WhatsApp, o Buddy cadastra, altera, consulta, baixa, ajusta, cancela e cobra o que a dona já faz na operação diária. O que ele grava aparece na web e no banco. Ele não apaga registro nenhum.

## Contexto do projeto

O produto é o EiBuddy. Buddy é o nome do assistente na conversa.

O assistente já interpreta mensagem, escolhe uma ação e executa o mesmo caso de uso da tela, com confirmação antes de gravar o que mexe em dado. A conversa da dona no WhatsApp já se reconhece pelo celular do cadastro, na empresa vinculada a esse celular. Número sem cadastro, inativo ou que deixou de ser o atual não consulta nem altera, e a resposta não revela se o número existe.

Já existem ações de conversa para cliente, produto, venda, contas a pagar e a receber, baixa, estoque, agenda, cobrança, vendas do período (com ticket médio), faturamento e resumo do período. A web já edita cliente. A ficha do produto existe na web; a edição de preço e custo pelo chat precisa aparecer nessa ficha. Ranking de clientes, ranking de produtos e histórico de compras do cliente existem como consulta da tela e ainda não são conversa.

Certificado, senha de emitente, extrato, conciliação bancária e comando avulso de nota já são recusados na conversa, com orientação para o aplicativo. Nota fiscal continua efeito da venda ou do cancelamento da venda.

## Decisões do produto

- Buddy atende a dona no WhatsApp e cobre a operação diária que ela já faz na web e no mobile: cadastros, venda, estoque, contas a pagar e a receber, baixa, agenda e as consultas desta entrega.
- Cada ação do Buddy é uma tool do Mastra. A tool chama o endpoint HTTP que a tela usa para aquela ação e devolve o retorno ao modelo. O modelo redige a frase em linguagem natural a partir desse retorno, tanto no sucesso quanto no erro.
- Valor, quantidade, data e nome citados na frase são os do retorno do endpoint. A redação muda as palavras; não muda o fato.
- Nada é gravado, alterado, baixado, cancelado ou enviado a terceiro antes de confirmação explícita.
- Dado que a frase não trouxe não é inventado. O Buddy pergunta o que falta e só então propõe a ação.
- Frase ambígua: o Buddy diz o que entendeu e espera confirmação. “Compra” de um cliente é uma venda. Se a frase não corresponder a uma ação que o sistema já faz, o Buddy diz isso e não grava.
- Não existe tool de exclusão no banco de dados. Pedido de apagar cliente, produto, venda, conta, contato ou qualquer outro registro só faz PATCH para deletado ou deleted_at.
- Cancelar venda, estornar o efeito dela, dar baixa e ajustar estoque permanecem. Cancelar não apaga a venda: ela continua no histórico como cancelada. Essas ações pedem confirmação.
- Edição nesta entrega é de um cliente ou de um produto por vez. Não há alteração de preço em lote.
- Conta restrita continua podendo consultar e não podendo gravar, como no aplicativo.
- O desenvolvimento segue TDD: cada comportamento novo começa por um teste automatizado que falha, e só então entra o código que o faz passar.
- Ao final da entrega existe um roteiro manual de prompts, separado dos testes automatizados, para uma pessoa conferir a conversa contra o banco e a web.

## Histórias de usuário

- Como dona, quero falar com o Buddy no WhatsApp, para registrar e consultar a loja na mesma conversa em que estou vendendo.
- Como dona, quero cadastrar e editar cliente e produto pela conversa, para ver o mesmo cadastro na web.
- Como dona, quero registrar uma venda, inclusive quando eu disser que o cliente fez uma compra, para o lançamento ser o mesmo da tela.
- Como dona, quero lançar e baixar contas, ajustar estoque, cancelar uma venda, marcar compromisso e enviar cobrança pelo Buddy, para não abrir o sistema no balcão.
- Como dona, quero perguntar quanto vendi, o ticket médio, o resumo do período, os rankings e o histórico de um cliente, para decidir com o número que a tela já mostra.
- Como dona, quero que o Buddy peça o que falta e confirme antes de gravar, para um pedido curto não virar lançamento errado.
- Como dona, quero que um pedido de apagar não apague no banco de dados, para o Buddy não remover histórico da loja.

## Regras de negócio e dados

Buddy só opera para a dona com cadastro ativo, identificada pelo celular de quem enviou a mensagem, na empresa já vinculada a esse celular. Outra pessoa, outro papel ou outro número recebe recusa sem informação da loja.

Confirmação explícita é um sim inequívoco. Não, silêncio e resposta ambígua não executam. Confirmação pendente expira; depois de expirada, o sim não grava.

Consulta livre, sem confirmação:

- vendas de um período nomeado na pergunta (hoje, este mês, o mês passado, o ano), com quantidade, total e ticket médio do mesmo período que a tela usa
- resumo do período, com faturamento, custo, despesas e resultado
- faturamento por mês
- ranking de clientes e ranking de produtos no período perguntado
- histórico de compras de um cliente
- estoque, contas a pagar, contas a receber, saldo em carteira de um cliente, agenda de um dia e busca de produto

Gravação só depois do sim, pelo endpoint da tela:

- cadastrar cliente
- editar cliente
- cadastrar produto
- editar um produto (descrição, preço de venda ou custo)
- registrar venda
- lançar conta a pagar
- lançar valor a receber que não vem de venda
- dar baixa em conta a pagar ou em recebível
- ajustar estoque para a quantidade contada, com motivo
- cancelar venda inteira, com motivo
- criar compromisso
- enviar cobrança a um cliente com dívida em aberto

Produto novo exige descrição, unidade, custo e preço de venda. O preço de venda abaixo do custo é recusado pela mesma regra da tela, antes de gravar. “Adicione café”, sem esses dados, não cria produto.

Cliente novo exige nome. Telefone ou documento repetido segue a regra de duplicata já usada no cadastro: o Buddy mostra o cadastro parecido e não cria outro até a dona decidir. Buddy fala quais dados são opicionais e quais são obrigatórios.

Venda exige o que a tela já exige para fechar: itens, quantidades, valores e forma de pagamento. Cliente na venda é o que a frase identificou; se houver mais de um, o Buddy pergunta qual. Produto ambíguo também pergunta, e não escolhe sozinho.

Edição altera só o que a dona pediu. O restante do cadastro permanece.

Pedido de apagar do banco de dados, certificado, senha, extrato, conciliação, nota avulsa, login, assinatura ou administração da plataforma não ganha tool. O Buddy recusa em uma frase e não chama endpoint de escrita.

Erro do endpoint vira frase de falha. O Buddy não diz que gravou.

A mesma mensagem entregue de novo não cria um segundo registro da ação já confirmada.

## Fluxos

### Pedido incompleto

1. A dona manda um pedido sem os dados obrigatórios, por exemplo “adicione café”.
2. O Buddy pergunta unidade, custo e preço de venda. Nenhum endpoint de escrita é chamado.
3. Com os dados completos, o Buddy repete o que vai cadastrar e espera o sim.
4. No sim, a tool chama o endpoint de cadastro de produto. A frase diz o resultado com o nome e o preço devolvidos.
5. O produto passa a aparecer na web e no banco. Preço de venda menor que o custo não grava e a frase explica a recusa.

### Gravação com confirmação

1. A dona pede uma ação de escrita com dados suficientes.
2. O Buddy descreve a ação e espera.
3. Sim inequívoco: a tool chama o endpoint. A frase comunica o retorno.
4. Não, resposta ambígua ou confirmação expirada: nada muda no banco nem na web.

### Consulta

1. A dona pergunta, por exemplo, quanto vendeu hoje ou o ticket médio do mês passado.
2. A tool chama o endpoint de leitura do período.
3. A frase traz quantidade, total e ticket médio desse período, iguais aos da tela para a mesma pergunta.
4. Período sem venda: a frase diz que não houve venda e não inventa ticket médio.

### Frase ambígua

1. A dona diz algo como “lança a compra do João”.
2. O Buddy diz que entendeu uma venda para João e pergunta o que falta (itens, quantidades, valores, pagamento) ou pede confirmação se já estiver completo.
3. Só no sim a venda é registrada.
4. Se a frase não for uma ação existente, o Buddy diz que não faz isso e não grava.

### Pedido de exclusão

1. A dona pede para apagar um cliente, produto, venda, conta ou contato.
2. O Buddy recusa. Nenhum registro é removido.
3. Cancelar uma venda continua disponível: o Buddy pede o motivo, confirma, e a venda permanece no histórico como cancelada.

### Falha e quem não pode falar

1. O endpoint rejeita o pedido: a frase explica a falha e não afirma sucesso.
2. Número sem cadastro ativo de dona: nenhuma consulta, nenhuma gravação, e o texto não confirma se o número existe.

## Critérios de aceite

- Dado a dona com cadastro ativo, quando ela manda um texto ao número do produto, então o Buddy responde na mesma conversa do WhatsApp.
- Dado “adicione café” sem unidade, custo e preço, quando o Buddy responde, então ele pede esses dados e o produto não existe no banco nem na web.
- Dado custo e preço de venda informados e um sim inequívoco, quando a tool conclui, então o produto na web e no banco tem a descrição, a unidade, o custo e o preço confirmados.
- Dado preço de venda menor que o custo, quando a dona pede o cadastro, então nada é gravado e a frase informa a recusa.
- Dado um cliente citado por uma frase de compra e os dados da venda completos, quando a dona confirma, então existe uma venda da empresa dela, visível na web, e não um outro tipo de documento.
- Dado dois produtos ou dois clientes com o mesmo nome, quando a dona pede a ação, então o Buddy pergunta qual e não escolhe sozinho.
- Dado um cliente já cadastrado, quando a dona pede para alterar só o telefone e confirma, então o telefone muda e o restante do cadastro permanece, na web e no banco.
- Dado um produto já cadastrado, quando a dona pede para alterar o preço de venda e confirma, então a ficha do produto na web mostra o preço novo e o custo anterior.
- Dado vendas conhecidas num período, quando a dona pergunta quanto vendeu ou o ticket médio, então a frase usa a quantidade, o total e o ticket médio que a tela mostra para esse período.
- Dado um período sem vendas, quando a dona pergunta o ticket médio, então a resposta não apresenta um valor inventado.
- Dado ranking ou histórico pedido para um período ou um cliente, quando o Buddy responde, então os nomes e valores coincidem com a consulta da tela.
- Dado um pedido de apagar qualquer registro, quando o Buddy responde, então ele faz PATCH ou UPDATE, mas nunca DELETE.
- Dado uma venda cancelada com motivo e sim, quando a dona consulta o histórico, então a venda aparece cancelada, não ausente.
- Dado uma confirmação pendente, quando a resposta não é um sim inequívoco ou o prazo expirou, então o endpoint de escrita não é chamado.
- Dado a mesma mensagem de gravação já confirmada entregue de novo, quando o sistema a recebe, então não nasce um segundo registro.
- Dado um número sem cadastro ativo de dona, quando chega uma mensagem, então não há leitura nem escrita da loja.
- Dado o fim da entrega, quando uma pessoa abre o roteiro de prompts, então cada capacidade deste PRD tem ao menos uma linha e o roteiro foi executável contra WhatsApp, banco e web.

## Roteiro de verificação manual

Arquivo: `docs/qa/buddy-roteiro-de-prompts.md`.

O roteiro é enumerado. Cada capacidade vira uma ou mais linhas numa tabela:

| #   | Capacidade | Endpoint (método e caminho) | Prompt | Resposta esperada do Buddy | Conferir no banco | Conferir na web |
| --- | ---------- | --------------------------- | ------ | -------------------------- | ----------------- | --------------- |

Regras do roteiro:

- O prompt é a mensagem enviada ao Buddy no WhatsApp.
- A resposta esperada descreve o comportamento observável: pedir dado faltante, pedir confirmação, informar recusa ou comunicar o retorno. Não exige frase idêntica.
- Depois do sim, a linha diz o que deve existir, mudar ou continuar igual no banco e na tela.
- Há linhas para dado faltante, confirmação, consulta de período, ticket médio, ranking, histórico, edição, cancelamento e recusa de exclusão.
- Consulta confere o número da frase com o número da web no mesmo período.
- O roteiro não substitui os testes automatizados escritos antes do código.

## Stack e restrições técnicas decididas

- O canal desta entrega é o WhatsApp já integrado. A identidade continua o celular da dona.
- As ações novas e as já existentes da operação diária passam a ser tools criadas com a API oficial de tools do Mastra. A tool chama o endpoint HTTP correspondente e o modelo redige a resposta a partir do corpo devolvido.
- Não se cria tool cujo efeito seja apagar registro.
- O núcleo que o endpoint já chama continua sendo quem valida e calcula. O modelo não soma venda, não calcula ticket médio e não escolhe imposto.
- TDD é obrigatório nesta entrega: teste automatizado falhando antes do código de produção de cada comportamento.
- O roteiro em `docs/qa/buddy-roteiro-de-prompts.md` faz parte do aceite e é escrito ao final, com as tabelas acima.

# Se algo nessa Feature estiver diferente dos docs do projeto, essa feature SOBREESCREVE os docs. Portanto, esse documento tem maior procedência no projeto.
