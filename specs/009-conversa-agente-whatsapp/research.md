# Research: NR-046

**Date**: 2026-09-22  
**Spec**: [spec.md](./spec.md)

## 1. O que já está pronto e o que esta fatia liga

**Decision**: não reescrever o adapter nem a barragem. Ligar `GET`/`POST /webhooks/whatsapp` ao `criarRemetenteMeta` / `responderVerificacao` que já existem, e ao `abrirCanal` + `processMessage` que já existem.

**Rationale**: `packages/whatsapp/src/meta-sender.ts` já envia texto, confere HMAC no corpo bruto, ignora recibo de entrega e faz o handshake. `channel_owner_by_phone` já exige `users.is_active`, `company_users.is_active` e `role = owner`, e devolve a primeira empresa por ordem de vínculo. O ledger ainda marca NR-113 como parcial e NR-046 como não feita porque ninguém chama isso a partir de um POST da Meta: `buildAgentUseCases` instancia só `createFakeMessageSender`, e o runtime só recebe peers de fixture do Studio.

**Alternatives considered**:

- Implementar de novo o cliente da Cloud API na rota: rejeitado; a porta e os testes de contrato já cobrem o formato.
- Tratar "ativo" com uma coluna nova: rejeitado; `is_active` no usuário e no vínculo já é a regra, e o SQL já filtra.

## 2. Nono dígito

**Decision**: a equivalência mora em `normalizarTelefoneDoCanal` (`packages/core`), não no adapter e não no SQL. Depois de tirar máscara e um DDI `55` só quando o número tem 12 dígitos ou mais, um móvel nacional de 10 dígitos cujo assinante começa com 6, 7, 8 ou 9 ganha um `9` depois do DDD. A consulta tenta primeiro a forma com 9 e, se não achar, a de 10 dígitos. Fixo (assinante começando em 2–5) não muda. `5599998888` não perde o DDD 55.

**Rationale**: a Meta manda `554188888888` (12 dígitos) e o cadastro guarda `41988888888`. O corte do `55` que já existe produz `4188888888`, e `channel_owner_by_phone` compara igualdade exata — hoje a dona cai no silêncio. O `phoneSchema` aceita 10 ou 11 dígitos, então as duas formas podem estar gravadas; por isso a segunda chave. Preferir a de 11 dígitos casa com o exemplo da spec (o banco tem o 9). A regra fica num lugar só: a porta do diretório recebe o telefone já normalizado por quem chama.

**Alternatives considered**:

- Inserir o 9 dentro do SQL: rejeitado; duplicaria a regra e o comentário da função exige igualdade exata.
- Migrar todo `users.phone` para 11 dígitos: rejeitado nesta fatia; a segunda chave cobre o legado sem reescrever cadastro.
- Tratar qualquer 10 dígitos como móvel: rejeitado; transformaria fixo em outro número.

## 3. Onde corre o turno

**Decision**: no processo da API, síncrono, no mesmo pedido do webhook. Sem fila nova. O worker `whatsapp-send` não participa da resposta à dona.

**Rationale**: o runtime do agente já vive na API. O worker não tem `processMessage`. Uma fila inbound obrigaria a subir o agente num segundo processo para um único número de teste. A Meta aceita a resposta do webhook na ordem de segundos; o teto da spec é 1 minuto. O padrão do webhook do Asaas (corpo bruto, 200 rápido, 401 se a assinatura falha) se repete aqui, com o turno ainda dentro do pedido porque o trabalho é a própria resposta.

**Alternatives considered**:

- Fila BullMQ `whatsapp-inbound`: rejeitada nesta fatia; mais operação, e o worker não hospeda o agente.
- Responder 200 e processar depois sem fila: rejeitado; o processo pode morrer e a dona fica sem resposta sem registro.

## 4. Reentrega sem gravar duas vezes

**Decision**: depois que `abrirCanal` autoriza, registrar em `webhook_events` com `provider = meta` e `event_id` igual ao id da mensagem na Meta, antes de `processMessage`. `registrar` falso → 200 sem segundo turno. Número sem vínculo não grava linha. O `payload` guarda só o id e o tipo (`text` ou vazio), sem o texto e sem o telefone inteiro.

**Rationale**: a tabela e a porta `WebhookInbox` já deduplicam `(provider, event_id)` com `ON CONFLICT DO NOTHING`. Gravar antes do turno evita venda ou título duplicado se a Meta reentregar. Não gravar no silêncio evita encher a caixa com sondagem e evita empresa inventada. O texto da conversa, quando a pessoa é autorizada, já segue para o store de conversa; copiá-lo de novo no inbox aumentaria dado pessoal sem ajudar a dedup.

**Alternatives considered**:

- Deduplicar só na memória: rejeitado; duas instâncias ou um restart perdem o controle.
- Exigir `company_id` no corpo: rejeitado; a Meta não manda a empresa, e a constitution proíbe aceitar `companyId` do cliente.

**Risco aceito**: se o processo cair depois do `registrar` e antes do `marcarProcessado`, a reentrega vê repetido e não responde. É o mesmo recorte do webhook de pagamento. Pior do que uma resposta perdida seria aplicar o turno duas vezes.

## 5. Destino da resposta e consentimento

**Decision**: `sendText` para o `from` original da Meta, com `consent.basis = service_reply` e `inboundAt` no instante da mensagem recebida. Não usar o celular canônico como destino.

**Rationale**: o identificador do WhatsApp pode ser o número sem o 9. Responder para a forma do cadastro pode não ser o mesmo destino que acabou de escrever. `service_reply` é a base já prevista para resposta a quem iniciou a conversa; a dona não é cliente final de marketing. RF-015/RF-016 (cobrança e opt-out de cliente) permanecem fora, e o stub de consentimento dentro de `sendCustomerCharge` não muda.

**Alternatives considered**:

- Enviar ao número canônico de 11 dígitos: rejeitado pelo risco de não entregar no chip que escreveu.
- Incluir modelo aprovado para fora da janela de 24 h: rejeitado pela spec. Quem acabou de escrever está dentro da janela. Se o envio mesmo assim voltar `outside_service_window`, registra-se a recusa e não há retentativa infinita; não se cria template nesta fatia.

## 6. Credenciais da linha de teste

**Decision**: cinco variáveis, todas opcionais no schema para a API subir sem elas. Com `WHATSAPP_PROVIDER=meta`, as quatro de segredo/id precisam existir ou a rota responde 503. Valores nunca vão para o repositório.

| Variável                   | Papel                                                                   |
| -------------------------- | ----------------------------------------------------------------------- |
| `WHATSAPP_PROVIDER`        | `fake` (padrão, CI e local) ou `meta` (aceite no chip)                  |
| `WHATSAPP_API_TOKEN`       | Bearer de envio. Não confere o webhook                                  |
| `WHATSAPP_PHONE_NUMBER_ID` | Id Graph do número de exibição +1 555 155-0338                          |
| `WHATSAPP_WEBHOOK_SECRET`  | App Secret do HMAC `X-Hub-Signature-256`. É outro segredo, não o Bearer |
| `WHATSAPP_VERIFY_TOKEN`    | String que nós escolhemos e cadastramos no painel, para o `GET`         |

O id da conta WhatsApp Business não é lido pelo adapter atual. A versão do Graph continua a já fixada no adapter (`v21.0`); só se troca se o aceite manual for recusado por versão.

**Rationale**: o adapter já recusa webhook quando o segredo de HMAC falta, em vez de aceitar corpo sem conferir. O handshake `GET` é outra cerimônia e já tem `responderVerificacao`, mas a variável ainda não está no `env`. O token colado em conversa não é documentação.

**Alternatives considered**:

- Uma variável só com o token de acesso, e pular o HMAC em desenvolvimento: rejeitado (RNF-028).
- Gravar o Phone Number ID no código: rejeitado; é configuração de ambiente, como as outras chaves de provedor.

## 7. Texto vazio e o que não é texto

**Decision**: mensagem autorizada sem texto recebe uma frase fixa pedindo texto, sem chamar o modelo. Mensagem não autorizada, com ou sem texto, não recebe nada. Foto, áudio e figurinha não são baixados; caem no mesmo pedido de texto se a pessoa for a dona, e no silêncio se não for.

**Rationale**: a spec pede texto como aceite e proíbe revelar cadastro. Chamar o modelo com corpo vazio gasta teto de IA (RNF-073) sem pedido. O adapter já devolve `media: null` de propósito.

**Alternatives considered**:

- Responder "não entendi" também a número desconhecido: rejeitado; confirma que o canal existe e ajuda sondagem (RF-095).
- Baixar mídia da Meta nesta fatia: rejeitado pela spec.
