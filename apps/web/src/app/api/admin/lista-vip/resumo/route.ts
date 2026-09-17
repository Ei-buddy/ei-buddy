import { encaminhar } from '@/lib/bff'

/** Painel do Super Admin: agregados da lista de espera — NR-111. */
export async function GET() {
  return encaminhar('/admin/lista-vip/resumo')
}
