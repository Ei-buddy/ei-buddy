'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import type { SessionUser } from '@/lib/session'
import { entrar, escolherEmpresa } from '@/lib/session-client'
import { validateCredential, validateLoginPassword, type FieldError } from '@/lib/validation'
import { Alert, FormFooter, FormHeader, PasswordField, SubmitButton, TextField } from './Fields'
import loginStyles from './login.module.css'

/** O papel na tela e em portugues, nao o valor do contrato. */
const PAPEL: Record<string, string> = {
  owner: 'Dono',
  staff: 'Funcionário',
  accountant: 'Contador',
  platform_admin: 'Administrador',
}

export default function LoginForm() {
  const router = useRouter()

  const [credential, setCredential] = useState('')
  const [password, setPassword] = useState('')

  const [credentialError, setCredentialError] = useState<FieldError>(null)
  const [passwordError, setPasswordError] = useState<FieldError>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)

  /**
   * Quem opera mais de uma loja entra e DEPOIS escolhe — US-059.
   *
   * Enquanto isto tem valor, o formulario da lugar a lista de lojas. Nao e um
   * passo a mais para todo mundo: com uma loja so, o codigo escolhe sozinho e
   * a pessoa nem ve esta tela.
   */
  const [escolhendo, setEscolhendo] = useState<SessionUser | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    /* Validacao inline antes de qualquer chamada. */
    const credErr = validateCredential(credential)
    const passErr = validateLoginPassword(password)
    setCredentialError(credErr)
    setPasswordError(passErr)
    if (credErr || passErr) return

    setFormError(null)
    setLoading(true)

    const r = await entrar(credential, password)

    if (!r.ok) {
      /* A api ja manda a mensagem em PT-BR e ela e a MESMA para usuario
         inexistente e senha errada — RF-120 pede nao revelar se a conta
         existe. Reescrever aqui desfaria isso. */
      setFormError(r.message)
      setLoading(false)
      return
    }

    await concluir(r.sessao)
  }

  /**
   * Com uma loja, entra direto. Com varias, pergunta.
   *
   * A escolha vale a pena automatizar no caso de uma so porque e o caso da
   * maioria — e uma tela de escolha com um unico item e uma tela que so existe
   * para ser fechada.
   */
  async function concluir(sessao: SessionUser) {
    /*
     * Super Admin nao escolhe mais "para onde" — NR-122.
     *
     * Havia aqui uma bifurcacao (painel OU loja) porque as telas da
     * plataforma moravam fora do app. Agora elas sao uma secao da barra
     * lateral, entao quem e dono E Super Admin entra na loja e alcanca as
     * duas coisas sem voltar ao login. Uma tela a menos, e nenhuma porta
     * perdida.
     */
    if (sessao.activeCompanyId !== null) return irParaOPainel()

    /* Super Admin sem loja nenhuma: sem este desvio cairia no "conta sem
       vinculo" logo abaixo, que e o erro certo para todo MUNDO menos ele. */
    if (sessao.isPlatformAdmin) {
      router.push('/app/plataforma/cargos')
      return
    }

    if (sessao.memberships.length === 1) {
      const r = await escolherEmpresa(sessao.memberships[0]!.companyId)
      if (!r.ok) {
        setFormError(r.message)
        setLoading(false)
        return
      }
      return irParaOPainel()
    }

    if (sessao.memberships.length === 0) {
      /* Conta sem vinculo nenhum: entrar levaria a um painel vazio e sem
         explicacao. Melhor dizer o que aconteceu. */
      setFormError(`Sua conta ainda não está ligada a nenhuma loja. Fale com quem administra.`)
      setLoading(false)
      return
    }

    setEscolhendo(sessao)
    setLoading(false)
  }

  async function selecionar(companyId: string) {
    setFormError(null)
    setLoading(true)

    const r = await escolherEmpresa(companyId)
    if (!r.ok) {
      setFormError(r.message)
      setLoading(false)
      return
    }
    irParaOPainel()
  }

  function irParaOPainel() {
    /* Se o proxy guardou um destino (?proximo=), devolve a pessoa para la.
       Lido de window e nao de useSearchParams para nao exigir Suspense
       numa pagina estatica. */
    const proximo = new URLSearchParams(window.location.search).get('proximo')
    router.push(proximo && proximo.startsWith('/app') ? proximo : '/app')
  }

  /* Escolha de loja — US-059. Substitui o formulario em vez de aparecer abaixo
     dele: a senha ja foi aceita, e deixar os campos na tela convida a pessoa a
     digitar de novo. */
  if (escolhendo !== null) {
    return (
      <>
        <FormHeader
          title="Qual loja?"
          subtitle={`Olá, ${escolhendo.userName}. Você tem acesso a mais de uma.`}
        />

        {formError ? <Alert tone="error">{formError}</Alert> : null}

        <ul className={loginStyles.lojas}>
          {escolhendo.memberships.map((v) => (
            <li key={v.companyId}>
              <button
                type="button"
                className={loginStyles.loja}
                onClick={() => void selecionar(v.companyId)}
                disabled={loading}
              >
                <span className={loginStyles.lojaNome}>{v.companyName}</span>
                <span className={loginStyles.lojaPapel}>{PAPEL[v.role] ?? v.role}</span>
              </button>
            </li>
          ))}
        </ul>
      </>
    )
  }

  return (
    <>
      <FormHeader title="Entrar" subtitle="Acesse o painel do seu negócio." />

      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <form onSubmit={handleSubmit} noValidate>
        <TextField
          label="E-mail ou telefone"
          value={credential}
          onChange={(v) => {
            setCredential(v)
            if (credentialError) setCredentialError(validateCredential(v))
          }}
          onBlur={() => setCredentialError(validateCredential(credential))}
          error={credentialError}
          type="text"
          placeholder="voce@empresa.com.br"
          autoComplete="username"
          disabled={loading}
        />

        <PasswordField
          label="Senha"
          value={password}
          onChange={(v) => {
            setPassword(v)
            if (passwordError) setPasswordError(validateLoginPassword(v))
          }}
          onBlur={() => setPasswordError(validateLoginPassword(password))}
          error={passwordError}
          autoComplete="current-password"
          disabled={loading}
        />

        <div className={loginStyles.forgotRow}>
          <Link href="/recuperar-senha" className={loginStyles.forgot}>
            Esqueci minha senha
          </Link>
        </div>

        <SubmitButton loading={loading} loadingLabel="Entrando...">
          Entrar
        </SubmitButton>
      </form>

      <FormFooter>
        Não tem conta? <Link href="/criar-conta">Criar conta</Link>
      </FormFooter>
    </>
  )
}
