import { encaminhar } from '@/lib/bff'

/** Nome, e-mail e celular de quem esta logado — NR-153. */
export async function GET() {
  return encaminhar('/auth/conta')
}
