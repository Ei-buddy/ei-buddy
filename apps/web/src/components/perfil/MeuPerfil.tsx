'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Card, Field, FormGrid, Input, LegendaObrigatorio, PageHeader } from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import {
  carregarMinhaConta,
  type MinhaConta,
  trocarEmail,
  trocarNome,
  trocarSenha,
} from '@/lib/minha-conta-api'
import styles from '../empresa/empresa.module.css'

type Mensagem = { tom: 'ok' | 'erro'; texto: string } | null

/**
 * Meu perfil — NR-153. Os dados da PESSOA logada, e nao da loja: valem para
 * todas as lojas dela.
 *
 * O nome muda sem senha. E-mail e senha pedem a senha atual — sao o que deixa
 * alguem entrar na conta, como o celular (RF-132).
 */
export default function MeuPerfil() {
  const [conta, setConta] = useState<MinhaConta | null>(null)
  const [erroCarga, setErroCarga] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const r = await carregarMinhaConta()
      if (r.ok) setConta(r.dados)
      else setErroCarga(r.erro)
    })()
  }, [])

  return (
    <>
      <PageHeader
        title="Meu perfil"
        subtitle="Seus dados de acesso. Valem para todas as suas lojas."
      />
      {erroCarga !== null ? (
        <Card>
          <p role="alert" className={styles.erro}>
            {erroCarga}
          </p>
        </Card>
      ) : conta === null ? (
        <Card>
          <p>Carregando...</p>
        </Card>
      ) : (
        <>
          <SeusDados conta={conta} aoSalvar={setConta} />
          <SuaSenha />
        </>
      )}
    </>
  )
}

function SeusDados({ conta, aoSalvar }: { conta: MinhaConta; aoSalvar: (c: MinhaConta) => void }) {
  const [nome, setNome] = useState(conta.name)
  const [email, setEmail] = useState(conta.email ?? '')
  const [senha, setSenha] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState<Mensagem>(null)

  const mudouEmail = email.trim().toLowerCase() !== (conta.email ?? '').toLowerCase()

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setMensagem(null)
    if (nome.trim().length < 2) {
      setMensagem({ tom: 'erro', texto: 'Informe o seu nome.' })
      return
    }
    if (mudouEmail && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setMensagem({ tom: 'erro', texto: 'Confira o e-mail.' })
      return
    }
    if (mudouEmail && !senha) {
      setMensagem({ tom: 'erro', texto: 'Para trocar o e-mail, informe a sua senha atual.' })
      return
    }

    setSalvando(true)
    let atual = conta
    if (nome.trim() !== conta.name) {
      const r = await trocarNome(nome)
      if (!r.ok) {
        setSalvando(false)
        setMensagem({ tom: 'erro', texto: r.erro })
        return
      }
      atual = r.dados
    }
    if (mudouEmail) {
      const r = await trocarEmail(email, senha)
      if (!r.ok) {
        setSalvando(false)
        aoSalvar(atual)
        setMensagem({ tom: 'erro', texto: r.erro })
        return
      }
      atual = r.dados
    }
    setSalvando(false)
    setSenha('')
    aoSalvar(atual)
    setMensagem({
      tom: 'ok',
      texto: mudouEmail
        ? 'Dados salvos. A partir de agora, entre com o e-mail novo.'
        : 'Dados salvos.',
    })
  }

  return (
    <Card title="Seus dados">
      <form onSubmit={salvar} noValidate>
        <LegendaObrigatorio />
        <FormGrid>
          <Field label="Nome" span={6} htmlFor="perfil-nome" obrigatorio>
            <Input
              id="perfil-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              autoComplete="name"
              maxLength={120}
            />
          </Field>
          <Field
            label="E-mail"
            span={6}
            htmlFor="perfil-email"
            hint="é com ele que você entra"
            obrigatorio
          >
            <Input
              id="perfil-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </Field>
          {mudouEmail ? (
            <Field label="Sua senha atual" span={6} htmlFor="perfil-email-senha" obrigatorio>
              <Input
                id="perfil-email-senha"
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
          ) : null}
        </FormGrid>

        {mensagem ? (
          <p
            role={mensagem.tom === 'erro' ? 'alert' : 'status'}
            className={`${styles.mensagemPerfil} ${mensagem.tom === 'erro' ? styles.erro : ''}`}
          >
            {mensagem.texto}
          </p>
        ) : null}

        <div className={styles.acoesCelular}>
          <Button type="submit" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar dados'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function SuaSenha() {
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState<Mensagem>(null)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setMensagem(null)
    if (!atual) {
      setMensagem({ tom: 'erro', texto: 'Informe a sua senha atual.' })
      return
    }
    if (nova.length < 8) {
      setMensagem({ tom: 'erro', texto: 'A nova senha precisa de ao menos 8 caracteres.' })
      return
    }
    if (nova !== confirmacao) {
      setMensagem({ tom: 'erro', texto: 'A confirmação não bate com a nova senha.' })
      return
    }

    setSalvando(true)
    const r = await trocarSenha(atual, nova)
    setSalvando(false)
    if (!r.ok) {
      setMensagem({ tom: 'erro', texto: r.erro })
      return
    }
    setAtual('')
    setNova('')
    setConfirmacao('')
    setMensagem({ tom: 'ok', texto: 'Senha trocada.' })
  }

  return (
    <Card title="Senha">
      <form onSubmit={salvar} noValidate>
        <FormGrid>
          <Field label="Senha atual" span={4} htmlFor="senha-atual" obrigatorio>
            <Input
              id="senha-atual"
              type="password"
              value={atual}
              onChange={(e) => setAtual(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Field label="Nova senha" span={4} htmlFor="senha-nova" hint="mínimo 8" obrigatorio>
            <Input
              id="senha-nova"
              type="password"
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirme a nova senha" span={4} htmlFor="senha-confirma" obrigatorio>
            <Input
              id="senha-confirma"
              type="password"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </FormGrid>

        {mensagem ? (
          <p
            role={mensagem.tom === 'erro' ? 'alert' : 'status'}
            className={`${styles.mensagemPerfil} ${mensagem.tom === 'erro' ? styles.erro : ''}`}
          >
            {mensagem.texto}
          </p>
        ) : null}

        <div className={styles.acoesCelular}>
          <Button type="submit" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Trocar senha'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
