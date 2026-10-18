# Quickstart: Resposta natural no WhatsApp

**Date**: 2026-10-01  
**Spec**: [spec.md](./spec.md) · **Contracts**: [presença](./contracts/presenca-whatsapp.md) · [resposta](./contracts/resposta-whatsapp.md)

A CI prova a pausa, a presença, a formatação e a divisão com relógio falso e remetente falso. O chip é um passo manual. Segredo não entra no git nem no log.

## 1. Pré-requisitos

- O webhook da [NR-046](../009-conversa-agente-whatsapp/quickstart.md) já responde texto na linha de teste.
- Postgres de desenvolvimento e `.env` na raiz.
- Para o passo manual: `WHATSAPP_PROVIDER=meta` e as variáveis da NR-046. Nenhuma variável nova.

## 2. Suíte sem rede (obrigatória)

Na raiz:

```bash
pnpm --filter @na-regua/whatsapp test
pnpm --filter @na-regua/api test
```

O que tem de ficar verde:

| Prova                                                                                | Resultado esperado                                                                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Dois textos do mesmo `from` e da mesma empresa, com 1 s entre eles, relógio injetado | Um `processMessage`. O texto tem as duas linhas, nessa ordem. Dois POST de lido antes de qualquer envio. Nenhum digitando antes do fim dos 3 s |
| O segundo texto só depois de 3 s, com o primeiro turno já iniciado                   | Dois `processMessage`, em sequência, sem misturar o corpo                                                                                      |
| O mesmo `providerMessageId` reentregue enquanto a pausa corre                        | Uma linha só no pedido, um turno só                                                                                                            |
| Texto que chega com o turno já em curso                                              | Não altera as partes que já estão saindo; vira o pedido seguinte                                                                               |
| Resposta `2 vendas. Bruto R$ 10,00.`                                                 | Um `sendText`                                                                                                                                  |
| Resposta com abertura e duas linhas `- item`                                         | Pelo menos dois `sendText`, itens inteiros, negrito só onde a formatação manda, no máximo cinco                                                |
| Texto que termina com explicação e `Confirma?`                                       | A última mensagem é só `Confirma?`                                                                                                             |
| `Coca*Cola` e `**Total**`                                                            | O nome aparece literal; `Total` sai como `*Total*`                                                                                             |
| `# título`, `**negrito**`, tabela e `[rótulo](url)`                                  | Nenhum desses formatos crus no corpo enviado                                                                                                   |
| `processMessage` rejeita                                                             | Uma frase curta de falha, sem segundo turno; digitando não fica como única saída                                                               |
| POST de lido ou digitando falha                                                      | O `sendText` da resposta ainda acontece                                                                                                        |
| Número sem vínculo                                                                   | Sem lido, sem digitando, sem envio                                                                                                             |
| `text` nulo                                                                          | Sem espera de 3 s; frase fixa pedindo texto; sequência de texto em paralelo não é reiniciada                                                   |
| `POST /agent/messages` com o mesmo texto longo                                       | Uma resposta só, sem divisão e sem marcação obrigatória de WhatsApp                                                                            |

Não há chamada a `graph.facebook.com` nessa suíte.

## 3. Aceite no celular (manual)

Com a dona ativa escrevendo para a linha de teste:

1. Mandar um texto e ver o status passar a lido antes da resposta.
2. Mandar “lança uma venda”, “2 coca” e “fiado pro João” em menos de 3 s. A resposta trata os três. Não chega uma confirmação só do primeiro balão.
3. Esperar a pergunta `Confirma?` chegar sozinha no último balão, se a resposta pedir confirmação.
4. Num resumo com lista, ver mais de uma mensagem, itens em linhas, e negrito no valor ou no rótulo — sem `#` nem asterisco duplo.
5. Mandar outro texto enquanto os balões ainda estão saindo. Esse texto é respondido depois, inteiro, sem entrar no meio do turno atual.

Foto continua pedindo texto, como hoje, e não segura os textos que estejam na pausa.
