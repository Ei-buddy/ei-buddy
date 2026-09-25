import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

/**
 * Busca de endereco por CEP — NR-072.
 *
 * Passa pelo BFF e nao direto do navegador para o provedor: a decisao esta
 * escrita por extenso no topo de `lib/empresa-api.ts` — chave e cota do lado
 * do servidor, cache possivel, troca de fornecedor sem tocar no front.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/enderecos/cep/[cep]'>) {
  const { cep } = await ctx.params

  return encaminhar(`/enderecos/cep/${encodeURIComponent(cep)}`)
}
