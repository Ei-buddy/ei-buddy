# Quickstart: Conversar com o assistente pelo WhatsApp

**Date**: 2026-09-22  
**Spec**: [spec.md](./spec.md) · **Contract**: [contracts/webhook-whatsapp.md](./contracts/webhook-whatsapp.md)

A CI prova a regra e a rota com corpo gravado. O chip de verdade é um passo manual, com segredo só no ambiente local.

## 1. Pré-requisitos

- Branch `feat/NR-046-whatsapp-meta-cloud-api`.
- Postgres de desenvolvimento e `.env` na raiz, como no setup do repositório.
- Para o passo manual: app Meta com o número de exibição **+1 555 155-0338**, URL HTTPS pública apontando para a API (túnel), e o celular da dona cadastrado como destinatário de teste no painel. Sem isso a linha de teste não entrega a resposta.

Variáveis (valores no `.env` local, nunca no git):

| Variável                   | Onde achar                                              |
| -------------------------- | ------------------------------------------------------- |
| `WHATSAPP_PROVIDER`        | `meta` só no aceite manual; `fake` no resto             |
| `WHATSAPP_API_TOKEN`       | token de acesso do painel, não o App Secret             |
| `WHATSAPP_PHONE_NUMBER_ID` | API Setup do número de teste                            |
| `WHATSAPP_WEBHOOK_SECRET`  | App Secret (HMAC). É outro campo, não o token de acesso |
| `WHATSAPP_VERIFY_TOKEN`    | uma string nossa, a mesma cadastrada no webhook do app  |

O id da conta WhatsApp Business não entra em variável.

## 2. Suíte sem rede (obrigatória)

Na raiz:

```bash
pnpm --filter @na-regua/core test
pnpm --filter @na-regua/api test
pnpm --filter @na-regua/whatsapp test
```

O que tem de ficar verde:

| Prova                                                                      | Resultado esperado                                                         |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `554188888888` e `4188888888`                                              | mesma chave canônica `41988888888`; a barragem acha a dona gravada com o 9 |
| `4133334444`                                                               | continua fixo, sem `9` inserido                                            |
| `5599998888`                                                               | não perde o DDD 55                                                         |
| número sem vínculo, usuário inativo, vínculo inativo, papel que não é dona | silêncio: sem contexto, sem texto                                          |
| `GET` com verify token certo                                               | corpo igual ao challenge, texto puro                                       |
| `GET` com token errado                                                     | 403                                                                        |
| `POST` sem HMAC válido                                                     | 401, sem chamada ao assistente                                             |
| `POST` de recibo de entrega                                                | 200, sem assistente                                                        |
| `POST` de texto da dona, corpo gravado, remetente falso                    | uma resposta enviada ao `from` original, consentimento `service_reply`     |
| o mesmo id de mensagem outra vez                                           | nenhuma segunda resposta e nenhuma segunda gravação                        |
| texto vazio da dona                                                        | uma frase pedindo texto, sem turno do modelo                               |
| texto de número desconhecido                                               | 200 e zero envios                                                          |

Nenhum desses testes chama `graph.facebook.com`.

## 3. Aceite no número de teste (manual)

1. Subir a API com `WHATSAPP_PROVIDER=meta` e as cinco variáveis preenchidas.
2. Cadastrar a URL `https://<túnel>/webhooks/whatsapp` no app e assinar o campo de mensagens. O `GET` precisa concluir; se falhar, o verify token ou o túnel está diferente do ambiente.
3. Ter uma dona ativa cujo celular, com ou sem o 9, é o aparelho que vai escrever. Conta restrita pode consultar e não gravar — igual ao aplicativo.
4. Desse aparelho, mandar um texto para **+1 555 155-0338**. Em até 1 minuto a mesma conversa mostra a resposta do assistente.
5. Repetir uma pergunta objetiva que o aplicativo já responde (estoque ou contas). O fato (item, valor, empresa) é o mesmo.
6. De outro celular, sem cadastro, mandar texto. Nada volta que confirme cadastro, saldo ou que o número exista.
7. Trocar o celular da dona no aplicativo e escrever do número antigo. Silêncio. O número novo, se escrever, volta a ser atendido.

Se o envio da resposta for recusado por janela de 24 h, não há modelo para contornar nesta fatia: a dona escreve de novo. Credencial inválida ou túnel fora não conta como sucesso.

## 4. O que não prova este quickstart

- Cobrança ou comprovante para cliente final.
- Foto, áudio e template.
- Escolher a segunda empresa pelo WhatsApp.
