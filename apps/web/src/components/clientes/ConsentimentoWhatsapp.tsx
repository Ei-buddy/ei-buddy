'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import {
  consentimentoDoCliente,
  registrarConsentimento,
  type ConsentimentoWhatsapp as Consentimento,
} from '@/lib/clientes-api'
import { formatDateTime } from '@/lib/format'
import styles from './detalhe.module.css'

/**
 * Registrar o aceite e a recusa de mensagens — RF-016.
 *
 * ## Por que isto e um REGISTRO, e nao o consentimento
 *
 * Nao ha tela do cliente neste sistema: o WhatsApp de entrada e do lojista,
 * que opera a loja por mensagem. Entao o que acontece aqui e o equivalente
 * digital de anotar um papel assinado — o lojista declara o que o cliente
 * disse, e a trilha guarda quem declarou e quando.
 *
 * Por isso os botoes dizem "o cliente autorizou" e nao "autorizar": a diferenca
 * entre declarar um fato e praticar o ato e exatamente o que separa um registro
 * valido de uma caixinha marcada por quem nao e o titular.
 *
 * ## Tres estados, e nao dois
 *
 * Nunca se manifestou, autorizou, pediu para nao receber. Um booleano
 * achataria o primeiro no terceiro, e sao coisas diferentes: um exige PEDIR o
 * aceite, o outro PROIBE pedir de novo.
 */
export default function ConsentimentoWhatsapp({ clienteId }: { clienteId: string }) {
  const [consentimento, setConsentimento] = useState<Consentimento | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const r = await consentimentoDoCliente(clienteId)
    /* Falha aqui nao derruba a ficha: e uma secao, e o resto continua legivel. */
    if (r.ok) setConsentimento(r.dados)
  }, [clienteId])

  useEffect(() => {
    void (async () => {
      await carregar()
    })()
  }, [carregar])

  async function registrar(decisao: 'autorizou' | 'recusou') {
    setEnviando(true)
    setErro(null)

    const r = await registrarConsentimento(clienteId, decisao)
    setEnviando(false)

    if (!r.ok) {
      setErro(r.erro)
      return
    }

    setConsentimento(r.dados)
  }

  if (consentimento === null) return null

  const { autorizouEm, recusouEm } = consentimento

  return (
    <div className={styles.exclusao}>
      {recusouEm !== null ? (
        <p className={styles.privacidadeAviso}>
          Este cliente pediu para não receber mensagens em {formatDateTime(recusouEm)}. Cobranças
          por WhatsApp estão bloqueadas para ele.
        </p>
      ) : autorizouEm !== null ? (
        <p className={styles.privacidadeTexto}>
          Autorizou receber mensagens em {formatDateTime(autorizouEm)}. Cobranças por WhatsApp estão
          liberadas.
        </p>
      ) : (
        <p className={styles.privacidadeTexto}>
          Ainda não há registro de autorização. Sem ela, a cobrança por WhatsApp é recusada — peça o
          aceite do cliente antes de registrar aqui.
        </p>
      )}

      {erro === null ? null : <p className={styles.privacidadeErro}>{erro}</p>}

      <div className={styles.privacidadeAcoes}>
        {autorizouEm === null ? (
          <Button
            variant="secondary"
            disabled={enviando}
            onClick={() => void registrar('autorizou')}
          >
            O cliente autorizou
          </Button>
        ) : null}

        {recusouEm === null ? (
          <Button variant="ghost" disabled={enviando} onClick={() => void registrar('recusou')}>
            O cliente pediu para não receber
          </Button>
        ) : null}
      </div>
    </div>
  )
}
