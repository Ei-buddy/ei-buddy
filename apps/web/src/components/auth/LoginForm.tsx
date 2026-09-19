'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { SessionUser } from '@/lib/session'
import { entrar, escolherEmpresa } from '@/lib/session-client'
import { validateCredential, validateLoginPassword, type FieldError } from '@/lib/validation'
import {
  Alert,
  FormFooter,
  FormHeader,
  IconeEmail,
  IconeSenha,
  PasswordField,
  SubmitButton,
  TextField,
} from './Fields'
import TravessiaDeVidro from './TravessiaDeVidro'
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

  /**
   * A travessia para dentro do painel — NR-132.
   *
   * Liga quando a credencial ja foi aceita e so falta ir. O destino fica
   * guardado aqui porque quem navega e a travessia, no fim da animacao, e nao
   * mais o fluxo que validou.
   */
  const [destino, setDestino] = useState<string | null>(null)

  /**
   * O painel nao abriu — NR-132.
   *
   * A credencial FOI aceita e o cookie ja existe: o que falhou foi so a
   * navegacao. Por isso a mensagem daqui nao pode soar como erro de login;
   * quem ler "senha invalida" depois de ter entrado vai digitar de novo sem
   * necessidade.
   *
   * Guarda o DESTINO, e nao um booleano: o `destino` precisa voltar a
   * `null` (e o que desmonta a travessia e devolve a tela), e o link de
   * escape continua precisando saber para onde ia.
   */
  const [naoAbriu, setNaoAbriu] = useState<string | null>(null)

  /* A rota do painel e pedida enquanto a pessoa ainda digita: assim a
     navegacao no fim da animacao e instantanea, e a sequencia nunca vira
     espera de rede disfarcada. */
  useEffect(() => {
    router.prefetch('/app')
  }, [router])

  const atravessar = useCallback(() => {
    if (destino) router.push(destino)
  }, [destino, router])

  /*
   * Desmontar a travessia (`destino` a `null`) e o que garante a limpeza do
   * `data-entrando` pelo React, alem da que ela mesma ja fez. A tela volta
   * inteira: formulario utilizavel, com um aviso e uma saida de verdade.
   */
  const desistir = useCallback(() => {
    setNaoAbriu(destino)
    setDestino(null)
    setLoading(false)
  }, [destino])

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
      setNaoAbriu(null)
      setDestino('/app/plataforma/cargos')
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
    /* Nao navega aqui: guarda o destino e deixa a travessia levar. Com
       movimento reduzido ela vai no primeiro quadro, sem animacao nenhuma. */
    setNaoAbriu(null)
    setDestino(proximo && proximo.startsWith('/app') ? proximo : '/app')
  }

  /**
   * O aviso de que a travessia desistiu — NR-132.
   *
   * `tone="warning"` e nao `error`: nada deu errado com a pessoa nem com a
   * senha dela. Ela esta dentro; foi o painel que nao abriu a tempo.
   *
   * A saida e um `<a>` comum, de proposito, e nao um `<Link>`: o `Link`
   * repetiria exatamente a navegacao de cliente que acabou de nao funcionar.
   * O `<a>` carrega a pagina do zero — outro caminho, com a barra de
   * progresso do proprio navegador no lugar de uma tela parada.
   */
  const avisoDePainelQueNaoAbriu =
    naoAbriu === null ? null : (
      <Alert tone="warning">
        Você entrou, mas o painel não abriu a tempo.{' '}
        <a href={naoAbriu} className={loginStyles.forgot}>
          Abrir o painel
        </a>
      </Alert>
    )

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

        {avisoDePainelQueNaoAbriu}

        {destino !== null ? (
          <TravessiaDeVidro aoTerminar={atravessar} aoDesistir={desistir} />
        ) : null}

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

      {avisoDePainelQueNaoAbriu}

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
          icone={<IconeEmail />}
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
          icone={<IconeSenha />}
        />

        <div className={loginStyles.forgotRow}>
          <Link href="/recuperar-senha" className={loginStyles.forgot}>
            Esqueci minha senha
          </Link>
        </div>

        <SubmitButton
          loading={loading}
          loadingLabel="Entrando..."
          sucesso={destino !== null}
          sucessoLabel="Tudo certo"
        >
          Entrar
        </SubmitButton>
      </form>

      {destino !== null ? <TravessiaDeVidro aoTerminar={atravessar} aoDesistir={desistir} /> : null}

      <FormFooter>
        Não tem conta? <Link href="/criar-conta">Criar conta</Link>
      </FormFooter>
    </>
  )
}
