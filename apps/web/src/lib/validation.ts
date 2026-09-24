/** Validadores dos formularios de autenticacao (mensagens em pt-BR). */

export type FieldError = string | null

export function validateCredential(value: string): FieldError {
  const trimmed = value.trim()
  if (!trimmed) return 'Informe seu e-mail ou telefone.'

  const isEmail = trimmed.includes('@')
  if (isEmail) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed) ? null : 'E-mail inválido.'
  }

  const digits = trimmed.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 11 ? null : 'Telefone inválido. Use DDD + número.'
}

export function validateEmail(value: string): FieldError {
  const trimmed = value.trim()
  if (!trimmed) return 'Informe seu e-mail.'
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed) ? null : 'E-mail inválido.'
}

export function validateName(value: string): FieldError {
  const trimmed = value.trim()
  if (!trimmed) return 'Informe seu nome completo.'
  if (trimmed.length < 3) return 'Nome muito curto.'
  if (!trimmed.includes(' ')) return 'Informe nome e sobrenome.'
  return null
}

export function validatePhone(value: string): FieldError {
  const digits = value.replace(/\D/g, '')
  if (!digits) return 'Informe seu telefone.'
  return digits.length >= 10 && digits.length <= 11 ? null : 'Telefone inválido. Use DDD + número.'
}

export function validatePassword(value: string): FieldError {
  if (!value) return 'Crie uma senha.'
  if (value.length < 8) return 'A senha precisa ter ao menos 8 caracteres.'
  if (!/[a-zA-Z]/.test(value) || !/\d/.test(value)) {
    return 'Use letras e números.'
  }
  return null
}

export function validateLoginPassword(value: string): FieldError {
  if (!value) return 'Informe sua senha.'
  return null
}

export function validatePasswordConfirm(password: string, confirm: string): FieldError {
  if (!confirm) return 'Repita a senha.'
  return password === confirm ? null : 'As senhas não conferem.'
}

/** Forca da senha, usada apenas como feedback visual. */
export function passwordStrength(value: string): {
  score: 0 | 1 | 2 | 3
  label: string
} {
  if (value.length < 8) return { score: 0, label: 'Muito curta' }

  let score = 1
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++
  if (/\d/.test(value) && /[^a-zA-Z0-9]/.test(value)) score++

  const labels = ['Muito curta', 'Fraca', 'Boa', 'Forte'] as const
  return { score: score as 1 | 2 | 3, label: labels[score] }
}

/* -------------------------------------------------------------------------- *
 * Documentos e endereco
 * -------------------------------------------------------------------------- */

/** Mascara progressiva de CNPJ: 12.345.678/0001-90 */
export function maskCNPJ(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

/**
 * Valida CNPJ pelos digitos verificadores — nao apenas pelo formato.
 * Formato correto com digito errado e o erro que mais passa despercebido
 * em cadastro, e so aparece na hora de emitir nota.
 */
export function isValidCNPJ(value: string): boolean {
  const d = value.replace(/\D/g, '')
  if (d.length !== 14) return false
  if (/^(\d)\1{13}$/.test(d)) return false

  const digito = (base: string, pesos: number[]) => {
    const soma = base.split('').reduce((acc, n, i) => acc + Number(n) * pesos[i], 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }

  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

  const dv1 = digito(d.slice(0, 12), pesos1)
  const dv2 = digito(d.slice(0, 13), pesos2)

  return dv1 === Number(d[12]) && dv2 === Number(d[13])
}

export function validateCNPJ(value: string): FieldError {
  const d = value.replace(/\D/g, '')
  if (!d) return 'Informe o CNPJ.'
  if (d.length !== 14) return 'CNPJ incompleto.'
  return isValidCNPJ(value) ? null : 'CNPJ inválido.'
}

/** Mascara progressiva de CPF: 123.456.789-00 */
export function maskCPF(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

/** Valida CPF pelos digitos verificadores. */
export function isValidCPF(value: string): boolean {
  const d = value.replace(/\D/g, '')
  if (d.length !== 11) return false
  if (/^(\d)\1{10}$/.test(d)) return false

  const digito = (qtd: number) => {
    let soma = 0
    for (let i = 0; i < qtd; i++) {
      soma += Number(d[i]) * (qtd + 1 - i)
    }
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }

  return digito(9) === Number(d[9]) && digito(10) === Number(d[10])
}

export function validateCPF(value: string): FieldError {
  const d = value.replace(/\D/g, '')
  if (!d) return 'Informe o CPF.'
  if (d.length !== 11) return 'CPF incompleto.'
  return isValidCPF(value) ? null : 'CPF inválido.'
}

/** Valida CPF ou CNPJ conforme o tipo escolhido. */
export function validateDocumento(value: string, tipo: 'fisica' | 'juridica'): FieldError {
  return tipo === 'fisica' ? validateCPF(value) : validateCNPJ(value)
}

export function maskDocumento(value: string, tipo: 'fisica' | 'juridica'): string {
  return tipo === 'fisica' ? maskCPF(value) : maskCNPJ(value)
}

/** Mascara de CEP: 80010-010 */
export function maskCEP(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 8)
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`
}

export function validateCEP(value: string): FieldError {
  const d = value.replace(/\D/g, '')
  if (!d) return 'Informe o CEP.'
  return d.length === 8 ? null : 'CEP incompleto.'
}

export function validateRequired(value: string, label: string): FieldError {
  return value.trim() ? null : `Informe ${label}.`
}

/** Celular sem DDD: 99876-5432 */
export function maskCelular(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 9)
  if (d.length <= 4) return d
  if (d.length <= 8) return `${d.slice(0, 4)}-${d.slice(4)}`
  return `${d.slice(0, 5)}-${d.slice(5)}`
}

export function validateCelular(value: string): FieldError {
  const d = value.replace(/\D/g, '')
  if (!d) return 'Informe o celular.'
  return d.length >= 8 && d.length <= 9 ? null : 'Celular inválido.'
}

export function validateDDD(value: string): FieldError {
  const d = value.replace(/\D/g, '')
  if (!d) return 'DDD.'
  return d.length === 2 ? null : 'DDD inválido.'
}

/** Mascara progressiva de telefone: (41) 99876-5432 */
export function maskPhone(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

/* -------------------------------------------------------------------------- */
/* Conta de Parceiro — chave PIX e nome do cupom                              */
/* -------------------------------------------------------------------------- */

export type TipoDeChavePix = 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP'

/**
 * A chave PIX combina com o tipo escolhido — a mesma regra de `pixKeyError`
 * em contracts (validation.test.ts compara as duas). E por ela que a comissao
 * do Parceiro e paga: "abc" como e-mail so seria descoberto no repasse.
 */
export function validatePixKey(value: string, tipo: TipoDeChavePix): FieldError {
  const v = value.trim()
  if (!v) return 'Informe a chave PIX.'
  const d = v.replace(/\D/g, '')
  const ok =
    tipo === 'CPF'
      ? isValidCPF(v)
      : tipo === 'CNPJ'
        ? isValidCNPJ(v)
        : tipo === 'EMAIL'
          ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)
          : tipo === 'PHONE'
            ? d.length === 10 ||
              d.length === 11 ||
              (d.startsWith('55') && d.length >= 12 && d.length <= 13)
            : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  if (ok) return null
  return {
    CPF: 'Informe um CPF válido.',
    CNPJ: 'Informe um CNPJ válido.',
    EMAIL: 'Informe um e-mail válido.',
    PHONE: 'Informe o telefone com DDD.',
    EVP: 'A chave aleatória tem o formato 1234abcd-12ab-34cd-56ef-1234567890ab.',
  }[tipo]
}

/** Mesmas regras de `partnerAccountFieldsSchema.couponCode`. Vazio vale: o sistema sugere. */
export function validateCouponName(value: string): FieldError {
  const v = value.trim()
  if (v === '') return null
  if (v.length < 3) return 'O nome do cupom precisa de ao menos 3 caracteres.'
  if (v.length > 20) return 'O nome do cupom pode ter no máximo 20 caracteres.'
  if (!/^[a-zA-Z0-9]+$/.test(v)) return 'Use só letras e números, sem espaço.'
  return null
}
