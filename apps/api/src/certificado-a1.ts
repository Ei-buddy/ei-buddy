import { X509Certificate } from 'node:crypto'
import { createSecureContext } from 'node:tls'
import { AppError } from '@na-regua/core'

/**
 * Conferir o certificado A1 antes de guardar — NR-214.
 *
 * Achado do QA ("testar o envio de um certificado digital"): a api guardava o
 * .pfx sem abri-lo. Senha errada, arquivo que nao era certificado e
 * certificado vencido eram aceitos com "Certificado enviado" — e o lojista so
 * descobria quando a primeira nota fosse recusada. A validade era DIGITADA,
 * e um erro de digitacao fazia o aviso de vencimento (RF-004) mentir.
 *
 * ## Como abre, sem biblioteca nova
 *
 * `tls.createSecureContext({ pfx, passphrase })` e o mesmo caminho que o Node
 * usa para servir HTTPS com um .pfx: confere o MAC (a senha) e decifra a
 * chave e o certificado. Depois, o certificado sai em DER e o
 * `X509Certificate` le a validade.
 *
 * ## O formato antigo
 *
 * Muitos A1 brasileiros vem cifrados com RC2-40, que o OpenSSL 3 desligou.
 * Neles o MAC ainda e conferido — senha errada continua dando "mac verify
 * failure" —, mas a decifragem para em "Unsupported PKCS12 PFX data". Nesse
 * caso a senha esta certa e so a validade nao e lida: vale a data digitada.
 * Ligar o provedor legado do OpenSSL no processo resolveria, mas mudaria a
 * criptografia disponivel para a api inteira; nao e decisao para caber aqui.
 */

export type LeituraDoCertificado =
  | { readonly situacao: 'lido'; readonly venceEm: Date }
  /** O MAC nao bateu: a senha nao e a deste arquivo. */
  | { readonly situacao: 'senha_errada' }
  /** A senha confere, mas o formato (RC2 antigo) nao deixa ler a validade. */
  | { readonly situacao: 'sem_leitura' }
  | { readonly situacao: 'nao_e_certificado' }

export function lerCertificadoA1(arquivo: Uint8Array, senha: string): LeituraDoCertificado {
  let contexto: ReturnType<typeof createSecureContext>
  try {
    contexto = createSecureContext({ pfx: Buffer.from(arquivo), passphrase: senha })
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro)
    const codigo = (erro as { code?: unknown }).code
    if (/mac verify failure/i.test(mensagem)) return { situacao: 'senha_errada' }
    if (codigo === 'ERR_CRYPTO_UNSUPPORTED_OPERATION' || /unsupported/i.test(mensagem)) {
      return { situacao: 'sem_leitura' }
    }
    return { situacao: 'nao_e_certificado' }
  }

  /* `context.getCertificate()` nao e API documentada. Se um Node futuro a
     tirar, a senha ja foi conferida acima: cai na data digitada, sem quebrar. */
  const nativo = contexto.context as { getCertificate?: () => Buffer | null | undefined }
  const der = typeof nativo.getCertificate === 'function' ? nativo.getCertificate() : undefined
  if (der === null || der === undefined || der.length === 0) return { situacao: 'sem_leitura' }

  try {
    return { situacao: 'lido', venceEm: new Date(new X509Certificate(der).validTo) }
  } catch {
    return { situacao: 'sem_leitura' }
  }
}

/** `AAAA-MM-DD` do instante no fuso da loja. */
function diaNoFuso(instante: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante)
}

const paraTela = (dia: string) => dia.split('-').reverse().join('/')

/**
 * A validade que sera guardada — ou o motivo de recusar o envio.
 *
 * - senha errada ou arquivo que nao e certificado: recusa, apontando o campo;
 * - lido: a validade do ARQUIVO vale, mesmo que outra tenha sido digitada; e
 *   certificado ja vencido e recusado (nao emite nota nenhuma);
 * - sem leitura: vale a digitada, e sem ela nao ha como avisar o vencimento.
 */
export function validadeConferida(
  leitura: LeituraDoCertificado,
  digitada: string | undefined,
  agora: Date,
  timeZone: string,
): string {
  switch (leitura.situacao) {
    case 'senha_errada':
      throw AppError.validation('A senha não abre este certificado. Confira e envie de novo.', [
        { path: 'certificatePassword', message: 'Senha não confere com o certificado.' },
      ])
    case 'nao_e_certificado':
      throw AppError.validation(
        'Este arquivo não é um certificado A1. Envie o .pfx (ou .p12) que veio da certificadora.',
        [{ path: 'certificateBase64', message: 'Arquivo não é um certificado A1.' }],
      )
    case 'lido': {
      const vence = diaNoFuso(leitura.venceEm, timeZone)
      if (vence < diaNoFuso(agora, timeZone)) {
        throw AppError.validation(
          `Este certificado venceu em ${paraTela(vence)}. Envie o certificado renovado.`,
          [{ path: 'certificateBase64', message: 'Certificado vencido.' }],
        )
      }
      return vence
    }
    case 'sem_leitura':
      if (digitada === undefined) {
        throw AppError.validation(
          'Não deu para ler a validade deste certificado. Informe até quando ele vale.',
          [{ path: 'certificateExpiresAt', message: 'Informe a validade.' }],
        )
      }
      return digitada
  }
}
