import { encaminhar } from '@/lib/bff'

/** A fila casada, na ordem do extrato — DEC-026. */
export async function GET() {
  return encaminhar('/conciliacao/automatica')
}
