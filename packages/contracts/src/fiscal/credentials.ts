import { z } from 'zod'
import { dateSchema } from '../common/primitives.js'

/**
 * Credenciais de emissao fiscal da empresa — NR-042, RF-004, RNF-022.
 *
 * O que entra aqui e segredo de lojista: token do emissor, certificado A1 e a
 * senha dele. Nada disso volta na leitura — ver `fiscalCredentialsStatusSchema`.
 */

/**
 * Atualizacao PARCIAL, de proposito.
 *
 * Quem troca so o certificado nao pode perder o token. Por isso os campos sao
 * opcionais e o repositorio preserva o que nao veio — um formulario que envia
 * apenas o que mudou nao deve apagar o resto.
 */
const cscSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[0-9]{1,6}$/, 'O ID do CSC tem so numeros (ate 6).')
      .transform((v) => String(Number(v))),
    code: z.string().trim().min(8, 'CSC muito curto.').max(64, 'CSC muito longo.'),
  })
  .strict()

export const updateFiscalCredentialsInputSchema = z
  .object({
    /** Token da conta do lojista no emissor. Vai como usuario do Basic. */
    focusToken: z.string().trim().min(8, 'Token muito curto.').max(200).optional(),

    /**
     * O arquivo .pfx/.p12 em base64.
     *
     * Base64 e nao multipart pelo mesmo motivo do extrato bancario: um
     * certificado A1 tem poucos KB, e a dependencia a mais nao se paga.
     */
    certificateBase64: z
      .string()
      .min(1, 'Arquivo do certificado vazio.')
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Arquivo corrompido no envio.')
      .optional(),

    certificatePassword: z.string().min(1, 'Informe a senha do certificado.').optional(),

    /**
     * Vencimento digitado — OPCIONAL desde a NR-214.
     *
     * A api abre o certificado com a senha e le a validade do proprio arquivo;
     * quando consegue, ela vale mesmo que outra tenha sido digitada. A digitada
     * so serve para o A1 cifrado no formato antigo (RC2), que o OpenSSL 3 nao
     * decifra: ai a senha ainda e conferida, mas a data nao e lida.
     */
    certificateExpiresAt: dateSchema.optional(),

    /**
     * CSC da NFC-e — NR-183. A loja gera no site da SEFAZ do estado, um par
     * por ambiente: o ID (numero de ordem, ate 6 digitos) e o codigo. Vai para
     * a Focus no cadastro da empresa; sem ele, a NFC-e nao tem QR Code valido.
     */
    cscProduction: cscSchema.optional(),
    cscHomologation: cscSchema.optional(),
  })
  .strict()
  .refine((v) => (v.certificateBase64 === undefined) === (v.certificatePassword === undefined), {
    message: 'Certificado e senha vao juntos.',
    path: ['certificateBase64'],
  })
  .refine((v) => v.certificateExpiresAt === undefined || v.certificateBase64 !== undefined, {
    message: 'Validade so vai junto com o certificado.',
    path: ['certificateExpiresAt'],
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada para atualizar.' })

export type UpdateFiscalCredentialsInput = z.infer<typeof updateFiscalCredentialsInputSchema>

/**
 * O que a tela pode saber.
 *
 * Booleanos, e nunca o valor. Devolver o token seria desfazer a cifragem na
 * saida — quem le a tela precisa saber SE esta configurado, e ate quando o
 * certificado vale.
 */
export const fiscalCredentialsStatusSchema = z
  .object({
    hasToken: z.boolean(),
    hasCertificate: z.boolean(),
    certificateExpiresAt: z.string().nullable(),
    hasCscProduction: z.boolean(),
    hasCscHomologation: z.boolean(),
    /**
     * Cadastro da empresa na Focus — NR-183. `syncedAt` e o ultimo aceito;
     * `error` e o que a Focus disse na ultima recusa (nulo depois de aceito);
     * `available` diz se o servidor tem a conta de revenda configurada.
     */
    focus: z
      .object({
        available: z.boolean(),
        syncedAt: z.string().nullable(),
        error: z.string().nullable(),
      })
      .strict(),
  })
  .strict()

export type FiscalCredentialsStatus = z.infer<typeof fiscalCredentialsStatusSchema>
