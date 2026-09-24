'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Card, Field, FormGrid, Input } from '@/components/ui/UI'
import { Button } from '@/components/ui/Button'
import { pedir } from '@/lib/http'
import { maskPhone } from '@/lib/validation'
import styles from './empresa.module.css'

/**
 * O celular de quem esta logado — RF-132, ADR-0012, NR-113.
 *
 * Para o dono, este numero e o WhatsApp que opera a loja: e por ele que o canal
 * reconhece quem manda mensagem. Trocar aqui tira o numero antigo do canal na
 * hora. Nao e o "Celular / WhatsApp" da EMPRESA, logo acima, que e contato
 * cadastral da loja — por isso o cartao diz de quem e.
 */
export default function CelularDoCanal() {
  const [atual, setAtual] = useState<string | null | undefined>(undefined)
  const [editando, setEditando] = useState(false)
  const [novo, setNovo] = useState('')
  const [senha, setSenha] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => {
    void pedir<{ phone: string | null }>('/api/perfil/telefone').then((r) =>
      setAtual(r.ok ? r.dados.phone : null),
    )
  }, [])

  async function salvar(e: FormEvent) {
    e.preventDefault()
    const digitos = novo.replace(/\D/g, '')
    if (digitos.length < 10) {
      setMensagem({ tom: 'erro', texto: 'Informe o celular com DDD.' })
      return
    }
    if (!senha) {
      setMensagem({ tom: 'erro', texto: 'Informe a sua senha atual.' })
      return
    }

    setSalvando(true)
    const r = await pedir<{ phone: string }>('/api/perfil/telefone', {
      method: 'PUT',
      body: JSON.stringify({ phone: digitos, secret: senha }),
    })
    setSalvando(false)

    if (!r.ok) {
      setMensagem({ tom: 'erro', texto: r.erro })
      return
    }
    setAtual(r.dados.phone)
    setEditando(false)
    setNovo('')
    setSenha('')
    setMensagem({
      tom: 'ok',
      texto: 'Celular trocado. O número antigo não opera mais a loja pelo WhatsApp.',
    })
  }

  return (
    <Card title="Seu celular no WhatsApp">
      <p className={styles.conexoesNota}>
        É o número que opera a loja pelo WhatsApp e com que você entra por telefone.{' '}
        {atual === undefined
          ? 'Carregando...'
          : atual === null
            ? 'Nenhum celular cadastrado.'
            : `Atual: ${maskPhone(atual)}.`}
      </p>

      {mensagem ? (
        <p
          role={mensagem.tom === 'erro' ? 'alert' : 'status'}
          className={mensagem.tom === 'erro' ? styles.erro : undefined}
        >
          {mensagem.texto}
        </p>
      ) : null}

      {editando ? (
        <form onSubmit={salvar} noValidate>
          <FormGrid>
            <Field label="Novo celular" span={6} htmlFor="celular-novo">
              <Input
                id="celular-novo"
                value={novo}
                onChange={(e) => setNovo(maskPhone(e.target.value))}
                inputMode="tel"
                placeholder="(41) 99876-5432"
                autoComplete="tel"
              />
            </Field>
            <Field label="Sua senha atual" span={6} htmlFor="celular-senha">
              <Input
                id="celular-senha"
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
          </FormGrid>
          <div className={styles.acoesCelular}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditando(false)}
              disabled={salvando}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? 'Salvando...' : 'Trocar celular'}
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" onClick={() => setEditando(true)}>
          Trocar celular
        </Button>
      )}
    </Card>
  )
}
