import { spawn } from 'node:child_process'
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
 * ## O formato antigo — DEC-028
 *
 * Muitos A1 brasileiros vem cifrados com RC2-40, que o OpenSSL 3 desligou.
 * Neles o MAC ainda e conferido — senha errada continua dando "mac verify
 * failure" —, mas a decifragem para em "Unsupported PKCS12 PFX data".
 *
 * A decisao foi ligar o modo legado do OpenSSL **so na rotina que le o
 * certificado**, e nao na api inteira. Por isso a segunda tentativa roda num
 * processo do Node a parte, com `--openssl-legacy-provider`, que nasce para
 * ler este arquivo e morre em seguida: a criptografia do processo da api nao
 * muda. O filho recebe arquivo e senha pela entrada padrao (nunca na linha de
 * comando, que aparece no `ps`) e sobe com o ambiente VAZIO — nenhum segredo
 * da api passa para ele.
 *
 * Se nem o modo legado ler (Node sem o provedor, tempo esgotado), a senha ja
 * foi conferida: vale a data digitada, como antes.
 */

export type LeituraDoCertificado =
  | { readonly situacao: 'lido'; readonly venceEm: Date }
  /** O MAC nao bateu: a senha nao e a deste arquivo. */
  | { readonly situacao: 'senha_errada' }
  /** A senha confere, mas o formato (RC2 antigo) nao deixa ler a validade. */
  | { readonly situacao: 'sem_leitura' }
  | { readonly situacao: 'nao_e_certificado' }

/** Quem le o arquivo no modo legado. Trocavel nos testes. */
export type LeitorLegado = (arquivo: Uint8Array, senha: string) => Promise<Date | null>

export async function lerCertificadoA1(
  arquivo: Uint8Array,
  senha: string,
  lerEmModoLegado: LeitorLegado = lerNoModoLegado,
): Promise<LeituraDoCertificado> {
  const leitura = lerNoProcesso(arquivo, senha)
  if (leitura.situacao !== 'sem_leitura') return leitura

  const venceEm = await lerEmModoLegado(arquivo, senha)
  return venceEm === null ? leitura : { situacao: 'lido', venceEm }
}

function lerNoProcesso(arquivo: Uint8Array, senha: string): LeituraDoCertificado {
  let contexto: ReturnType<typeof createSecureContext>
  try {
    contexto = createSecureContext({
      pfx: Buffer.from(arquivo),
      passphrase: senha,
      /* Este contexto so LE o arquivo, nunca abre conexao. Sem baixar o nivel
         de seguranca, o OpenSSL 3.5 (Node 24) recusa chave RSA pequena ou
         assinatura SHA-1 com "ee key too small"/"ca md too weak" antes de
         deixar ler a validade — e o certificado viraria "nao e certificado". */
      ciphers: 'DEFAULT@SECLEVEL=0',
    })
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

/**
 * O codigo do processo filho. CommonJS em `-e`: o filho nao carrega nada do
 * projeto, so o que o proprio Node traz.
 */
const LEITOR_DO_FILHO = `
const { createSecureContext } = require('node:tls')
const { X509Certificate } = require('node:crypto')
let entrada = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (parte) => { entrada += parte })
process.stdin.on('end', () => {
  try {
    const { pfx, senha } = JSON.parse(entrada)
    const contexto = createSecureContext({
      pfx: Buffer.from(pfx, 'base64'),
      passphrase: senha,
      ciphers: 'DEFAULT@SECLEVEL=0',
    })
    const der = contexto.context.getCertificate()
    process.stdout.write(JSON.stringify({ validTo: new X509Certificate(der).validTo }))
  } catch {
    process.stdout.write('{}')
  }
})
`

/** Tempo para o filho subir e ler; um .pfx le em milissegundos. */
const TEMPO_DO_FILHO_MS = 10_000

/** A leitura no modo legado, num processo a parte. `null` = nao leu. */
export function lerNoModoLegado(arquivo: Uint8Array, senha: string): Promise<Date | null> {
  return new Promise((resolve) => {
    let saida = ''
    let terminou = false
    const fim = (valor: Date | null) => {
      if (terminou) return
      terminou = true
      resolve(valor)
    }

    const filho = spawn(process.execPath, ['--openssl-legacy-provider', '-e', LEITOR_DO_FILHO], {
      /* Ambiente vazio: nenhuma variavel da api (banco, chaves) chega ao filho,
         nem um NODE_OPTIONS que mude o que ele carrega. */
      env: {},
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: TEMPO_DO_FILHO_MS,
    })
    filho.stdout.setEncoding('utf8')
    filho.stdout.on('data', (parte: string) => {
      saida += parte
    })
    filho.on('error', () => fim(null))
    filho.on('close', () => {
      try {
        const { validTo } = JSON.parse(saida) as { validTo?: string }
        const data = validTo === undefined ? null : new Date(validTo)
        fim(data !== null && !Number.isNaN(data.getTime()) ? data : null)
      } catch {
        fim(null)
      }
    })
    filho.stdin.on('error', () => fim(null))
    filho.stdin.end(JSON.stringify({ pfx: Buffer.from(arquivo).toString('base64'), senha }))
  })
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
