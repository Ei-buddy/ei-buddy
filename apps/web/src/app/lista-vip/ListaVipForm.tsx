'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Alert, FormHeader, SubmitButton, TextField } from '@/components/auth/Fields'
import {
  CheckboxGroupField,
  RadioGroupField,
  TextAreaField,
} from '@/components/lista-vip/CamposDaPesquisa'
import { GRUPO_VIP_WHATSAPP } from '@/content/site'
import { maskPhone, validatePhone, validateRequired, type FieldError } from '@/lib/validation'
import {
  enviarListaVip,
  OPCOES_DIFICULDADE,
  OPCOES_SISTEMA,
  OPCOES_VALOR_FORMULARIO,
  type FairPrice,
  type PainPoint,
  type UsesSystem,
} from '@/lib/waitlist-api'
import styles from './lista-vip.module.css'

export default function ListaVipForm() {
  const [name, setName] = useState('')
  const [businessType, setBusinessType] = useState('')
  const [phone, setPhone] = useState('')
  const [expectation, setExpectation] = useState('')
  const [painPoints, setPainPoints] = useState<string[]>([])
  const [painPointOther, setPainPointOther] = useState('')
  const [usesSystem, setUsesSystem] = useState<string | undefined>(undefined)
  const [usesSystemOther, setUsesSystemOther] = useState('')
  const [fairPrice, setFairPrice] = useState<string | undefined>(undefined)
  const [wantsUpdates, setWantsUpdates] = useState(true)

  const [errosNome, setErroNome] = useState<FieldError>(null)
  const [erroTelefone, setErroTelefone] = useState<FieldError>(null)
  const [erroExpectativa, setErroExpectativa] = useState<FieldError>(null)

  const [enviando, setEnviando] = useState(false)
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [enviado, setEnviado] = useState(false)

  /*
   * A tela de sucesso e muito mais curta que o formulario, e o navegador
   * mantem a rolagem de onde o botao estava — a confirmacao nascia atras do
   * cabecalho fixo. Isso importa mais aqui do que pareceria: o que fica
   * escondido e o convite do grupo, que e o passo que falta.
   */
  useEffect(() => {
    if (enviado) window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [enviado])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const erroDeNome = validateRequired(name, 'seu nome')
    const erroDeTelefone = validatePhone(phone)
    const erroDeExpectativa = validateRequired(expectation, 'o que você espera do Buddy')

    setErroNome(erroDeNome)
    setErroTelefone(erroDeTelefone)
    setErroExpectativa(erroDeExpectativa)
    if (erroDeNome || erroDeTelefone || erroDeExpectativa) return

    setEnviando(true)
    setErroGeral(null)

    const r = await enviarListaVip({
      name,
      ...(businessType.trim() === '' ? {} : { businessType: businessType.trim() }),
      phone,
      expectation,
      painPoints: painPoints as PainPoint[],
      ...(painPointOther.trim() === '' ? {} : { painPointOther: painPointOther.trim() }),
      ...(usesSystem === undefined ? {} : { usesSystem: usesSystem as UsesSystem }),
      ...(usesSystemOther.trim() === '' ? {} : { usesSystemOther: usesSystemOther.trim() }),
      ...(fairPrice === undefined ? {} : { fairPrice: fairPrice as FairPrice }),
      wantsUpdates,
    })

    setEnviando(false)

    if (!r.ok) {
      setErroGeral(r.error)
      return
    }

    setEnviado(true)
  }

  if (enviado) {
    return (
      <div className={styles.agradecimento}>
        <FormHeader title="Respostas salvas! 🎉" />
        <p className={styles.agradecimentoTexto}>
          Agora falta um passo: <strong>entrar no grupo do WhatsApp</strong>. É por lá que vamos
          mostrar o que estamos construindo e contar com você para ajudar o Buddy a ficar cada vez
          melhor.
        </p>

        {/*
          Link de verdade, e nao redirecionamento automatico no `useEffect`: o
          navegador bloqueia navegacao que a pessoa nao pediu, e quem abre no
          computador sem WhatsApp ficaria olhando uma aba em branco sem saber
          que as respostas foram salvas. O clique e dela.
        */}
        <a
          href={GRUPO_VIP_WHATSAPP}
          target="_blank"
          rel="noreferrer noopener"
          className={styles.botaoDoGrupo}
        >
          Entrar no grupo do WhatsApp
        </a>

        <p className={styles.agradecimentoTexto}>
          <strong>O Buddy está chegando. E você vai conhecê-lo antes de todo mundo.</strong>
        </p>
      </div>
    )
  }

  return (
    <>
      <FormHeader
        title="Grupo VIP de Pré-Lançamento"
        subtitle="Estamos construindo uma nova forma de cuidar do seu negócio, pensada para MEIs e pequenos empreendedores. Conte um pouco sobre você e ajude a moldar o EiBuddy antes do lançamento."
      />

      {erroGeral ? <Alert tone="error">{erroGeral}</Alert> : null}

      <form onSubmit={handleSubmit} noValidate>
        <TextField
          label="Qual é o seu nome?"
          value={name}
          onChange={(v) => {
            setName(v)
            if (errosNome) setErroNome(validateRequired(v, 'seu nome'))
          }}
          onBlur={() => setErroNome(validateRequired(name, 'seu nome'))}
          error={errosNome}
          disabled={enviando}
          autoComplete="name"
        />

        <TextField
          label="Qual é o ramo da sua empresa?"
          value={businessType}
          onChange={setBusinessType}
          placeholder="Mercearia, salão de beleza, oficina..."
          disabled={enviando}
        />

        <TextField
          label="Qual é o seu celular?"
          value={phone}
          onChange={(v) => {
            setPhone(maskPhone(v))
            if (erroTelefone) setErroTelefone(validatePhone(v))
          }}
          onBlur={() => setErroTelefone(validatePhone(phone))}
          error={erroTelefone}
          type="tel"
          inputMode="tel"
          placeholder="(41) 99876-5432"
          autoComplete="tel"
          disabled={enviando}
        />

        <TextAreaField
          label="Como você espera que o EiBuddy ajude você e sua empresa?"
          value={expectation}
          onChange={(v) => {
            setExpectation(v)
            if (erroExpectativa)
              setErroExpectativa(validateRequired(v, 'o que você espera do Buddy'))
          }}
          error={erroExpectativa}
          hint="Queremos saber o que você realmente gostaria que o Buddy fizesse por você."
          placeholder="Por exemplo: queria saber quanto vendi no dia sem abrir planilha nenhuma..."
          rows={4}
        />

        <CheckboxGroupField
          legend="Qual é hoje a maior dificuldade para cuidar do seu negócio?"
          options={OPCOES_DIFICULDADE}
          selected={painPoints}
          onChange={setPainPoints}
          outraValue={painPointOther}
          onChangeOutra={setPainPointOther}
          hint="Pode escolher mais de uma opção."
        />

        <RadioGroupField
          legend="Você já usa algum sistema para cuidar do seu negócio?"
          options={OPCOES_SISTEMA}
          value={usesSystem}
          onChange={setUsesSystem}
          outraValue={usesSystemOther}
          onChangeOutra={setUsesSystemOther}
        />

        <RadioGroupField
          legend="Considerando tudo o que o EiBuddy poderá oferecer, qual valor mensal você considera justo?"
          options={OPCOES_VALOR_FORMULARIO}
          value={fairPrice}
          onChange={setFairPrice}
        />

        <RadioGroupField
          legend="Você autoriza o EiBuddy a enviar informações sobre o lançamento e novidades?"
          options={[
            { value: 'sim', label: 'Sim, quero receber informações sobre o EiBuddy.' },
            { value: 'nao', label: 'Não, prefiro não receber.' },
          ]}
          value={wantsUpdates ? 'sim' : 'nao'}
          onChange={(v) => setWantsUpdates(v === 'sim')}
        />

        <SubmitButton loading={enviando} loadingLabel="Salvando...">
          Salvar respostas
        </SubmitButton>
      </form>
    </>
  )
}
