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
  const [falha, setFalha] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const err = validateEmail(email)
    setError(err)
    if (err) return

    setLoading(true)
    setFalha(null)
    /*
     * A api responde igual com ou sem conta (RF-120), entao sucesso aqui e so
     * "o pedido chegou". O que pode falhar e a rede e o limite de tentativas —
     * e esses a pessoa precisa saber, ou esperaria um e-mail que nao vem.
     */
    const r = await fetch('/api/auth/recuperar-senha', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    }).catch(() => null)
    setLoading(false)

    if (r === null) return setFalha('Sem conexão. Verifique sua internet e tente de novo.')
    if (r.status === 429) return setFalha('Muitas tentativas. Espere um minuto e tente de novo.')
    if (!r.ok) {
      const corpo = (await r.json().catch(() => ({}))) as { error?: { message?: string } }
      return setFalha(corpo.error?.message ?? 'Não foi possível enviar agora. Tente de novo.')
    }
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

      {falha ? <Alert>{falha}</Alert> : null}

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
