'use client'

import { useId } from 'react'
import type { FieldError } from '@/lib/validation'
import formStyles from './auth-form.module.css'

export type PixKeyType = 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP'

const TIPOS_DE_CHAVE: { value: PixKeyType; label: string }[] = [
  { value: 'CPF', label: 'CPF' },
  { value: 'CNPJ', label: 'CNPJ' },
  { value: 'EMAIL', label: 'E-mail' },
  { value: 'PHONE', label: 'Telefone' },
  { value: 'EVP', label: 'Chave aleatória' },
]

/**
 * Os campos extras do cadastro de Parceiro — NR-115, ADR-0013 (RF-02).
 *
 * CSS proprio de `auth-form.module.css`, o mesmo do resto do cadastro — ao
 * contrario dos campos de `lista-vip/CamposDaPesquisa.tsx`, que nascem
 * deliberadamente desacoplados do login/cadastro (ver o comentario la). Aqui
 * o acoplamento e correto: e a MESMA etapa 1 do mesmo formulario.
 */
export default function PartnerFields({
  pixKey,
  onChangePixKey,
  pixKeyError,
  onBlurPixKey,
  pixKeyType,
  onChangePixKeyType,
  message,
  onChangeMessage,
  messageError,
  onBlurMessage,
  couponName,
  onChangeCouponName,
}: {
  pixKey: string
  onChangePixKey: (v: string) => void
  pixKeyError: FieldError
  onBlurPixKey: () => void
  pixKeyType: PixKeyType
  onChangePixKeyType: (v: PixKeyType) => void
  message: string
  onChangeMessage: (v: string) => void
  messageError: FieldError
  onBlurMessage: () => void
  couponName: string
  onChangeCouponName: (v: string) => void
}) {
  const pixKeyId = useId()
  const pixKeyTypeId = useId()
  const messageId = useId()
  const couponNameId = useId()

  return (
    <>
      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor={pixKeyTypeId}>
          Tipo de chave PIX
        </label>
        <select
          id={pixKeyTypeId}
          className={formStyles.input}
          value={pixKeyType}
          onChange={(e) => onChangePixKeyType(e.target.value as PixKeyType)}
        >
          {TIPOS_DE_CHAVE.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor={pixKeyId}>
          Chave PIX
        </label>
        <input
          id={pixKeyId}
          className={`${formStyles.input} ${pixKeyError ? formStyles.inputError : ''}`}
          value={pixKey}
          onChange={(e) => onChangePixKey(e.target.value)}
          onBlur={onBlurPixKey}
          placeholder="Sua chave PIX para receber a comissão"
          aria-invalid={Boolean(pixKeyError)}
        />
        {pixKeyError ? (
          <span className={formStyles.error} role="alert">
            {pixKeyError}
          </span>
        ) : (
          <span className={formStyles.hint}>É para onde vai a comissão de cada indicação.</span>
        )}
      </div>

      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor={messageId}>
          Por que você quer ser Parceiro?
        </label>
        <textarea
          id={messageId}
          className={`${formStyles.input} ${messageError ? formStyles.inputError : ''}`}
          value={message}
          onChange={(e) => onChangeMessage(e.target.value)}
          onBlur={onBlurMessage}
          rows={3}
          placeholder="Conte um pouco sobre como pretende divulgar o EiBuddy."
          aria-invalid={Boolean(messageError)}
        />
        {messageError ? (
          <span className={formStyles.error} role="alert">
            {messageError}
          </span>
        ) : null}
      </div>

      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor={couponNameId}>
          Nome do seu cupom <span>(opcional)</span>
        </label>
        <input
          id={couponNameId}
          className={formStyles.input}
          value={couponName}
          onChange={(e) => onChangeCouponName(e.target.value.toUpperCase())}
          placeholder="Ex.: JOAO10 — deixe em branco para sugerirmos um"
          autoComplete="off"
          spellCheck={false}
        />
        <span className={formStyles.hint}>
          É o código que você vai divulgar. Se não escolher um, sugerimos um a partir do nome da sua
          empresa.
        </span>
      </div>
    </>
  )
}
