import { adjustStockInputSchema } from '@na-regua/contracts'
import {
  adjustStock,
  type AdjustStockDeps,
  checkStock,
  type CheckStockDeps,
  suggestRestock,
  type SuggestRestockDeps,
} from '@na-regua/core'
import type { InventoryMovementOutput } from '@na-regua/contracts'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'

/**
 * Saldo, ajuste e trilha de estoque — NR-023, RF-022, RF-023, RF-124.
 *
 * Estas rotas faltavam. `core` tinha `checkStock` e `adjustStock` desde a
 * NR-023, com teste contra falso, e `db` ganhou a implementacao agora — mas sem
 * rota nenhuma o lojista nao tinha por onde ajustar o inventario. O caso de uso
 * existia no repositorio e nao no produto.
 *
 * A verificacao de papel fica em `core` (`assertCanWrite`), e nao aqui: senao o
 * canal WhatsApp (NR-060) chamaria o mesmo ajuste sem ela, e a mesma operacao
 * teria duas regras.
 */

export type EstoqueDeps = CheckStockDeps &
  AdjustStockDeps &
  SuggestRestockDeps & {
    /**
     * A trilha do produto. Fora das portas de `core` de proposito: e leitura de
     * apresentacao, e nenhum caso de uso depende dela.
     */
    readonly historico: {
      byProduct(
        companyId: string,
        productId: string,
        limite: number,
      ): Promise<readonly InventoryMovementOutput[]>
    }
  }

/** Quantos movimentos a tela mostra sem pedir mais. */
export const MOVIMENTOS_POR_PAGINA = 50

export function registerEstoqueRoutes(app: FastifyInstance, deps: EstoqueDeps): void {
  /**
   * O que precisa repor — achado do QA: a pergunta do assistente so olhava o
   * estoque minimo. A regra e a da venda (media de seis meses menos o
   * estoque), e o minimo e o negativo continuam valendo. Ver `suggestRestock`.
   */
  app.get('/estoque/reposicao', async (request, reply) => {
    const ctx = requireContext(request)
    return reply.code(200).send(await suggestRestock(deps, ctx))
  })

  /**
   * O saldo de um produto — RF-022.
   *
   * `stockQuantity` nulo NAO e zero: nulo e "este produto nao tem controle de
   * estoque", zero e "acabou". A tela distingue os dois, e por isso a rota nao
   * achata um no outro.
   */
  app.get('/produtos/:id/estoque', async (request, reply) => {
    const ctx = requireContext(request)
    const { id } = request.params as { id: string }

    const saldo = await checkStock(deps, ctx, { productId: id })

    return reply.code(200).send(saldo)
  })

  /**
   * Ajuste de inventario — RF-023.
   *
   * O corpo traz a contagem ABSOLUTA e o motivo. Absoluta porque o lojista
   * contou dezoito, entao sao dezoito: pedir um delta obrigaria a tela a
   * calcular a diferenca contra um saldo que pode ter mudado entre a leitura e
   * o envio, e o ajuste corrigiria para o numero errado.
   *
   * O motivo e obrigatorio no contrato. Ajuste sem motivo vira um numero que
   * mudou sozinho, e daqui a tres meses ninguem reconstroi por que o saldo caiu
   * — que e a unica coisa que se quer da trilha.
   */
  app.post(
    '/produtos/:id/estoque',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }

      /*
       * O `productId` vem do CAMINHO, e o do corpo e ignorado.
       *
       * Aceitar os dois abriria a porta para eles discordarem — e o ajuste
       * cairia num produto diferente do que a tela mostrava. Um endereco, um
       * recurso.
       */
      const input = validate(adjustStockInputSchema, {
        ...(request.body as Record<string, unknown>),
        productId: id,
      })

      const movimento = await adjustStock(deps, ctx, input)

      /* 201: o ajuste CRIOU uma linha na trilha. Nao e um PATCH do saldo — o
         saldo e consequencia, e o movimento e o fato (RF-124). */
      return reply.code(201).send(movimento)
    },
  )

  /** A trilha do produto, da mais recente para tras — RF-124. */
  app.get('/produtos/:id/movimentos', async (request, reply) => {
    const ctx = requireContext(request)
    const { id } = request.params as { id: string }

    const movimentos = await deps.historico.byProduct(ctx.companyId, id, MOVIMENTOS_POR_PAGINA)

    return reply.code(200).send({ movements: movimentos })
  })
}
