'use client'

import { useState, type FormEvent } from 'react'
import { enviarEmailDeTeste, type ResultadoDoTesteDeEmail } from '@/lib/admin-api'
import { Badge, Card, Field, Input, PageHeader } from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import styles from './email.module.css'

/**
 * E-mail da plataforma — achado do QA ("os e-mails nao funcionam").
 *
 * A redefinicao de senha e os avisos de Parceiro engolem a falha de proposito
 * (quem pede a senha nao pode descobrir se a conta existe), e por isso
 * ninguem via que nada saia. Este teste mostra o modo do servidor e o motivo
 * exato quando o e-mail nao sai.
 */
export default function AdminEmailView() {
  const [destino, setDestino] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoDoTesteDeEmail | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (destino.trim() === '') return setErro('Informe um e-mail para receber o teste.')
    setEnviando(true)
    setErro(null)
    setResultado(null)
    const r = await enviarEmailDeTeste(destino.trim())
    setEnviando(false)
    if (!r.ok) return setErro(r.erro)
    setResultado(r.dados)
  }

  return (
    <>
      <PageHeader
        title="E-mail"
        subtitle="Confira se a redefinição de senha e os avisos de Parceiro estão saindo"
      />
      <Card title="Enviar e-mail de teste">
        <form onSubmit={enviar} noValidate className={styles.form}>
          <Field label="Enviar para" span={12}>
            <Input
              id="email-teste-destino"
              type="email"
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              placeholder="voce@empresa.com.br"
              autoComplete="email"
            />
          </Field>
          <Button type="submit" disabled={enviando}>
            {enviando ? 'Enviando...' : 'Enviar teste'}
          </Button>
        </form>

        {erro !== null ? (
          <p role="alert" className={styles.alerta}>
            {erro}
          </p>
        ) : null}

        {resultado !== null ? (
          <div role="status" className={styles.resultado}>
            <p>
              Modo do servidor:{' '}
              <Badge tone={resultado.mode === 'smtp' ? 'success' : 'warning'}>
                {resultado.mode === 'smtp' ? 'SMTP (envia de verdade)' : 'Só log (não envia)'}
              </Badge>
            </p>
            {resultado.sent ? (
              <p>
                Enviado. Confira a caixa de entrada de <strong>{destino}</strong> — e a pasta de
                spam, na primeira vez.
              </p>
            ) : (
              <p>
                <strong>O e-mail não saiu.</strong> Motivo: {resultado.reason}
              </p>
            )}
          </div>
        ) : null}
      </Card>
    </>
  )
}
