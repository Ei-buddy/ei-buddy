import {
  LOCAL_REJECTION_CODES,
  serviceInvoiceRequestSchema,
  type ServiceInvoiceResult,
} from '@na-regua/contracts'
import { type EmissorNfsen, referenciaDaNfsen } from './focusnfe-nfsen.js'

/**
 * Emissor FALSO de NFS-e nacional — `FISCAL_PROVIDER=fake`. NR-240.
 *
 * Imita o que importa da Focus: o pedido volta "processando", e a nota so
 * aparece autorizada na consulta seguinte. Assim o caminho assincrono (o
 * worker que consulta de novo, a tela que mostra "processando") e exercitado
 * em desenvolvimento, e nao so em homologacao.
 *
 * Valida com o mesmo schema do emissor real, e recusa a descricao com
 * "REJEITAR" — o jeito de provar a tela de rejeicao sem um provedor.
 */
export function criarEmissorNfsenFalso(): EmissorNfsen & {
  /** Quantas notas foram pedidas, para o teste conferir que nao duplicou. */
  readonly enviadas: () => number
} {
  type Nota = { readonly resultado: ServiceInvoiceResult; consultas: number }
  const notas = new Map<string, Nota>()
  let enviadas = 0
  let numero = 0

  const chave = (companyId: string, ref: string) => `${companyId}:${ref}`

  function autorizada(ref: string): ServiceInvoiceResult {
    numero += 1
    const digitos = String(numero).padStart(50, '0')
    return {
      status: 'authorized',
      number: String(numero),
      accessKey: digitos,
      verificationCode: 'FAKE',
      danfseUrl: `https://nfse.invalid/danfse/${ref}.pdf`,
      publicUrl: `https://nfse.invalid/consulta?chave=${digitos}`,
      xmlPath: `/fake/${ref}-nfse.xml`,
      issuedAt: new Date().toISOString(),
    }
  }

  return {
    enviadas: () => enviadas,

    async issue(request) {
      const validado = serviceInvoiceRequestSchema.safeParse(request)
      if (!validado.success) {
        return {
          status: 'rejected',
          rejection: {
            code: LOCAL_REJECTION_CODES.validation,
            message: validado.error.issues[0]?.message ?? 'Dados da NFS-e invalidos.',
          },
        }
      }
      const pedido = validado.data
      const ref = referenciaDaNfsen(pedido.saleId)
      const existente = notas.get(chave(pedido.companyId, ref))
      if (existente !== undefined && existente.resultado.status !== 'rejected') {
        return existente.resultado
      }

      enviadas += 1
      const resultado: ServiceInvoiceResult = pedido.service.description.includes('REJEITAR')
        ? {
            status: 'rejected',
            rejection: { code: 'E0000', message: 'Rejeicao simulada pelo emissor falso.' },
          }
        : { status: 'processing' }
      notas.set(chave(pedido.companyId, ref), { resultado, consultas: 0 })
      return resultado
    },

    async consult(request) {
      const ref = referenciaDaNfsen(request.saleId)
      const k = chave(request.companyId, ref)
      const nota = notas.get(k)
      if (nota === undefined) return undefined
      if (nota.resultado.status !== 'processing') return nota.resultado

      const pronta = autorizada(ref)
      notas.set(k, { resultado: pronta, consultas: nota.consultas + 1 })
      return pronta
    },

    async cancel(request) {
      const ref = referenciaDaNfsen(request.saleId)
      const k = chave(request.companyId, ref)
      const nota = notas.get(k)
      if (nota === undefined || nota.resultado.status !== 'authorized') {
        return {
          status: 'rejected',
          rejection: {
            code: LOCAL_REJECTION_CODES.notFound,
            message: 'Nenhuma NFS-e autorizada para cancelar.',
          },
        }
      }
      notas.set(k, {
        resultado: {
          status: 'cancelled',
          number: nota.resultado.number,
          ...(nota.resultado.accessKey === undefined
            ? {}
            : { accessKey: nota.resultado.accessKey }),
        },
        consultas: nota.consultas,
      })
      return { status: 'cancelled' }
    },
  }
}
