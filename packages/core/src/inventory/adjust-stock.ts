import type { AdjustStockInput, InventoryMovementOutput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { InventoryUnitOfWork } from '../ports/inventory-writers.js'

export type AdjustStockDeps = {
  readonly uow: InventoryUnitOfWork
  /**
   * Obrigatoria, e nao opcional — RF-123.
   *
   * Ajuste de inventario e o caso que US-061 descreve palavra por palavra:
   * "saber quem fez o que para resolver divergencia com meu funcionario". Uma
   * dependencia opcional aqui seria a trilha que some justamente quando quem
   * montou o grafo esqueceu dela.
   */
  /*
   * Sem `audit` aqui desde a NR-087.
   *
   * A auditoria deste caso de uso acontece DENTRO da transacao, por
   * `tx.record` — ver `TransactionalAuditTrail`. Manter a trilha nas
   * dependencias faria todo construtor montar uma que ninguem usa, e o proximo
   * leitor suporia que o caso de uso audita por ali.
   */
}

/**
 * Ajuste de inventario com autoria, motivo e data — RF-023.
 *
 * O saldo passa a ser o CONTADO e a diferenca vira uma linha na trilha. As duas
 * coisas na mesma transacao: saldo mudado sem movimento e a trilha mentindo, e
 * a trilha e o unico jeito de reconstruir por que o numero caiu.
 *
 * A verificacao de papel vive aqui, e nao no handler HTTP — senao o canal
 * WhatsApp (NR-060) nao a aplicaria e o mesmo ajuste teria duas regras.
 */
export async function adjustStock(
  deps: AdjustStockDeps,
  ctx: ExecutionContext,
  input: AdjustStockInput,
): Promise<InventoryMovementOutput> {
  assertCanWrite(ctx)

  return deps.uow.transaction(ctx.companyId, async (tx) => {
    /* Dentro da transacao: entre ler o saldo e grava-lo cabe outra venda. */
    const produto = await tx.products.findById(ctx.companyId, input.productId)

    if (produto === undefined) {
      throw AppError.notFound('Produto não encontrado.')
    }

    /*
     * Produto sem controle de estoque nao se ajusta — nao ha saldo para
     * corrigir. Recusar com mensagem propria, e nao tratar `null` como zero:
     * tratar como zero gravaria um saldo em algo que por decisao nao tem
     * saldo, e o produto passaria a ser contado sem ninguem ter pedido.
     */
    if (produto.stockQuantity === null) {
      throw AppError.conflict(
        'Este produto não tem controle de estoque, então não há saldo para ajustar.',
      )
    }

    const delta = input.countedQuantity - produto.stockQuantity

    /*
     * Contagem igual ao saldo nao e erro — e a conferencia que deu certo. Mas
     * tambem nao e movimento: gravar delta zero encheria a trilha de linhas que
     * nao mudam nada, e a trilha existe para explicar mudanca.
     *
     * Recusar com CONFLICT, e nao devolver silenciosamente, porque quem chamou
     * espera um movimento de volta — devolver um movimento inventado seria pior
     * que dizer que nao houve.
     */
    if (delta === 0) {
      throw AppError.conflict('A contagem confere com o saldo atual. Nada a ajustar.')
    }

    await tx.setStock(input.productId, input.countedQuantity)

    /* Dentro da transacao: saldo mudado sem trilha e a trilha mentindo. Se a
       gravacao falhar, o rollback leva o saldo junto. */
    await tx.record({
      companyId: ctx.companyId,
      entity: 'Product',
      entityId: input.productId,
      action: 'updated',
      actorId: ctx.userId,
      channel: ctx.channel,
      occurredAt: ctx.now,
      before: { stockQuantity: produto.stockQuantity },
      after: { stockQuantity: input.countedQuantity },
    })

    return tx.insertMovement({
      companyId: ctx.companyId,
      productId: input.productId,
      kind: 'adjustment',
      quantityDelta: delta,
      balanceAfter: input.countedQuantity,
      reason: input.reason,
      /* Ajuste nao nasce de venda. */
      saleId: null,
      createdBy: ctx.userId,
      createdAt: ctx.now,
    })
  })
}
