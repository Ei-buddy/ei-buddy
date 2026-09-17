'use client'

import { useId, useState, type ReactNode } from 'react'
import { passwordStrength } from '@/lib/validation'
import styles from './auth-form.module.css'

/* ------------------------------------------------------------------ *
 * Cabecalho e rodape do formulario
 * ------------------------------------------------------------------ */

export function FormHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
    </header>
  )
}

export function FormFooter({ children }: { children: ReactNode }) {
  return <p className={styles.footer}>{children}</p>
}

/* ------------------------------------------------------------------ *
 * Caixa de mensagem (erro, alerta, sucesso)
 * ------------------------------------------------------------------ */

export function Alert({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'warning' | 'success'
  children: ReactNode
}) {
  return (
    <div
      className={`${styles.alert} ${styles[`alert_${tone}`]}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Campo de texto
 * ------------------------------------------------------------------ */

type TextFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  /** Validacao roda no blur e some assim que o campo fica valido. */
  onBlur?: () => void
  error?: string | null
  hint?: string
  type?: 'text' | 'email' | 'tel'
  placeholder?: string
  autoComplete?: string
  inputMode?: 'text' | 'email' | 'tel' | 'numeric'
  disabled?: boolean
  /**
   * Icone dentro do campo, a esquerda — NR-129. Opcional: so as telas de
   * entrada usam, e o resto do app segue com o campo liso de sempre.
   */
  icone?: ReactNode
}

export function TextField({
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  type = 'text',
  placeholder,
  autoComplete,
  inputMode,
  disabled,
  icone,
}: TextFieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={icone === undefined ? undefined : styles.comIcone}>
        {icone === undefined ? null : (
          <span className={styles.icone} aria-hidden="true">
            {icone}
          </span>
        )}
        <input
          id={id}
          className={`${styles.input} ${error ? styles.inputError : ''}`}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
        />
      </div>
      {error ? (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Campo de senha, com alternancia de visibilidade
 * ------------------------------------------------------------------ */

type PasswordFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  error?: string | null
  autoComplete?: string
  /** Mostra a barra de forca da senha (usado so no cadastro). */
  showStrength?: boolean
  disabled?: boolean
  /** Icone dentro do campo, a esquerda — NR-129. Ver `TextField`. */
  icone?: ReactNode
}

export function PasswordField({
  label,
  value,
  onChange,
  onBlur,
  error,
  autoComplete,
  showStrength = false,
  disabled,
  icone,
}: PasswordFieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const [visible, setVisible] = useState(false)

  const strength = showStrength && value ? passwordStrength(value) : null

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>

      <div className={`${styles.passwordWrap} ${icone === undefined ? '' : styles.comIcone}`}>
        {icone === undefined ? null : (
          <span className={styles.icone} aria-hidden="true">
            {icone}
          </span>
        )}
        <input
          id={id}
          className={`${styles.input} ${styles.passwordInput} ${error ? styles.inputError : ''}`}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
        />
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={visible}
          disabled={disabled}
        >
          {visible ? <EyeOff /> : <Eye />}
        </button>
      </div>

      {strength ? (
        <div className={styles.strength}>
          <span className={styles.strengthBar} data-score={strength.score} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className={styles.strengthLabel}>{strength.label}</span>
        </div>
      ) : null}

      {error ? (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Botao com estado de carregamento
 * ------------------------------------------------------------------ */

export function SubmitButton({
  children,
  loading = false,
  disabled = false,
  loadingLabel = 'Enviando...',
  type = 'submit',
  onClick,
  variant = 'primary',
  sucesso = false,
  sucessoLabel = 'Pronto',
}: {
  children: ReactNode
  loading?: boolean
  disabled?: boolean
  loadingLabel?: string
  type?: 'submit' | 'button'
  onClick?: () => void
  variant?: 'primary' | 'secondary'
  /** Credencial aceita: o botao vira um ✓ com pulso — NR-132. */
  sucesso?: boolean
  sucessoLabel?: string
}) {
  if (sucesso) {
    return (
      <button
        type="button"
        className={`${styles.submit} ${styles.submitSucesso}`}
        disabled
        /* `status`, e nao so o icone: quem usa leitor de tela ouve a
           confirmacao que o ✓ da a quem enxerga. */
        role="status"
      >
        <IconeCerto />
        {sucessoLabel}
      </button>
    )
  }

  return (
    <button
      type={type}
      onClick={onClick}
      className={`${styles.submit} ${variant === 'secondary' ? styles.submitSecondary : ''}`}
      disabled={disabled || loading}
      aria-busy={loading}
    >
      {loading ? (
        <>
          <Spinner />
          {loadingLabel}
        </>
      ) : (
        children
      )}
    </button>
  )
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span className={styles.spinner} style={{ width: size, height: size }} aria-hidden="true" />
  )
}

/* ------------------------------------------------------------------ *
 * Icones locais dos campos
 * ------------------------------------------------------------------ */

/** Envelope, para o campo de e-mail ou telefone das telas de entrada. */
export function IconeCerto() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

export function IconeEmail() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </svg>
  )
}

/** Cadeado, para o campo de senha das telas de entrada. */
export function IconeSenha() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  )
}

function Eye() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  )
}

function EyeOff() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.9 3.7" />
      <path d="M6.4 7.6A16.8 16.8 0 0 0 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.35 3.8-.9" />
      <path d="M4 4l16 16" />
    </svg>
  )
}
