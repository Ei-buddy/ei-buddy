# Data Model: Operação diária do Buddy no WhatsApp

**Feature**: 012-buddy-operacao-whatsapp  
**Date**: 2026-10-06  
**Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

Esta fatia **não** cria tabelas novas. Reusa o domínio 0909 e os casos de uso
já ligados à tela. Abaixo: entidades relevantes, regras e transições que a
conversa dispara.

## Entities

### Customer (cliente)

| Campo relevante     | Uso na conversa                               |
| ------------------- | --------------------------------------------- |
| `id`, `name`        | Identificação; nome obrigatório no cadastro   |
| `phone`, `document` | Opcionais; duplicata RF-010                   |
| `deleted_at`        | Nulo = vigente; preenchido = marcado deletado |

**Relations**: vendas, recebíveis, saldo em carteira, contatos.

**Validation**:

- Create: nome obrigatório (spec; core já aceita nome sem telefone).
- Update: só campos pedidos; demais permanecem.
- Soft-delete: bloqueado se saldo em carteira > 0 (regra atual de
  `deleteCustomer`).

**Transitions**:

```text
vigente (deleted_at null)
  --[mark_customer_deleted + sim]--> deletado (deleted_at set)
  --[restore via app, fora desta fatia]--> vigente
```

### Product (produto)

| Campo relevante                        | Uso na conversa                  |
| -------------------------------------- | -------------------------------- |
| `description`, `unit_of_measure`       | Cadastro / edição                |
| `sale_price_cents`, `cost_price_cents` | Cadastro / edição; venda ≥ custo |
| `deleted_at`                           | Soft-delete (writer a construir) |

**Validation**: `updateProductInputSchema` / create — preço de venda ≥ custo
(RF-021). Edição de um produto por vez; sem lote.

**Transitions**: igual ao cliente após `deleteProduct` existir.

### Sale (venda)

| Campo relevante                                      | Uso na conversa  |
| ---------------------------------------------------- | ---------------- |
| status `open` / `settled` / `cancelled` / `returned` | Sem `deleted_at` |
| itens, totais, pagamento                             | Mesmos da tela   |

**Transitions**:

```text
aberta/liquidada
  --[cancel_sale + motivo + sim]--> cancelled (permanece no histórico)
  --[pedido "apagar venda"]--> mesmo caminho (research §3)
```

Pedido de “deletar venda” **não** introduz estado `deleted`.

### Payable / Receivable

Status (`open`, liquidado, `cancelled`, …). Sem soft-delete nesta fatia.
Baixa e lançamento já existem nas tools.

### Appointment

Título, data, hora; criação e agenda do dia já no catálogo.

### Confirmation (pendência)

Proposta aberta com TTL 5 min; aceita / recusada / expirada. Persiste
(NR-061). Mutações novas desta fatia usam o mesmo modelo.

### Ranking / Period report (leitura)

Não são linhas persistidas pela conversa: projeções de
`ReportRepository` / DRE / `listSales` no período pedido.

## Soft-delete vs cancel (mapa)

| Entidade        | Mecanismo                    | Frase ao usuário        |
| --------------- | ---------------------------- | ----------------------- |
| Cliente         | `deleted_at`                 | “deletado”              |
| Produto         | `deleted_at`                 | “deletado”              |
| Venda           | `cancelled`                  | “cancelada” (histórico) |
| Conta / contato | Fora soft-delete desta fatia | Recusa ou orientação    |

## Out of scope for schema

- Nova coluna de soft-delete em `sales`, `payables`, `receivables`,
  `customer_contacts`.
- Tool/SQL `DELETE` físico de negócio.
- Alteração de RLS / `company_id`.
