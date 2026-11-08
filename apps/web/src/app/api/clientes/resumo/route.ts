import { encaminhar } from '@/lib/bff'

/** Os numeros do topo da tela de clientes, sobre a loja inteira — NR-211. */
export async function GET() {
  return encaminhar('/clientes/resumo')
}
