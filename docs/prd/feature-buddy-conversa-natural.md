# PRD — Buddy com conversa natural

> Tipo: Feature · Data: 2026-10-06
> Status: Pronto para planejamento

## Visão geral e objetivo

O Buddy já cadastra, vende, consulta e cobra pelo WhatsApp, mas conversa como um sistema. Ele responde com códigos internos e nomes de campo, perde o fio da conversa e não pergunta quando falta informação. No teste manual, “O João quer comprar café” virou “Nao encontrei esse cliente.”. Depois do cadastro do João, “ele quer comprar café” virou uma consulta de estoque com o identificador interno do produto e “Localizacao indisponivel”.

O resultado desta entrega: a dona conversa com o Buddy como conversaria com um atendente que conhece a loja. Ele entende o contexto (“ele”, “esse café”, “a venda de agora”), pergunta quando tem dúvida, assume só o que o sistema já sabe, retoma o pedido depois de um desvio e responde em português comum, sem nada técnico na tela.

## Contexto do projeto

O assistente hoje escolhe uma única ação por mensagem. O resultado dessa ação não volta para o modelo: a resposta é um texto fixo montado pelo sistema. Por isso ele não consegue combinar informações, perceber que um cliente não existe e oferecer o cadastro, nem redigir a resposta a partir do dado consultado. É dessa estrutura que vêm os identificadores internos, os nomes de campo e o tom robotizado.

O PRD [Buddy, assistente no WhatsApp](feature-buddy-whatsapp.md) já previa que o modelo redigisse a frase a partir do retorno. A implementação seguiu outro caminho.

Restrições do projeto que continuam valendo:

- O histórico da conversa fica nas tabelas da própria aplicação, isolado por empresa, com as últimas 12 mensagens e corte por 2 horas de inatividade. O Memory e o Storage do Mastra não são usados.
- A confirmação de gravação é controlada pelo sistema, sobre a tabela de confirmações, e não pela aprovação nativa do Mastra.
- O núcleo da aplicação valida e calcula. O modelo não soma valores, não calcula ticket médio, imposto ou margem.

O assistente atende três canais com o mesmo laço: WhatsApp, chat do aplicativo e o Studio usado pela engenharia.

## Decisões do produto

- **O Buddy raciocina em mais de uma etapa.** Numa mesma mensagem, ele pode consultar o cliente, consultar o produto e só então responder ou propor uma ação. As consultas rodam durante o raciocínio, e o modelo redige a resposta a partir do resultado real. Isso resolve a causa do comportamento “burro”: hoje o modelo nunca vê o que consultou.
- **Gravar continua dependendo do aceite da dona.** As ações de gravação não gravam durante o raciocínio: elas registram uma proposta. A gravação só acontece depois que a dona aceita, e é feita pelo sistema, com os dados da proposta.
- **O modelo escreve a mensagem de confirmação com as próprias palavras.** A frase não é conferida contra os dados da proposta. Trade-off aceito: a frase pode descrever algo diferente do que será gravado. A proteção é o aceite da dona, a trava descrita abaixo e a possibilidade de cancelar ou estornar depois. A mensagem enviada depois do aceite é redigida a partir do que de fato foi gravado.
- **O modelo interpreta a resposta à confirmação, com uma trava do sistema.** Concordância pura (“sim”, “fechou”, “isso aí”, “manda ver”) é aceite. Recusa cancela a proposta. Uma resposta que traga dado novo (número, valor, nome, forma de pagamento) ou ressalva (“mas”, “né?”, “acho que”) nunca é aceite: vira correção, e o Buddy apresenta uma nova proposta. A trava é a única barreira do sistema entre o que o modelo entende e o que vai para o banco.
- **O Buddy lembra o contexto da conversa.** Além das últimas 12 mensagens, ele recebe um resumo oculto das entidades da conversa: clientes, produtos e vendas citados ou resolvidos, a proposta pendente e a intenção em andamento. Esse resumo vem das tabelas da aplicação, nunca é exibido e zera junto com o corte de 2 horas de inatividade.
- **Nada técnico aparece para a dona.** Identificadores internos, nomes de campo, códigos de ferramenta e valores em centavos não aparecem em nenhuma resposta. O resultado das consultas chega ao modelo já em linguagem de loja (valores em reais, rótulos em português). O modelo é instruído a não exibir termos técnicos. Uma verificação final barra qualquer resposta que ainda contenha esses termos: o modelo reescreve uma vez e, se persistir, o trecho é removido antes do envio.
- **O tom é próximo e direto.** Português do Brasil coloquial, tratando por “você” e pelo primeiro nome da dona quando natural. A maioria das respostas tem até 3 linhas. Lista só quando há mais de 3 itens. No máximo 1 emoji por mensagem, e só quando cabe. O Buddy não explica como funciona por dentro e só cumprimenta quando a dona cumprimenta.
- **O Buddy pergunta quando falta dado, e assume só o que o sistema sabe.** Na venda, ele usa o preço de tabela do produto e quantidade 1 quando a dona não diz. A forma de pagamento é sempre perguntada. Tudo o que falta é perguntado numa única mensagem, nunca uma pergunta por vez. Tudo o que foi assumido aparece na confirmação, para a dona corrigir.
- **Cliente ou produto inexistente não encerra o pedido.** Cliente não encontrado: o Buddy oferece cadastrar (só o nome basta) ou registrar sem cliente, exceto no fiado. Produto não encontrado: oferece cadastrar, pedindo os dados obrigatórios. Depois do cadastro aceito, ele retoma o pedido original de onde parou, sem a dona repetir.
- **Uma proposta de gravação por vez.** Num pedido com duas gravações, como “cadastra o João e vende 2 cafés pra ele”, o Buddy propõe a primeira e, depois do aceite, segue para a segunda.
- **Fora do escopo, recusas e erros também são redigidos pelo modelo, a partir de fatos.** Pedido que o Buddy não faz: ele diz isso com naturalidade e dá até 3 exemplos do que pode fazer, em palavras comuns. As recusas existentes (certificado, extrato e conciliação, nota avulsa, apagar conta bancária ou contato) continuam, com a regra vinda do sistema e as palavras do modelo. Erro de regra de negócio é explicado com a mensagem do núcleo, sem nome de campo, e nunca como sucesso. Falha inesperada (modelo ou banco indisponível) recebe uma frase fixa, porque pode não haver modelo para redigir.
- **O modelo padrão é o `openai/gpt-5.4-mini`, configurável.** A troca de modelo só acontece com base no resultado da avaliação de conversas.
- **No máximo 5 etapas de raciocínio por mensagem.** Ao atingir o limite, o Buddy diz o que entendeu até ali e pergunta como seguir. O indicador de “digitando” continua sendo renovado enquanto ele processa.
- **Não há limite de uso de IA para o assinante.** O teto mensal por empresa continua configurável, como exige a constitution (RNF-073), mas vem desligado por padrão: sem teto configurado, ninguém é bloqueado nem recebe aviso de limite. O uso de IA continua sendo medido por empresa e por etapa, só para acompanhamento interno.
- **A foto não é tratada nesta entrega.** O fluxo atual de foto do código de barras é retirado, e uma foto recebe a mesma frase usada para outras mídias, pedindo o pedido por texto. Regressão aceita: a foto deixa de funcionar até ser refeita sobre a estrutura desta entrega.
- **Um único laço atende todos os canais.** WhatsApp, chat do aplicativo e Studio passam a usar o mesmo comportamento. A estrutura anterior de uma ação por mensagem é removida. Só a formatação de saída muda por canal.

### Relação com o PRD anterior

Este PRD prevalece sobre o [Buddy, assistente no WhatsApp](feature-buddy-whatsapp.md) onde os dois conflitam. Ficam substituídas as regras sobre:

- confirmação explícita como “sim inequívoco” (passa a valer a interpretação pelo modelo com a trava acima);
- texto da confirmação e das respostas montados pelo sistema;
- tratamento da foto do código de barras;
- limite mensal de uso de IA por empresa (passa a vir desligado por padrão);
- modelo inicial `gpt-4o-mini`.

Continuam valendo do PRD anterior: a lista de capacidades de consulta e de gravação, a regra de nunca apagar registro do banco (só marcar como deletado), o cancelamento de venda que mantém a venda no histórico, a edição de um registro por vez, o perfil de consulta que não grava, o isolamento por empresa e por celular da dona, e a idempotência de mensagens reentregues.

## Histórias de usuário

- Como dona, quero falar com o Buddy do jeito que falo com uma pessoa, para não ter de aprender comandos.
- Como dona, quero que o Buddy entenda “ele” e “esse café” pelo que acabamos de conversar, para não repetir o nome a cada mensagem.
- Como dona, quero que o Buddy me pergunte o que falta numa só mensagem, para fechar a venda rápido no balcão.
- Como dona, quero que, se o cliente não estiver cadastrado, o Buddy ofereça cadastrar e depois continue a venda, para não recomeçar o pedido.
- Como dona, quero responder “fechou” ou “isso aí” para confirmar, e “não, são 3” para corrigir, para conversar sem fórmulas.
- Como dona, quero respostas curtas, em português comum e sem códigos, para ler de relance entre um atendimento e outro.
- Como dona, quero que o Buddy diga o que não sabe fazer e o que pode fazer, para não ficar sem resposta.

## Regras de negócio e dados

### Contexto da conversa

- O contexto ativo é formado pelas últimas 12 mensagens da conversa vigente mais o resumo oculto de entidades.
- O resumo de entidades guarda, para a conversa, os clientes, produtos e vendas citados ou resolvidos (com o identificador interno, que nunca é exibido), a proposta de gravação pendente e a intenção em andamento (por exemplo, uma venda interrompida por um cadastro).
- Após 2 horas sem mensagem, o histórico ativo e o resumo de entidades deixam de valer para ações novas. Uma referência como “ele” passa a ser perguntada de novo.
- A conversa é identificada por empresa, canal e celular (ou sessão, no aplicativo). Uma conversa nunca enxerga entidades de outra empresa.

### Proposta e aceite

- Existe no máximo uma proposta de gravação pendente por conversa.
- A proposta guarda os dados exatos que serão gravados. A gravação usa esses dados, e não a frase da confirmação.
- A proposta expira em 5 minutos. Depois disso, nenhuma resposta grava.
- Resposta à proposta:
  - concordância pura: aceite, e o sistema grava;
  - recusa: a proposta é cancelada e nada é gravado;
  - resposta com dado novo ou ressalva: correção. A proposta atual é cancelada, e o Buddy apresenta uma nova proposta com o dado corrigido;
  - assunto diferente: a proposta é cancelada e a mensagem é tratada como pedido novo.
- Perfil sem permissão de escrita nunca grava, mesmo com aceite.
- A mesma mensagem entregue de novo não gera uma segunda gravação.

### Venda

- Itens, quantidades, valores e forma de pagamento são necessários para propor a venda.
- Preço não informado: usa o preço de tabela do produto. Quantidade não informada: 1.
- Forma de pagamento não informada: sempre perguntada.
- Fiado exige cliente cadastrado.
- Mais de um cliente ou produto compatível com o que foi dito: o Buddy lista as opções por nome e pergunta qual, sem escolher sozinho.

### Cadastro durante outro pedido

- Cliente novo exige só o nome. A regra de cadastro parecido (telefone ou documento repetido) continua valendo.
- Produto novo exige descrição, unidade, custo e preço de venda. Preço de venda menor que o custo é recusado.
- O cadastro é uma proposta como qualquer outra e depende de aceite.
- Depois do cadastro aceito, a intenção em andamento é retomada: o Buddy pergunta o que ainda falta ou apresenta a proposta.

### Apresentação

- Nenhuma resposta contém identificador interno, código de produto interno, nome de campo, nome de ferramenta, valor em centavos ou mensagem técnica de validação.
- Valores aparecem em reais, no formato brasileiro.
- Pagamentos aparecem como dinheiro, pix, débito, crédito ou fiado.

### Limites e uso

- No máximo 5 etapas de raciocínio por mensagem.
- O teto de uso de IA por empresa é configurável e vem desligado; sem teto, não há bloqueio.
- O uso de IA é registrado por empresa e por etapa, sem aparecer na conversa.
- Metas medidas na avaliação: resposta de consulta em até 5 segundos e resposta de ação com confirmação em até 8 segundos.

## Fluxos

### Venda para cliente não cadastrado

1. A dona escreve “O João quer comprar café”.
2. O Buddy procura o João e não encontra. Responde algo como: “Não achei o João por aqui. Cadastro ele, ou registro a venda sem cliente?”.
3. A dona responde “cadastra”. O Buddy propõe o cadastro do João.
4. A dona aceita. O cliente é cadastrado.
5. O Buddy retoma a venda sem a dona repetir: encontra o café, usa o preço de tabela e quantidade 1 e pergunta a forma de pagamento.
6. A dona responde “pix”. O Buddy propõe a venda de 1 café no pix para o João.
7. A dona aceita. A venda é gravada, e o Buddy confirma com os dados que de fato foram gravados.

### Referência a algo da conversa

1. Depois de falar do João, a dona escreve “ele quer comprar 2 cafés”.
2. O Buddy entende que “ele” é o João, pelo resumo de entidades, e segue com a venda, sem consultar estoque e sem pedir o nome de novo.
3. Se a conversa ficou parada por mais de 2 horas, o Buddy pergunta de quem se trata.

### Correção durante a confirmação

1. O Buddy propõe a venda de 1 café no pix.
2. A dona responde “não, são 3”.
3. O Buddy não grava. Apresenta uma nova proposta com 3 cafés.
4. A dona responde “fechou”. A venda é gravada com 3 cafés.

### Pedido incompleto

1. A dona escreve “adicione café”.
2. O Buddy pergunta, numa única mensagem, o que é obrigatório (descrição, unidade, custo e preço de venda) e o que é opcional.
3. Com os dados, ele propõe o cadastro. Só grava depois do aceite.

### Consulta

1. A dona pergunta “quanto tem de café?”.
2. O Buddy consulta e responde com o nome do produto, a quantidade e o preço, em linguagem comum, sem código interno e sem campos vazios como “localização indisponível”.

### Pedido fora do escopo ou recusado

1. A dona pede algo que o Buddy não faz, ou algo que é recusado por regra (como importar extrato).
2. O Buddy diz, em uma ou duas frases, que não faz isso por aqui e, quando couber, onde fazer ou o que ele pode fazer no lugar.
3. Nada é gravado.

### Falha

1. Uma gravação é recusada pelo núcleo (por exemplo, preço de venda menor que o custo). O Buddy explica o motivo em linguagem comum e diz o que ajustar. Não afirma que gravou.
2. O modelo ou o banco ficam indisponíveis. A dona recebe uma frase fixa pedindo para tentar de novo em instantes.

### Limite de etapas atingido

1. Um pedido exige mais de 5 etapas de raciocínio.
2. O Buddy diz o que entendeu até ali e pergunta como seguir. Nada é gravado sem proposta e aceite.

## Critérios de aceite

- Dado “O João quer comprar café” e nenhum João cadastrado, quando o Buddy responde, então ele oferece cadastrar o João ou registrar sem cliente, e não encerra o pedido.
- Dado o cadastro do João aceito durante uma venda, quando o cadastro conclui, então o Buddy retoma a venda sem a dona repetir o pedido.
- Dado um cliente citado na conversa ativa, quando a dona se refere a ele por “ele”, então o Buddy usa esse cliente sem pedir o nome.
- Dado mais de 2 horas sem mensagem, quando a dona usa “ele”, então o Buddy pergunta de quem se trata.
- Dado um pedido de venda sem forma de pagamento, quando o Buddy responde, então ele pergunta a forma de pagamento e não propõe a venda.
- Dado um pedido de venda sem preço nem quantidade, quando o Buddy propõe, então a proposta usa o preço de tabela e quantidade 1, e os dois aparecem na confirmação.
- Dado mais de um dado faltando, quando o Buddy pergunta, então todos aparecem numa única mensagem.
- Dado uma proposta pendente, quando a dona responde com concordância pura, então a gravação acontece com os dados da proposta.
- Dado uma proposta pendente, quando a resposta contém número, valor, nome, forma de pagamento ou ressalva, então nada é gravado e o Buddy apresenta uma nova proposta.
- Dado uma proposta pendente, quando a dona recusa ou o prazo de 5 minutos passa, então nada é gravado.
- Dado qualquer resposta do Buddy, em qualquer canal, quando ela é enviada, então não contém identificador interno, nome de campo, nome de ferramenta, valor em centavos nem mensagem técnica de validação.
- Dado uma consulta de estoque, quando o Buddy responde, então a resposta traz nome, quantidade e preço em reais, sem código interno.
- Dado um pedido fora do escopo, quando o Buddy responde, então ele diz que não faz isso e dá até 3 exemplos do que pode fazer, sem nome de ferramenta.
- Dado uma gravação recusada pelo núcleo, quando o Buddy responde, então ele explica o motivo em linguagem comum e não afirma que gravou.
- Dado o modelo indisponível, quando chega uma mensagem, então a dona recebe a frase fixa de falha e nada é gravado.
- Dado um pedido que exigiria mais de 5 etapas, quando o limite é atingido, então o Buddy diz o que entendeu e pergunta como seguir.
- Dado um pedido com duas gravações, quando o Buddy responde, então ele propõe uma de cada vez.
- Dado uma foto enviada, quando o Buddy responde, então ele pede o pedido por texto.
- Dado uma empresa com uso alto de IA e nenhum teto configurado, quando a dona manda mensagem, então o Buddy responde normalmente, sem aviso de limite.
- Dado o mesmo pedido no WhatsApp, no chat do aplicativo e no Studio, quando o Buddy responde, então o comportamento é o mesmo nos três canais.
- Dado o conjunto de conversas de avaliação, quando ele roda contra o modelo configurado antes de uma liberação, então os critérios de tom, perguntas, retomada e ausência de termo técnico são atendidos.

## Stack e restrições técnicas decididas

- **Mastra continua sendo o runtime do agente**, agora com raciocínio em várias etapas (limitado a 5 por mensagem) e com verificação final da resposta antes do envio. As consultas executam dentro do laço com o contexto da empresa e do usuário. As gravações só registram proposta.
- **Modelo padrão `openai/gpt-5.4-mini`**, definido por configuração (`AGENT_MODEL`). A troca de modelo não exige nova decisão de arquitetura, só o resultado da avaliação.
- **Histórico, resumo de entidades, propostas e uso de IA ficam nas tabelas da aplicação**, isoladas por empresa. Memory, Storage e aprovação nativa do Mastra continuam desligados.
- **A estrutura anterior é removida, não adaptada:** o laço de uma ação por mensagem, os textos fixos de resposta e de confirmação, o fluxo de foto e o dublê de testes antigo. O teto mensal de IA permanece, desligado por padrão.
- **Testes em duas camadas.** Na integração contínua, testes determinísticos com o modelo dublê do próprio Mastra rodando o laço real, escritos antes do código (TDD), cobrindo a trava do aceite, a verificação de termos técnicos, o resumo de entidades, o isolamento por empresa, a idempotência e a regra de que nada grava sem aceite. Antes de cada liberação e a cada troca de modelo, um conjunto de conversas de várias mensagens roda contra o modelo real. Ele bloqueia a liberação, mas não a integração contínua.
- **O roteiro manual de prompts** passa a ser a base do conjunto de conversas de avaliação, com uma linha por fluxo deste PRD.
