'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { validateEmail, type FieldError } from '@/lib/validation'
import { Alert, FormFooter, FormHeader, IconeEmail, SubmitButton, TextField } from './Fields'

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<FieldError>(null)
  const [loading, setLoading] = useState(false)
  const [enviado, setEnviado] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const err = validateEmail(email)
    setError(err)
    if (err) return

    setLoading(true)
    /* SUBSTITUIR POR: POST /auth/password-reset */
    await new Promise((r) => setTimeout(r, 900))
    setLoading(false)
    setEnviado(true)
  }

  if (enviado) {
    return (
      <>
        <FormHeader title="Verifique seu e-mail" />
        <Alert tone="success">
          Se existir uma conta para <strong>{email}</strong>, enviamos um link para criar uma nova
          senha. O link vale por 1 hora.
        </Alert>
        <FormFooter>
          <Link href="/login">Voltar para o login</Link>
        </FormFooter>
      </>
    )
  }

  return (
    <>
      <FormHeader
        title="Recuperar senha"
        subtitle="Informe seu e-mail e enviaremos um link para criar uma nova senha."
      />

      <form onSubmit={handleSubmit} noValidate>
        <TextField
          label="E-mail"
          value={email}
          onChange={(v) => {
            setEmail(v)
            if (error) setError(validateEmail(v))
          }}
          onBlur={() => setError(validateEmail(email))}
          error={error}
          type="email"
          inputMode="email"
          placeholder="voce@empresa.com.br"
          autoComplete="email"
          disabled={loading}
          icone={<IconeEmail />}
        />

        <SubmitButton loading={loading} loadingLabel="Enviando...">
          Enviar link de recuperação
        </SubmitButton>
      </form>

      <FormFooter>
        Lembrou a senha? <Link href="/login">Entrar</Link>
      </FormFooter>
    </>
  )
}
