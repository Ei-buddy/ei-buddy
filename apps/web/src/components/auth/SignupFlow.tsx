'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useState, type FormEvent } from 'react'
import { createAccount, createPixCharge, fetchPixChargeStatus } from '@/lib/auth-api'
import { saveSubscriptionStatus } from '@/lib/subscription-store'
import {
  maskCNPJ,
  maskPhone,
  validateCNPJ,
  validateEmail,
  validateName,
  validatePassword,
  validatePasswordConfirm,
  validatePhone,
  validateRequired,
  type FieldError,
} from '@/lib/validation'
import { plan } from '@/content/site'
import { Alert, FormFooter, FormHeader, PasswordField, SubmitButton, TextField } from './Fields'
import CouponInput from './CouponInput'
import PartnerFields, { type PixKeyType } from './PartnerFields'
import CobrancaPix from '@/components/app/CobrancaPix'
import SignupStepper from './SignupStepper'
import TermsCheckbox from './TermsCheckbox'
import formStyles from './auth-form.module.css'
import styles from './signup.module.css'

/**
 * Mensagem minima do pedido de Parceiro — mesma regra de
 * `partnerAccountFieldsSchema` em `@na-regua/contracts` (RF-02). Repetida
 * aqui pelo mesmo motivo de `MINIMO_DE_SENHA` em `composition.ts`: recusar
 * so no backend faria a pessoa perder o que digitou.
 */
function validatePartnerMessage(value: string): string | null {
  if (value.trim().length < 10) return 'Conte um pouco mais sobre por que quer ser Parceiro.'
  return null
}

/** Valor do plano em numero — a copy da landing traz "R$ 149". */
const PLAN_AMOUNT = 149

export default function SignupFlow() {
  const router = useRouter()
  const [step, setStep] = useState(1)

  /* Etapa 1 */
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [telefone, setTelefone] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')

  const [nomeError, setNomeError] = useState<FieldError>(null)
  const [emailError, setEmailError] = useState<FieldError>(null)
  const [telefoneError, setTelefoneError] = useState<FieldError>(null)
  const [senhaError, setSenhaError] = useState<FieldError>(null)
  const [confirmacaoError, setConfirmacaoError] = useState<FieldError>(null)

  /*
   * A LOJA — RF-001, RF-002.
   *
   * Faltavam no formulario, e por isso o cadastro nao podia funcionar: a api
   * cria pessoa e empresa juntas, e pessoa sem loja nao faz nada no sistema.
   * Ficam na etapa 1 porque sao o que define a conta — perguntar depois do
   * pagamento seria descobrir o CNPJ repetido tarde demais.
   */
  const [razaoSocial, setRazaoSocial] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [razaoSocialError, setRazaoSocialError] = useState<FieldError>(null)
  const [cnpjError, setCnpjError] = useState<FieldError>(null)

  /*
   * Tipo de conta — NR-115, ADR-0013.
   *
   * `'lojista'` e o default: so quem marca "Parceiro" ve os campos extras, e
   * so nesse caso eles entram na validacao e no corpo do cadastro.
   */
  const [tipoDeConta, setTipoDeConta] = useState<'lojista' | 'parceiro'>('lojista')
  const [pixKey, setPixKey] = useState('')
  const [pixKeyType, setPixKeyType] = useState<PixKeyType>('PHONE')
  const [partnerMessage, setPartnerMessage] = useState('')
  const [couponName, setCouponName] = useState('')
  const [pixKeyError, setPixKeyError] = useState<FieldError>(null)
  const [partnerMessageError, setPartnerMessageError] = useState<FieldError>(null)

  /* Etapa 2 */
  const [cupom, setCupom] = useState('')
  const [cupomValido, setCupomValido] = useState<string | null>(null)

  /* Etapa 3 */
  const [aceitou, setAceitou] = useState(false)
  const [criando, setCriando] = useState(false)
  const [erroCriacao, setErroCriacao] = useState<string | null>(null)

  /* Envolvida em useCallback porque o CobrancaPix a usa como dependencia
     de efeito: uma funcao nova a cada render regeraria a cobranca. */
  const criarCobrancaAssinatura = useCallback(
    (valor: number) => createPixCharge(plan.name, valor),
    [],
  )

  const handleCupomValido = useCallback((code: string | null) => {
    setCupomValido(code)
  }, [])

  /* ---------------------------------------------------------------- *
   * Etapa 1 — dados da conta
   * ---------------------------------------------------------------- */

  function submitDados(event: FormEvent) {
    event.preventDefault()

    const erros = {
      nome: validateName(nome),
      email: validateEmail(email),
      telefone: validatePhone(telefone),
      senha: validatePassword(senha),
      confirmacao: validatePasswordConfirm(senha, confirmacao),
      /* A loja entra no MESMO portao: deixar passar aqui adiaria a recusa de
         CNPJ para depois do pagamento, que e o pior momento possivel. */
      razaoSocial: validateRequired(razaoSocial, 'a razao social'),
      cnpj: validateCNPJ(cnpj),
      /* So valem quando a pessoa escolheu ser Parceiro — mesmo portao. */
      pixKey: tipoDeConta === 'parceiro' ? validateRequired(pixKey, 'a chave PIX') : null,
      partnerMessage: tipoDeConta === 'parceiro' ? validatePartnerMessage(partnerMessage) : null,
    }

    setNomeError(erros.nome)
    setEmailError(erros.email)
    setTelefoneError(erros.telefone)
    setSenhaError(erros.senha)
    setConfirmacaoError(erros.confirmacao)
    setRazaoSocialError(erros.razaoSocial)
    setCnpjError(erros.cnpj)
    setPixKeyError(erros.pixKey)
    setPartnerMessageError(erros.partnerMessage)

    if (Object.values(erros).some(Boolean)) return
    setStep(2)
  }

  /* ---------------------------------------------------------------- *
   * Etapa 3 — cria a conta e segue para o pagamento
   * ---------------------------------------------------------------- */

  async function submitTermos(event: FormEvent) {
    event.preventDefault()
    if (!aceitou) return

    setErroCriacao(null)
    setCriando(true)

    const resultado = await createAccount({
      nome,
      email,
      telefone,
      senha,
      razaoSocial,
      cnpj,
      cupom: cupomValido,
      ...(tipoDeConta === 'parceiro'
        ? {
            accountType: 'parceiro' as const,
            pixKey,
            pixKeyType,
            partnerMessage,
            ...(couponName.trim() === '' ? {} : { couponName: couponName.trim() }),
          }
        : {}),
    })

    setCriando(false)

    if (!resultado.ok) {
      setErroCriacao(resultado.error)
      return
    }

    setStep(4)
  }

  /* ---------------------------------------------------------------- *
   * Etapa 4 — pagamento confirmado
   * ---------------------------------------------------------------- */

  const aoConfirmarPagamento = useCallback(() => {
    saveSubscriptionStatus('active')

    /* Abre a sessao para o proxy liberar /app/*. */
    /* A criacao de conta ainda e simulada (POST /auth/signup nao existe — nao
       ha tarefa no ledger para ela). Antes isto abria uma sessao FALSA, com um
       cookie que o proxy aceitava: quem criava conta entrava no painel sem
       nunca ter passado pela api. Agora manda para o login, que e verdade —
       a conta so existe quando o cadastro existir. */

    router.push('/app')
  }, [router, nome, email])

  return (
    <>
      <SignupStepper current={step} />

      {/* ============================ Etapa 1 ============================ */}
      {step === 1 ? (
        <>
          <FormHeader title="Criar conta" subtitle="Comece pelos seus dados de acesso." />

          <form onSubmit={submitDados} noValidate>
            <TextField
              label="Nome completo"
              value={nome}
              onChange={(v) => {
                setNome(v)
                if (nomeError) setNomeError(validateName(v))
              }}
              onBlur={() => setNomeError(validateName(nome))}
              error={nomeError}
              placeholder="Maria Silva"
              autoComplete="name"
            />

            <TextField
              label="E-mail"
              value={email}
              onChange={(v) => {
                setEmail(v)
                if (emailError) setEmailError(validateEmail(v))
              }}
              onBlur={() => setEmailError(validateEmail(email))}
              error={emailError}
              type="email"
              inputMode="email"
              placeholder="voce@empresa.com.br"
              autoComplete="email"
            />

            <TextField
              label="Razão social da empresa"
              value={razaoSocial}
              onChange={(v) => {
                setRazaoSocial(v)
                if (razaoSocialError) setRazaoSocialError(validateRequired(v, 'a razao social'))
              }}
              onBlur={() => setRazaoSocialError(validateRequired(razaoSocial, 'a razao social'))}
              error={razaoSocialError}
              placeholder="Mercearia Sol Nascente LTDA"
              autoComplete="organization"
            />

            <TextField
              label="CNPJ"
              value={cnpj}
              onChange={(v) => {
                const mascarado = maskCNPJ(v)
                setCnpj(mascarado)
                if (cnpjError) setCnpjError(validateCNPJ(mascarado))
              }}
              onBlur={() => setCnpjError(validateCNPJ(cnpj))}
              error={cnpjError}
              inputMode="numeric"
              placeholder="00.000.000/0000-00"
            />

            <div className={formStyles.field}>
              <span className={formStyles.label}>Tipo de conta</span>
              <div className={styles.tipoDeContaOpcoes}>
                <label className={styles.tipoDeContaOpcao}>
                  <input
                    type="radio"
                    name="tipo-de-conta"
                    checked={tipoDeConta === 'lojista'}
                    onChange={() => setTipoDeConta('lojista')}
                  />
                  Criar conta como usuário
                </label>
                <label className={styles.tipoDeContaOpcao}>
                  <input
                    type="radio"
                    name="tipo-de-conta"
                    checked={tipoDeConta === 'parceiro'}
                    onChange={() => setTipoDeConta('parceiro')}
                  />
                  Cadastrar como Parceiro
                </label>
              </div>
              <span className={formStyles.hint}>
                Parceiro indica o EiBuddy e ganha comissão recorrente por cliente — a conta fica em
                análise até a aprovação.
              </span>
            </div>

            {tipoDeConta === 'parceiro' ? (
              <PartnerFields
                pixKey={pixKey}
                onChangePixKey={(v) => {
                  setPixKey(v)
                  if (pixKeyError) setPixKeyError(validateRequired(v, 'a chave PIX'))
                }}
                pixKeyError={pixKeyError}
                onBlurPixKey={() => setPixKeyError(validateRequired(pixKey, 'a chave PIX'))}
                pixKeyType={pixKeyType}
                onChangePixKeyType={setPixKeyType}
                message={partnerMessage}
                onChangeMessage={(v) => {
                  setPartnerMessage(v)
                  if (partnerMessageError) setPartnerMessageError(validatePartnerMessage(v))
                }}
                messageError={partnerMessageError}
                onBlurMessage={() => setPartnerMessageError(validatePartnerMessage(partnerMessage))}
                couponName={couponName}
                onChangeCouponName={setCouponName}
              />
            ) : null}

            <TextField
              label="Telefone / WhatsApp"
              value={telefone}
              onChange={(v) => {
                const masked = maskPhone(v)
                setTelefone(masked)
                if (telefoneError) setTelefoneError(validatePhone(masked))
              }}
              onBlur={() => setTelefoneError(validatePhone(telefone))}
              error={telefoneError}
              type="tel"
              inputMode="tel"
              placeholder="(41) 99876-5432"
              autoComplete="tel"
              hint="É por aqui que o assistente vai falar com você."
            />

            <PasswordField
              label="Senha"
              value={senha}
              onChange={(v) => {
                setSenha(v)
                if (senhaError) setSenhaError(validatePassword(v))
                if (confirmacaoError) {
                  setConfirmacaoError(validatePasswordConfirm(v, confirmacao))
                }
              }}
              onBlur={() => setSenhaError(validatePassword(senha))}
              error={senhaError}
              autoComplete="new-password"
              showStrength
            />

            <PasswordField
              label="Confirmar senha"
              value={confirmacao}
              onChange={(v) => {
                setConfirmacao(v)
                if (confirmacaoError) {
                  setConfirmacaoError(validatePasswordConfirm(senha, v))
                }
              }}
              onBlur={() => setConfirmacaoError(validatePasswordConfirm(senha, confirmacao))}
              error={confirmacaoError}
              autoComplete="new-password"
            />

            <SubmitButton>Continuar</SubmitButton>
          </form>

          <FormFooter>
            Já tem conta? <Link href="/login">Entrar</Link>
          </FormFooter>
        </>
      ) : null}

      {/* ============================ Etapa 2 ============================ */}
      {step === 2 ? (
        <>
          <FormHeader
            title="Cupom de parceiro"
            subtitle="Se alguém indicou o sistema, informe o cupom. É opcional."
          />

          <form
            onSubmit={(e) => {
              e.preventDefault()
              setStep(3)
            }}
            noValidate
          >
            <CouponInput value={cupom} onChange={setCupom} onValidChange={handleCupomValido} />

            <div className={styles.stepActions}>
              <SubmitButton type="button" variant="secondary" onClick={() => setStep(1)}>
                Voltar
              </SubmitButton>
              <SubmitButton>
                {cupomValido ? 'Continuar com cupom' : 'Continuar sem cupom'}
              </SubmitButton>
            </div>
          </form>
        </>
      ) : null}

      {/* ============================ Etapa 3 ============================ */}
      {step === 3 ? (
        <>
          <FormHeader title="Termos de uso" subtitle="Último passo antes do pagamento." />

          {erroCriacao ? <Alert tone="error">{erroCriacao}</Alert> : null}

          <div className={styles.resumo}>
            <h2 className={styles.resumoTitle}>Resumo da conta</h2>
            <dl className={styles.resumoList}>
              <div>
                <dt>Nome</dt>
                <dd>{nome}</dd>
              </div>
              <div>
                <dt>E-mail</dt>
                <dd>{email}</dd>
              </div>
              <div>
                <dt>Telefone</dt>
                <dd>{telefone}</dd>
              </div>
              <div>
                <dt>Cupom</dt>
                <dd>{cupomValido ?? 'Nenhum'}</dd>
              </div>
              <div>
                <dt>Plano</dt>
                <dd>
                  {plan.name} · {plan.price}
                  {plan.period}
                </dd>
              </div>
            </dl>
          </div>

          <form onSubmit={submitTermos} noValidate>
            <TermsCheckbox checked={aceitou} onChange={setAceitou} />

            <div className={styles.stepActions}>
              <SubmitButton
                type="button"
                variant="secondary"
                onClick={() => setStep(2)}
                disabled={criando}
              >
                Voltar
              </SubmitButton>
              <SubmitButton loading={criando} loadingLabel="Criando conta..." disabled={!aceitou}>
                Criar conta
              </SubmitButton>
            </div>
          </form>
        </>
      ) : null}

      {/* ============================ Etapa 4 ============================ */}
      {step === 4 ? (
        <>
          <FormHeader
            title="Pagamento via Pix"
            subtitle="Assim que o pagamento cair, seu painel abre automaticamente."
          />

          <CobrancaPix
            titulo={plan.name}
            subtitulo="Plano contratado"
            amount={PLAN_AMOUNT}
            criarCobranca={criarCobrancaAssinatura}
            consultarStatus={fetchPixChargeStatus}
            onPago={aoConfirmarPagamento}
            textoSucesso="Sua assinatura está ativa. Estamos abrindo seu painel..."
          />
        </>
      ) : null}
    </>
  )
}
