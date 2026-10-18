# Data Model: Resposta natural no WhatsApp

**Date**: 2026-10-01  
**Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

Não há tabela nova, coluna nova nem migration. A sequência e o turno vivem na memória do processo da API. A caixa `webhook_events` continua sendo a única persistência desta borda.

## Mensagem recebida

Já existe no inbound do adapter. Esta fatia só acrescenta o uso do id.

| Campo               | Papel                                                             |
| ------------------- | ----------------------------------------------------------------- |
| `providerMessageId` | Marcar lida esta mensagem. Dedup na sequência. Chave do envio     |
| `from`              | Destino da resposta e metade da chave da sequência, com a empresa |
| `text`              | Fragmento. `null` ou só espaços não entra na sequência            |
| `receivedAt`        | Ordem e `inboundAt` do consentimento `service_reply`              |

O estado “lida” não é coluna nossa. É o POST de status no provedor, feito na chegada, antes da pausa.

## Sequência em espera

Valor em memória, um por `companyId` + `from`. Some quando vira turno ou quando o processo cai.

| Campo      | Regra                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Chave      | Empresa do vínculo e o `from` daquela conversa. Duas lojas não compartilham fila                |
| Fragmentos | Textos com conteúdo, na ordem de chegada, sem repetir `providerMessageId`                       |
| Prazo      | 3 s após o `receivedAt` do último fragmento. Texto novo zera o prazo                            |
| Próxima    | Se já existe turno em curso para a mesma chave, os textos novos formam outra sequência, à parte |
| Ids        | Cada id será marcado processado na caixa só quando o turno dessa sequência terminar             |

Transições:

1. Ociosa → em espera: primeiro texto com conteúdo.
2. Em espera → em espera: outro texto antes do prazo; o prazo reinicia.
3. Em espera → em curso: o prazo vence e não há turno em curso na mesma chave.
4. Em curso → ociosa: envio concluído ou frase de falha enviada; ids marcados processados.
5. Texto durante em curso → próxima sequência (estado 1 ou 2 dessa outra), sem alterar o texto que já está saindo.

Reentrega do mesmo id enquanto a sequência está em espera ou em curso não acrescenta fragmento e não chama o assistente de novo. O handler só espera o fim do mesmo turno.

## Turno de resposta

Valor calculado, não persistido. Sai de um único `processMessage` sobre os fragmentos unidos por quebra de linha.

| Campo     | Regra                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------- |
| Partes    | 1 a 5 textos, depois da formatação e da divisão descritas no [contrato](./contracts/resposta-whatsapp.md) |
| Ordem     | A parte _n_ só é enviada depois da parte _n−1_                                                            |
| Chave     | `{idDoPrimeiroFragmento}:{índice}`, índice a partir de 1                                                  |
| Digitando | Antes da parte 1 (quando a preparação começa) e antes de cada parte seguinte, no id do último fragmento   |
| Intervalo | 800 ms com digitando entre partes. A parte 1 não espera 800 ms além do tempo do assistente                |
| Falha     | Uma parte extra, a frase curta, no índice seguinte. Sem segunda chamada ao assistente                     |

## Sinal de presença

Não é entidade armazenada. É efeito no chat.

| Sinal     | Quando                                                | Não acontece                                         |
| --------- | ----------------------------------------------------- | ---------------------------------------------------- |
| Lido      | Na chegada de cada texto da dona vinculada            | Número sem vínculo; falha do POST não segura o turno |
| Digitando | Ao começar a preparar, e antes de cada parte seguinte | Durante a pausa de 3 s; no chat do aplicativo        |

## O que não muda

| Fato                   | Onde continua                               |
| ---------------------- | ------------------------------------------- |
| Quem pode falar        | `abrirCanal` / ADR-0012                     |
| Idempotência do aviso  | `webhook_events` (`provider = meta`)        |
| Memória do assistente  | Um turno por chamada, texto já unido        |
| Confirmação e dinheiro | `processMessage` e o núcleo, sem regra nova |
| Foto e mídia           | `text: null`; frase fixa; fora da sequência |
