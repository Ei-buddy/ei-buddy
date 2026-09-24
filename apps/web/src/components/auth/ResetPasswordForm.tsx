'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { validatePassword, validatePasswordConfirm, type FieldError } from '@/lib/validation'
import { Alert, FormFooter, FormHeader, IconeSenha, PasswordField, SubmitButton } from './Fields'

/**
 * Criar a senha nova pelo link do e-mail — NR-014.
 *
 * O token vem da URL e vai uma vez so: a api o consome no primeiro envio, entao
 * uma falha depois disso (senha recusada pelo provedor) pede um link novo.
 */
export default function ResetPasswordForm({ token }: { token: string }) {
  const [senha, setSenha] = useState('')
  const [confirma, setConfirma] = useState('')
  const [erroSenha, setErroSenha] = useState<FieldError>(null)
  const [erroConfirma, setErroConfirma] = useState<FieldError>(null)
  const [falha, setFalha] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pronto, setPronto] = useState(false)

  if (token === '') {
    return (
      <>
        <FormHeader title="Link incompleto" />
        <Alert>Abra o link exatamente como chegou no e-mail, ou peça um novo.</Alert>
        <FormFooter>
          <Link href="/recuperar-senha">Pedir um novo link</Link>
        </FormFooter>
      </>
    )
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const e1 = validatePassword(senha)
    const e2 = validatePasswordConfirm(senha, confirma)
    setErroSenha(e1)
    setErroConfirma(e2)
    if (e1 || e2) return

    setLoading(true)
    setFalha(null)
    const r = await fetch('/api/auth/redefinir-senha', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, secret: senha }),
    }).catch(() => null)
    setLoading(false)

    if (r === null) return setFalha('Sem conexão. Verifique sua internet e tente de novo.')
    if (!r.ok) {
      const corpo = (await r.json().catch(() => ({}))) as { error?: { message?: string } }
      return setFalha(corpo.error?.message ?? 'Não foi possível trocar a senha. Peça um novo link.')
    }
    setPronto(true)
  }

  if (pronto) {
    return (
      <>
        <FormHeader title="Senha alterada" />
        <Alert tone="success">
          Pronto. Por segurança, encerramos as sessões abertas: entre de novo com a senha nova.
        </Alert>
        <FormFooter>
          <Link href="/login">Ir para o login</Link>
        </FormFooter>
      </>
    )
  }

  return (
    <>
      <FormHeader
        title="Criar nova senha"
        subtitle="Use ao menos 8 caracteres, com letras e números."
      />

      {falha ? (
        <Alert>
          {falha} <Link href="/recuperar-senha">Pedir um novo link</Link>
        </Alert>
      ) : null}

      <form onSubmit={handleSubmit} noValidate>
        <PasswordField
          label="Nova senha"
          value={senha}
          onChange={(v) => {
            setSenha(v)
            if (erroSenha) setErroSenha(validatePassword(v))
          }}
          onBlur={() => setErroSenha(validatePassword(senha))}
          error={erroSenha}
          autoComplete="new-password"
          showStrength
          disabled={loading}
          icone={<IconeSenha />}
        />
        <PasswordField
          label="Confirme a nova senha"
          value={confirma}
          onChange={(v) => {
            setConfirma(v)
            if (erroConfirma) setErroConfirma(validatePasswordConfirm(senha, v))
          }}
          onBlur={() => setErroConfirma(validatePasswordConfirm(senha, confirma))}
          error={erroConfirma}
          autoComplete="new-password"
          disabled={loading}
          icone={<IconeSenha />}
        />

        <SubmitButton loading={loading} loadingLabel="Salvando...">
          Salvar nova senha
        </SubmitButton>
      </form>
    </>
  )
}
