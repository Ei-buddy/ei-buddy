import { encaminhar } from '@/lib/bff'

/** Fila de aprovacao de Parceiro — NR-115, ADR-0013. */
export async function GET() {
  return encaminhar('/admin/parceiros')
}
