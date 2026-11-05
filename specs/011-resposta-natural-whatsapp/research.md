# Research: Resposta natural no WhatsApp

**Date**: 2026-10-01  
**Spec**: [spec.md](./spec.md)

Não resta `NEEDS CLARIFICATION`. As escolhas abaixo fecham o Technical Context.

## 1. Onde a pausa vive

**Decision**: um sequenciador em memória no processo da API, chaveado por `companyId` + número de quem enviou (`from` já normalizado pelo adapter). A rota HTTP continua devolvendo 200 só depois do turno daquele texto — inclusive os ~3 s de silêncio e o tempo do assistente. O relógio e o agendamento entram por parâmetro, para o teste não dormir de verdade.

**Rationale**: cada balão da lojista é um POST diferente. Esperar 3 s dentro de um handler, sem estado compartilhado, responde ao primeiro fragmento antes do segundo chegar. Devolver 200 antes de processar tiraria a reentrega da Meta quando o processo morre no meio — a caixa `webhook_events` só reprocessa o que ficou com `processed_at` nulo se o provedor chamar de novo, e ele só chama de novo sem o 200. Segurar a resposta HTTP é o mesmo desenho da NR-046, com 3 s a mais. A Meta já espera o turno de hoje, que inclui o modelo.

**Alternatives considered**:

- Pausa só com `setTimeout` dentro do request, sem estado: rejeitado. O segundo POST não enxerga o primeiro.
- 200 imediato e job atrasado na fila BullMQ, com tabela nova: rejeitado nesta fatia. A janela é de 3 s, o processo já segura o webhook até o fim do turno, e uma tabela com RLS para um buffer efêmero não cabe no recorte. O mapa em memória do `sendText` já documenta o mesmo limite de um processo.
- Duas instâncias da API coordenando pelo banco: rejeitado. Não há réplica no desenho atual, e o remetente Meta já não garante idempotência de envio entre processos.

Limite explícito: dois processos da API podem juntar mal a sequência. Um processo só, como o adapter já assume para o mapa de envio.

## 2. Lido e digitando

**Decision**: dois POST no mesmo URL de mensagens que o `sendText` já usa (`graph.facebook.com/{versão}/{phone-number-id}/messages`), sem o campo `to`.

- Lido, assim que o texto é aceito e a dona está vinculada, antes da pausa: `status: read` e `message_id` daquele balão.
- Digitando, só quando o turno começa a ser preparado, e de novo antes de cada balão seguinte: o mesmo corpo mais `typing_indicator: { type: text }`. O `message_id` é o do último texto da sequência.
- Enquanto o assistente ainda prepara, se passar de 20 s, o mesmo sinal de digitando é reenviado. O indicador da Meta some aos 25 s ou quando uma mensagem nossa sai, o que ocorrer primeiro.
- Os dois sinais são melhor-esforço. Falha, timeout ou id inválido (`131009`) não impedem a resposta e não entram no log com telefone nem corpo.
- Número sem vínculo continua o silêncio da NR-046: sem lido, sem digitando, sem frase. A spec só pede presença na recusa curta se essa recusa existir; ela não existe.

**Rationale**: a Meta marca como lidas também as mensagens anteriores quando uma é marcada, mas a spec pede cada balão lido na hora em que chega — por isso um POST por texto, no instante da chegada. Digitando no meio da pausa faria a lojista parar de completar o pedido; a própria doc da Meta pede indicador só quando a resposta vai sair. O campo `typing_indicator` está na Messages API documentada; não é biblioteca não oficial (ADR-0014).

**Alternatives considered**:

- Um único POST que marca lido e já mostra digitando: rejeitado. Antecipa o “digitando” para a pausa.
- Nova porta em `core`: rejeitado. Presença não é caso de uso de negócio e não vale para cobrança ao cliente. Fica no adapter, ao lado do `sendText`.
- Subir a versão do Graph só por causa do indicador: a chamada usa a constante `VERSAO_PADRAO` já existente (`v21.0`). Se essa versão recusar o campo, a implementação sobe essa constante única. Não nasce um segundo cliente.

## 3. Quem formata e quem divide

**Decision**: duas funções puras em `packages/whatsapp`, chamadas só pelo webhook depois do `processMessage`. O aplicativo, o `POST /agent/messages` e o Studio recebem o texto cru de hoje. As instruções do modelo não mudam.

A função de formato:

- `**negrito**` e título com `#` viram negrito do WhatsApp (`*assim*`).
- Link no formato `[rótulo](url)` vira texto mais o endereço, sem colchetes.
- Linha de tabela (`|`) vira linha com células separadas por “ — ”.
- Item de lista que comece com asterisco passa a começar com `-`, para o asterisco não ligar negrito.
- Par `*rótulo*` bem formado na mesma linha permanece. Asterisco, sublinhado ou til que não fecha um par válido ganha um caractere invisível (U+2060) ao lado, para nome de produto como `Coca*Cola` aparecer literal.

A função de divisão, sobre o texto já formatado:

- Uma ideia só, sem lista e com até 280 caracteres: uma mensagem.
- Frase final `Confirma?` com texto antes dela: essa frase sozinha no último balão.
- Lista com duas ou mais linhas: a frase de abertura (se houver) num balão e os itens, em linhas inteiras, nos seguintes.
- Parágrafo acima de ~400 caracteres: quebra no fim da frase, nunca no meio de `R$` e do valor.
- Teto de cinco balões: se a quebra natural passar disso, funde os trechos adjacentes mais curtos até caber, sem cortar palavra.
- Entre um balão e o outro: sinal de digitando e espera de 800 ms, bem menor que a pausa de 3 s.

**Rationale**: o `formatReply` das tools e o texto livre do modelo servem os dois canais. Pedir “WhatsApp” no prompt não dá os 100% da SC-007 e mudaria o chat do aplicativo. Função pura prova o corte e o negrito sem chamar a Meta e sem depender do modelo.

**Alternatives considered**:

- Instruir o modelo por canal: rejeitado. Flutua, e o app passaria a receber marcação de WhatsApp se o prompt fosse único.
- Alterar cada `formatReply` do catálogo: rejeitado. O mesmo texto alimenta o aplicativo.
- Cortar a cada N caracteres: rejeitado. A spec proíbe cortar valor, nome ou palavra no meio.

## 4. O que entra na sequência

**Decision**: só texto com conteúdo, da dona vinculada. Os fragmentos se unem com quebra de linha, na ordem, cada um com trim. O mesmo `providerMessageId` não entra duas vezes. O `processMessage` é chamado uma vez, com esse texto único, no mesmo `channel: 'whatsapp'` e o mesmo `peer` de hoje.

Texto só com espaços, ou mensagem sem corpo de texto (foto, áudio, figurinha — hoje `text: null`): não entra na sequência, não reinicia a pausa e não espera 3 s. Segue o caminho atual, com lido e digitando em volta da frase fixa que pede texto.

Mensagem que chega depois que o turno já começou vai para a próxima sequência, com a pausa dela contada a partir do último texto dessa próxima, não a partir do primeiro. Se a pausa dela já tiver acabado quando o turno atual terminar, ela começa na hora.

**Rationale**: uma chamada do assistente grava um turno só na memória da conversa. Colar os fragmentos antes disso faz o “sim” da mesma rajada confirmar o pedido certo, e o “sim” de depois da pergunta continuar sendo o turno seguinte. Foto não atrasa texto, como a spec pede, e o adapter ainda não baixa mídia.

**Alternatives considered**:

- Juntar com espaço em vez de quebra de linha: rejeitado. Some a fronteira entre “2 coca” e “fiado pro João”.
- Incluir a foto na mesma sequência: rejeitado. Fora do aceite, e o inbound ainda não traz o arquivo.
- Processar a próxima sequência só com mais 3 s depois do turno atual, mesmo que ela já tenha ficado em silêncio: rejeitado. A spec conta a pausa a partir do último texto dela.

## 5. Idempotência dos vários balões

**Decision**: cada balão da resposta usa `idempotencyKey` `${idDoPrimeiroTextoDaSequência}:${índice}`, consentimento `service_reply` com o `inboundAt` do primeiro texto, e destino igual ao `from`. A frase de falha usa o índice seguinte. A caixa de entrada continua marcando cada id da sequência como processado só depois do envio (ou depois da frase de falha).

**Rationale**: a chave única de hoje é o id da Meta. Dois balões com a mesma chave fariam o mapa do adapter engolir o segundo. O prefixo no primeiro id da sequência é estável numa reentrega que ainda ache o processo vivo.

**Alternatives considered**:

- Uma chave só, corpo concatenado: rejeitado. A spec pede várias mensagens.
- Tabela de ids enviados: rejeitado. O limite de reinício já está escrito no adapter; esta fatia não o aumenta nem o finge resolver.

## 6. Quando não há resposta

**Decision**: se o turno visível vier vazio (`ignored` ou texto em branco) continua sem envio, como hoje. Se o assistente lançar, a lojista recebe uma frase curta — “Não consegui responder agora. Tente de novo em instantes.” — e o digitando acaba porque a mensagem saiu. A sequência é marcada processada para a reentrega não gravar de novo.

**Rationale**: a spec pede aviso em vez de digitando eterno. A Meta tira o indicador quando a mensagem sai. Marcar processado depois do aviso evita um segundo turno da mesma frase, que em pedido de gravação poderia repetir efeito se o erro tivesse sido depois da escrita — o caso comum de falha, porém, é o modelo ou a rede, antes da escrita. O “sim” repetido continua idempotente pelas chaves que o núcleo já tem.

**Alternatives considered**:

- Deixar o indicador expirar aos 25 s sem texto: rejeitado pela FR-004.
- Não marcar processado na falha, para a Meta tentar de novo: rejeitado. A reentrega colidiria com a frase de falha e poderia duplicar o que tivesse sido gravado.
