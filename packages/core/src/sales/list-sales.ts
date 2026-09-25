import type { SaleHistoryInput, SaleHistoryOutput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import type { SaleHistoryRepository } from '../ports/sale-history.js'

export type ListSalesDeps = {
  readonly history: SaleHistoryRepository
}

/**
 * O historico de vendas — NR-027, US-021.
 *
 * Leitura, sem `assertCanWrite`: `accountant` precisa ver as vendas para
 * conferir faturamento, e exigir papel de escrita o deixaria de fora.
 *
 * `core` nao filtra nem ordena. Filtrar em memoria exigiria trazer o historico
 * inteiro — que so cresce — para devolver vinte linhas, e o total que faz a
 * tela dizer "20 de 340" nao existe sem contar no banco.
 */
export async function listSales(
  deps: ListSalesDeps,
  ctx: ExecutionContext,
  input: SaleHistoryInput,
): Promise<SaleHistoryOutput> {
  const { vendas, total, resumo } = await deps.history.list(ctx.companyId, {
    ...(input.from === undefined ? {} : { from: input.from }),
    ...(input.to === undefined ? {} : { to: input.to }),
    ...(input.q === undefined || input.q === '' ? {} : { termo: input.q }),
    ...(input.customerId === undefined ? {} : { customerId: input.customerId }),
    offset: (input.page - 1) * input.pageSize,
    limite: input.pageSize,
  })

  /* Copia rasa nao basta: `items` e `payments` tambem sao `readonly` na porta,
     e o contrato de saida e mutavel. A conversao acontece aqui, na borda, e nao
     obriga o repositorio a devolver algo que qualquer um pode alterar. */
  return {
    sales: vendas.map((v) => ({ ...v, items: [...v.items], payments: [...v.payments] })),
    total,
    page: input.page,
    pageSize: input.pageSize,
    summary: {
      ...resumo,
      /* `netCents` JA vem sem imposto e sem tarifa: o dominio calcula o liquido
         como bruto - imposto - tarifa. Subtrair a tarifa aqui de novo contava
         a maquininha duas vezes. O campo fica pelo contrato. */
      netAfterFeesCents: resumo.netCents,
      /*
       * Nulo, e nao zero, quando nao houve venda. "Ticket medio R$ 0,00" diria
       * que houve venda de valor nenhum; o travessao diz que nao houve venda.
       */
      averageTicketCents:
        /* Pelo BRUTO: ticket medio e quanto o cliente gasta por compra, e nao
           o que sobra depois do imposto. */
        resumo.salesCount === 0 ? null : Math.round(resumo.grossCents / resumo.salesCount),
    },
  }
}

/**
 * Uma venda inteira — US-021.
 *
 * 404 e nao lista vazia: aqui e acesso a RECURSO, e "esta venda nao existe" e
 * diferente de "esta busca nao achou nada". Venda de outra empresa cai no mesmo
 * 404, e nao num 403 — responder 403 confirmaria que a venda existe em algum
 * lugar, e o numero e sequencial por empresa.
 */
export async function getSale(
  deps: ListSalesDeps,
  ctx: ExecutionContext,
  saleId: string,
): Promise<SaleHistoryOutput['sales'][number]> {
  const venda = await deps.history.findById(ctx.companyId, saleId)

  if (venda === undefined) {
    throw AppError.notFound('Venda nao encontrada.')
  }

  return { ...venda, items: [...venda.items], payments: [...venda.payments] }
}
