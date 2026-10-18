# Contract: Resposta em balões no WhatsApp

**Date**: 2026-10-01  
**Spec**: [../spec.md](../spec.md) · **Data model**: [../data-model.md](../data-model.md)

O que a dona recebe depois que a sequência fecha. O `processMessage` não muda de contrato: entra um texto, sai um `AgentReply`. Quem parte e formata é a borda do WhatsApp.

## União dos fragmentos

| Entrada                                                         | Pedido ao assistente                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------- |
| `lança uma venda` + `2 coca` + `fiado pro João` dentro da pausa | Um texto, três linhas, nessa ordem                               |
| O mesmo id entregue de novo                                     | A linha não duplica                                              |
| Só espaços, ou sem corpo de texto                               | Não entra neste contrato; ver [presença](./presenca-whatsapp.md) |
| Texto depois do assistente já ter sido chamado                  | Outro pedido, depois que as partes atuais terminarem             |

A pausa é de 3 s após o último fragmento. Cada fragmento novo com conteúdo reinicia os 3 s.

## Envio

`sendText` existente, um por parte, em ordem, esperando o resultado da anterior.

| Campo            | Valor                                                   |
| ---------------- | ------------------------------------------------------- |
| `to`             | O `from` do inbound, não o celular canônico do cadastro |
| `consent`        | `service_reply`, `inboundAt` do primeiro fragmento      |
| `idempotencyKey` | `{idDoPrimeiroFragmento}:{índice}` com índice 1, 2, …   |
| `companyId`      | O do vínculo, nunca o corpo do webhook                  |

Partes visíveis são as mesmas de hoje: `answer`, `clarify`, `unknown`, `confirmation`, com texto não vazio. `ignored` ou texto em branco: nenhum `sendText`.

Se a preparação lançar: um `sendText` com a frase “Não consegui responder agora. Tente de novo em instantes.”, no índice seguinte ao que teria sido a primeira parte, e sem nova chamada ao assistente. Os ids da sequência são marcados processados.

Falha do `sendText` (exceção ou `rejected`) não dispara outro turno. O id permanece não processado só se a rota cair antes de marcar — a reentrega da Meta continua sendo a recuperação, como hoje.

## Formatação

Aplicada a cada parte, antes do envio. Não altera dado de negócio, só a grafia.

| Entrada                           | Saída                                       |
| --------------------------------- | ------------------------------------------- |
| `**Total**` ou `__Total__`        | `*Total*`                                   |
| Linha `# Título`                  | `*Título*`                                  |
| `[boleto](https://exemplo)`       | `boleto (https://exemplo)`                  |
| Linha com `\|`                    | Células na mesma linha, separadas por `—`   |
| Linha que começa com `* `         | Linha que começa com `- `                   |
| `*já em negrito*`                 | Permanece                                   |
| `Coca*Cola` ou `_grande_` sem par | O marcador aparece literal (U+2060 ao lado) |
| ` ```código``` `                  | Permanece monoespaçado do WhatsApp          |

Nenhuma parte sai com `#` de título, com `**` ou com link `[rótulo](url)`.

## Divisão

Sobre o texto já formatado. Limites naturais apenas: fim de frase, linha de lista ou parágrafo separado por linha em branco. Não cortar no meio de palavra nem entre `R$` e o valor.

| Texto                                                               | Partes                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Uma ideia, sem lista, até 280 caracteres                            | 1                                                                        |
| Frase final `Confirma?` e há texto antes                            | O texto nas regras abaixo, e `Confirma?` sozinha na última               |
| Frase de abertura e duas ou mais linhas de lista (`-` ou numeradas) | A abertura em uma parte; os itens em linhas inteiras nas seguintes       |
| Só uma lista com duas ou mais linhas                                | Pelo menos duas partes, quebradas entre linhas                           |
| Parágrafo acima de ~400 caracteres                                  | Quebra no fim da frase                                                   |
| A quebra natural produziria mais de 5                               | Funde partes adjacentes até 5, sem reintroduzir corte no meio da palavra |

Uma resposta curta que já é só `Alguma coisa. Confirma?` em uma frase, sem texto anterior separado, continua em uma mensagem: não há o que isolar.

O intervalo entre a parte enviada e a seguinte é 800 ms, com o sinal de digitando antes da seguinte. Não há intervalo de 800 ms antes da primeira parte.

## O que a rota não faz

- Não muda confirmação, teto de IA, isolamento nem idempotência de venda.
- Não formata a resposta do `POST /agent/messages`.
- Não espera 3 s por foto, áudio ou figurinha.
