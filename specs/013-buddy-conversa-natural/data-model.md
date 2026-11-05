# Data Model: Buddy com conversa natural

Nenhuma tabela ou coluna nova. Tudo usa o que já existe com `company_id` e RLS
(`conversations`, `messages`, `confirmations`) e as portas de
`packages/core/src/ports/conversations.ts` e `confirmations.ts`. O que muda é
o **conteúdo** de dois campos jsonb/text e o estado em memória de uma
mensagem.

---

## Conversa (`conversations`, inalterada)

| Campo             | Uso nesta fatia                                                        |
| ----------------- | ---------------------------------------------------------------------- |
| `company_id`      | Isolamento (RLS). Vem do `ExecutionContext`, nunca do modelo           |
| chave da conversa | `wa:{companyId}:{peer}` no WhatsApp, `app:{companyId}:{userId}` no app |
| última mensagem   | Base do corte de 2 h (`loadActive` → `idle`)                           |

---

## Mensagem (`messages`, inalterada no schema)

| Campo        | Uso nesta fatia                                                       |
| ------------ | --------------------------------------------------------------------- |
| `role`       | `user` ou `assistant`                                                 |
| `body`       | Texto visível, já limpo de termos técnicos. Vai ao modelo na janela   |
| `tool_calls` | **Snapshot de turno v2** (abaixo). Nunca vai ao modelo como texto cru |

Janela ativa: até 12 mensagens; vazia se `idle`. Expurgo de 30 dias inalterado.

### Snapshot de turno (`tool_calls`, v2)

Gravado em cada turno do Buddy. Substitui o formato atual
(`{ customerId?, saleId?, productId? }`), que o leitor trata como v1 e
converte.

```text
SnapshotDeTurno {
  v: 2
  entidades: EntidadeDaConversa[]   // tocadas neste turno
  intencao?: IntencaoEmAndamento    // ausente = nenhuma intenção aberta
  propostaId?: string               // proposta criada neste turno
}

EntidadeDaConversa {
  tipo: 'cliente' | 'produto' | 'venda' | 'conta_a_pagar' | 'recebivel' | 'compromisso'
  ref: string        // id interno; nunca exibido
  rotulo: string     // nome legível ("João", "café em grãos", "venda nº 1042")
}

IntencaoEmAndamento {
  acao: id da tool de gravação (ex.: 'create_sale')
  jaDito: objeto parcial com os dados já informados ou assumidos
  aguardando: 'cadastro_cliente' | 'cadastro_produto' | 'dados' | 'escolha'
  descricao: string  // em português, para o modelo ("venda de café para o João")
}
```

**Validação**: snapshot inválido ou de versão desconhecida é ignorado na
montagem do resumo (não derruba a conversa). `rotulo` nunca é vazio.

---

## Resumo de entidades da conversa (derivado, não persistido)

Montado por `montarResumoDeEntidades(janela)` a cada mensagem:

- **entidades**: união das `entidades` dos snapshots da janela, deduplicadas por
  `tipo + ref`, a mais recente vence no `rotulo`;
- **intencao**: a `intencao` do snapshot mais recente que a tenha. Um snapshot
  mais recente sem `intencao` encerra a anterior;
- vai ao modelo como mensagem de sistema, em português, com `ref` marcado como
  uso interno.

Regras: janela vazia (`idle`) → resumo vazio (FR-025). Nenhuma entidade de
outra empresa pode aparecer, porque a janela já vem filtrada por RLS (FR-026).

---

## Proposta de gravação (`confirmations`, inalterada no schema)

| Campo       | Conteúdo nesta fatia                                                         |
| ----------- | ---------------------------------------------------------------------------- |
| `toolId`    | Id da tool de gravação proposta                                              |
| `args`      | Entrada **já validada** pelo schema de `contracts` e com refs resolvidas     |
| `summary`   | Fatos humanizados da proposta, em português, para o modelo (não para a dona) |
| `expiresAt` | `now + 5 min`                                                                |
| decisão     | `accepted` / `rejected` / `expired`; aberta = pendente                       |

### Transições

```text
            create_* / update_* / ... (proposta)
                         │
                         ▼
                    ┌─────────┐
     put() de outra │ PENDENTE │ cancel_proposal / mudança de assunto
     proposta ─────►│         │───────────────────────► rejected
     (correção)     └────┬────┘
        rejected         │ accept_proposal
                         ▼
               ┌──────────────────────┐
               │ trava determinística │
               └──┬─────────┬────────┬┘
       vencida    │ ressalva│ ok      │
                  ▼         ▼        ▼
              expired   (pendente)  accepted → caso de uso de core
                        nao_e_aceite        (idempotencyKey = confirmation:{id})
```

- “Mudança de assunto” é decidida pelo modelo: se ele responde sem chamar
  `accept_proposal` e sem nova proposta, `processMessage` resolve a pendente
  como `rejected` ao fim da mensagem (FR-017).
- Perfil sem escrita: `core` recusa no caso de uso (`assertCanWrite`), a tool
  devolve `recusado` (FR-021).

---

## Estado da mensagem em processamento (memória, por chamada)

Passado ao `Agent` por `RequestContext` (não vai ao prompt):

| Chave         | Origem                                       | Uso                                        |
| ------------- | -------------------------------------------- | ------------------------------------------ |
| `execucao`    | `ExecutionContext` resolvido por peer/sessão | Toda tool chama `core` com ele             |
| `textoDaDona` | Mensagem atual, já juntada pela rajada       | Trava de `accept_proposal`                 |
| `resumo`      | Resumo de entidades                          | Resolver referência por nome               |
| `pendente`    | `ConfirmationStore.getOpen`                  | `accept_proposal` / `cancel_proposal`      |
| `coletor`     | Acumulador do turno                          | Entidades, intenção e proposta do snapshot |

---

## Uso de IA (`AiUsageCounter`, inalterado no formato)

- Registra `result.steps.length` por mensagem, por empresa e mês.
- Teto `AGENT_MONTHLY_BUDGET_CENTS` opcional; ausente = sem bloqueio.
