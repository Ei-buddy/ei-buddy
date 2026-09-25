import {
  lookupAddressByCep,
  lookupCompanyByCnpj,
  type LookupCepDeps,
  type LookupCnpjDeps,
} from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'

/**
 * As consultas que preenchem formulario: CEP e CNPJ — NR-072.
 *
 * `apps/web/src/lib/empresa-api.ts` ja documentava as duas rotas, com a
 * decisao escrita por extenso: a consulta passa pelo NOSSO backend e nao do
 * navegador direto para o provedor, porque assim a chave e a cota ficam do
 * lado do servidor, da para cachear, e trocar de fornecedor nao toca no front.
 * A rota nunca existiu — o front devolvia sempre a mesma empresa de exemplo
 * ("Mercearia Sol Nascente LTDA") e tres CEPs de Curitiba.
 *
 * ## Por que exigem sessao
 *
 * Nao ha nada de confidencial no resultado: os dois provedores sao publicos.
 * O que `requireContext` protege e a NOSSA cota — sem ele, as duas rotas viram
 * um proxy aberto para a BrasilAPI que qualquer um pode consumir ate derrubar
 * a consulta de quem esta cadastrando de verdade.
 *
 * ## Por que `LIMITE_DE_ESCRITA` numa rota de leitura
 *
 * O limite aqui nao mede risco de gravar nada — mede chamada a terceiro. Cento
 * e vinte por minuto e folgado para quem preenche um formulario (a tela dispara
 * uma por CEP digitado) e apertado para um laco que varre faixas de CEP.
 */

export type ConsultasDeps = LookupCepDeps & LookupCnpjDeps

export function registerConsultasRoutes(app: FastifyInstance, deps: ConsultasDeps): void {
  app.get(
    '/enderecos/cep/:cep',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      requireContext(request)
      const { cep } = request.params as { cep: string }

      return reply.code(200).send(await lookupAddressByCep(deps, cep))
    },
  )

  app.get(
    '/empresas/cnpj/:cnpj',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      requireContext(request)
      const { cnpj } = request.params as { cnpj: string }

      return reply.code(200).send(await lookupCompanyByCnpj(deps, cnpj))
    },
  )
}
