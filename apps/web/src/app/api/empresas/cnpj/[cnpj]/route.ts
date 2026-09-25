import type { NextRequest } from 'next/server'
import { encaminhar } from '@/lib/bff'

/** Consulta de empresa por CNPJ — NR-072. Mesmo motivo do CEP: nao vai do navegador. */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/empresas/cnpj/[cnpj]'>) {
  const { cnpj } = await ctx.params

  return encaminhar(`/empresas/cnpj/${encodeURIComponent(cnpj)}`)
}
