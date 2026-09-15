import { encaminhar } from '@/lib/bff'

/** Versoes em vigor dos documentos legais — RF-03. */
export async function GET() {
  return encaminhar('/legal/versoes')
}
