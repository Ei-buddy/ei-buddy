/**
 * Certificados A1 de TESTE — NR-214. Autoassinados, gerados com o openssl so
 * para os testes de `certificado-a1`; nao valem para emitir nada. A senha dos
 * tres e `SENHA_DOS_CERTIFICADOS_DE_TESTE`.
 *
 * A chave de 1024 bits e de proposito: no Node 24 (OpenSSL 3.5) o contexto
 * TLS recusa chave pequena com "ee key too small" — foi o que quebrou a
 * leitura na CI, e e o caso que `lerCertificadoA1` precisa continuar lendo.
 *
 * Gerados assim (chave RSA de 1024 bits, titular "LOJA DE TESTE LTDA"):
 *   openssl ca -selfsign ... -startdate 20260101000000Z -enddate 20991231235959Z
 *   openssl pkcs12 -export            -> moderno (AES, o padrao do OpenSSL 3)
 *   openssl pkcs12 -export -legacy    -> antigo  (RC2-40, que o OpenSSL 3 nao decifra)
 *   ... -enddate 20250101000000Z      -> vencido
 */

export const SENHA_DOS_CERTIFICADOS_DE_TESTE = 'senha-de-teste'

/** Vale ate 31/12/2099. */
export const A1_MODERNO_ATE_2099 = [
  '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',
].join('')

/** O mesmo certificado, cifrado no formato antigo (RC2-40). */
export const A1_ANTIGO_RC2 = [
  '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',
  'KL1eAcsECGBfHP00peptAgIIAA==',
].join('')

/** Venceu em 01/01/2025. */
export const A1_VENCIDO_EM_2025 = [
  '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',
].join('')
